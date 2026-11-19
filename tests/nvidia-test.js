// Standalone test for nvidia.js with a fake sysfs tree and a fake nvidia-smi.
// Run: gjs -m tests/nvidia-test.js   (no NVIDIA hardware needed)
import GLib from 'gi://GLib';
import System from 'system';
import {NvidiaMonitor} from '../nvidia.js';

const T = GLib.dir_make_tmp('tbm-nvtest-XXXXXX');
const D = `${T}/pci/0000:01:00.0`;
const write = (p, s) => { GLib.mkdir_with_parents(GLib.path_get_dirname(p), 0o755); GLib.file_set_contents(p, s); };
const text = p => new TextDecoder().decode(GLib.file_get_contents(p)[1]);

write(`${D}/vendor`, '0x10de\n');
write(`${D}/class`, '0x030200\n');
write(`${D}/power/control`, 'auto\n');
write(`${D}/power/autosuspend_delay_ms`, '200\n');
write(`${D}/power/runtime_status`, 'active\n');
write(`${T}/pci/0000:00:02.0/vendor`, '0x8086\n');
write(`${T}/pci/0000:00:02.0/class`, '0x030000\n');
write(`${T}/bin/nvidia-smi`, `#!/bin/sh
echo "$$ $*" >> ${T}/spawns.log
while true; do echo "37, 61, 2048, 8192"; sleep 0.3; done
`);
GLib.chmod(`${T}/bin/nvidia-smi`, 0o755);
GLib.setenv('PATH', `${T}/bin:${GLib.getenv('PATH')}`, true);

const setStatus = v => write(`${D}/power/runtime_status`, `${v}\n`);
const sleep = ms => new Promise(r => GLib.timeout_add(0, ms, () => { r(); return false; }));
const loop = new GLib.MainLoop(null, false);
let failed = 0;
const check = (name, ok) => { print(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };

(async () => {
    check('detect finds NVIDIA dir', NvidiaMonitor.detect(`${T}/pci`) === D);

    const m = new NvidiaMonitor(D, {interval: 0.3, runMs: 1500});
    m.tick(); await sleep(700);
    let d = m.tick();
    check('running + parsed data', m.running && d?.util === 37 && d.temp === 61 && d.memUsed === 2048 && d.memTotal === 8192);
    const log = text(`${T}/spawns.log`);
    check('bus id passed to nvidia-smi', log.includes('--id=00000000:01:00.0'));
    const pid = parseInt(log.trim().split('\n').pop());

    await sleep(1000); m.tick();
    check('stopped after runMs (lets GPU sleep)', !m.running);
    await sleep(300);
    check('process killed', !GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS));
    m.tick();
    check('no restart during probe window', !m.running);

    setStatus('suspended'); d = m.tick();
    check('suspended -> off, nothing spawned', d?.off === true && !m.running);
    setStatus('active'); m.tick();
    check('woken GPU -> restarts', m.running);
    await sleep(500);
    check('data after restart', m.tick()?.util === 37);
    m.destroy();
    check('destroy stops process', !m.running);

    write(`${D}/power/control`, 'on\n');
    const m2 = new NvidiaMonitor(D, {interval: 0.3, runMs: 500});
    m2.tick(); await sleep(900); m2.tick();
    check('desktop GPU keeps running', m2.running);
    m2.destroy();

    const m3 = new NvidiaMonitor(D, {interval: 0.3, cmd: ['false']});
    m3.tick(); await sleep(300); m3.tick();
    check('failed spawn counted, no immediate respawn', m3._fails === 1 && !m3.running);
    m3.destroy();

    print(failed ? `${failed} FAILED` : 'ALL PASSED');
    GLib.spawn_command_line_sync(`rm -rf ${T}`);
    loop.quit();
    if (failed) System.exit(1);
})();
loop.run();
