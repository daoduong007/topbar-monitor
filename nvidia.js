// NVIDIA GPU stats via ONE long-running `nvidia-smi --loop` process.
//
// NVIDIA exposes no utilisation counter in sysfs, so a helper process is unavoidable.
// On hybrid laptops (runtime PM, power/control = "auto") a running nvidia-smi keeps
// the dGPU awake, so there we duty-cycle it: run for RUN_MS, then stop and give the
// GPU a chance to runtime-suspend. While suspended we spawn nothing and report "off";
// we only start again once something else wakes the GPU.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {read, eachEntry, nowMs} from './util.js';

const MAX_FAILS = 5;          // give up after this many spawns that produce no data
const RESPAWN_DELAY_MS = 10000;

export class NvidiaMonitor {
    /** PCI sysfs dir of the first NVIDIA display controller, or null. */
    static detect(pciRoot = '/sys/bus/pci/devices') {
        if (!GLib.find_program_in_path('nvidia-smi')) return null;
        let found = null;
        eachEntry(pciRoot, n => {
            if (found) return;
            const dir = `${pciRoot}/${n}`;
            const vendor = (read(`${dir}/vendor`) || '').trim();
            const cls = (read(`${dir}/class`) || '').trim();
            if (vendor === '0x10de' && cls.startsWith('0x03')) found = dir;
        });
        return found;
    }

    constructor(pciDir, {interval = 2, runMs = 30000, cmd = null} = {}) {
        this._dir = pciDir;
        this._interval = interval;
        this._runMs = runMs;
        // sysfs "0000:01:00.0" -> nvidia-smi "00000000:01:00.0"
        const busId = `0000${GLib.path_get_basename(pciDir)}`;
        this._cmd = cmd ?? ['nvidia-smi', `--id=${busId}`,
            '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total',
            '--format=csv,noheader,nounits', `--loop=${interval}`];

        const ctl = (read(`${pciDir}/power/control`) || '').trim();
        this._runtimePM = ctl === 'auto';
        const delay = parseInt(read(`${pciDir}/power/autosuspend_delay_ms`));
        this._probeMs = (isNaN(delay) || delay < 0 ? 5000 : delay) + 4000;

        this._proc = null;
        this._cancel = null;
        this._startedAt = 0;
        this._stoppedAt = 0;     // set when WE stopped it to let the GPU suspend
        this._diedAt = 0;
        this._fails = 0;
        this._gotData = false;
        this._data = null;       // {util, temp, memUsed, memTotal, at}
    }

    get running() { return this._proc !== null; }
    get disabled() { return this._fails >= MAX_FAILS; }

    _suspended() {
        return (read(`${this._dir}/power/runtime_status`) || '').trim() === 'suspended';
    }

    /** Call once per refresh tick. Returns {off:true} | {util,temp,memUsed,memTotal} | null. */
    tick() {
        if (this.disabled) return null;
        const t = nowMs();

        if (this._runtimePM) {
            if (this.running) {
                if (t - this._startedAt > this._runMs) {
                    this._stop();
                    this._stoppedAt = t;
                }
            } else if (this._suspended()) {
                this._stoppedAt = 0;
                this._data = null;
                return {off: true};
            } else if (t - this._stoppedAt > this._probeMs) {
                // probe window over and GPU still awake -> someone is using it
                this._maybeStart(t);
            }
        } else if (!this.running) {
            this._maybeStart(t);
        }

        const fresh = this._data && t - this._data.at < this._interval * 3000 + this._probeMs;
        return fresh ? this._data : null;
    }

    _maybeStart(t) {
        if (this._diedAt && t - this._diedAt < RESPAWN_DELAY_MS) return;
        this._start(t);
    }

    _start(t) {
        this._gotData = false;
        let proc;
        try {
            proc = Gio.Subprocess.new(this._cmd,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (_) {
            this._fails++;
            this._diedAt = t;
            return;
        }
        this._proc = proc;
        this._startedAt = t;
        const cancel = this._cancel = new Gio.Cancellable();
        const stream = new Gio.DataInputStream({
            base_stream: proc.get_stdout_pipe(), close_base_stream: true,
        });
        this._readLine(stream, cancel);
        proc.wait_async(null, (p, res) => {
            try { p.wait_finish(res); } catch (_) {}
            if (this._proc !== p) return;          // we stopped it ourselves
            this._proc = null;                     // it died on its own
            this._diedAt = nowMs();
            if (!this._gotData) this._fails++;
        });
    }

    _readLine(stream, cancel) {
        stream.read_line_async(GLib.PRIORITY_LOW, cancel, (s, res) => {
            let line;
            try { [line] = s.read_line_finish_utf8(res); } catch (_) { return; }
            if (line === null) return;            // EOF
            this._parse(line);
            this._readLine(s, cancel);
        });
    }

    _parse(line) {
        const [util, temp, used, total] = line.split(',').map(v => parseInt(v));
        if (isNaN(util) && isNaN(temp)) return;
        this._gotData = true;
        this._fails = 0;
        this._data = {util, temp, memUsed: used, memTotal: total, at: nowMs()};
    }

    _stop() {
        this._cancel?.cancel();
        this._cancel = null;
        const p = this._proc;
        this._proc = null;
        p?.force_exit();
    }

    destroy() {
        this._stop();
    }
}
