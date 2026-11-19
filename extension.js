// Topbar Monitor — reads /proc and /sys directly every 2 s.
// The only subprocess is one long-running `nvidia-smi --loop`, and only on NVIDIA machines.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {read, eachEntry, nowMs} from './util.js';
import {NvidiaMonitor} from './nvidia.js';

const INTERVAL_S = 2;

// hwmon path by driver name, e.g. coretemp / k10temp / nvme
function findHwmon(names) {
    let found = null;
    eachEntry('/sys/class/hwmon', n => {
        if (found) return;
        const name = (read(`/sys/class/hwmon/${n}/name`) || '').trim();
        if (names.includes(name)) found = `/sys/class/hwmon/${n}/temp1_input`;
    });
    return found;
}

// Integrated/AMD GPU source:
//   busy - amdgpu gpu_busy_percent
//   idle - Intel idle-time counter in ms (i915 RC6 residency, or xe gtidle residency)
function findGpu() {
    let src = null;
    eachEntry('/sys/class/drm', n => {
        if (src || !/^card\d+$/.test(n)) return;
        const base = `/sys/class/drm/${n}`;
        if (read(`${base}/device/gpu_busy_percent`) !== null) {
            src = {type: 'busy', path: `${base}/device/gpu_busy_percent`, base};
            return;
        }
        for (const p of ['gt/gt0/rc6_residency_ms', 'power/rc6_residency_ms',
            'device/tile0/gt0/gtidle/idle_residency_ms']) {
            if (read(`${base}/${p}`) !== null) {
                src = {type: 'idle', path: `${base}/${p}`};
                return;
            }
        }
    });
    return src;
}

const fmtPct = v => `${Math.max(0, Math.min(100, Math.round(v)))}%`;

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(dir) {
        super._init(0.0, 'Topbar Monitor', true);
        this._box = new St.BoxLayout({style_class: 'tbm-box', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);

        const icon = n => new St.Icon({
            gicon: Gio.icon_new_for_string(`${dir}/icons/${n}-symbolic.svg`),
            style_class: 'tbm-icon', y_align: Clutter.ActorAlign.CENTER,
        });
        const label = (cls = 'tbm-text') => new St.Label({
            text: '–', style_class: cls, y_align: Clutter.ActorAlign.CENTER,
        });

        this._cpuTempPath = findHwmon(['coretemp', 'k10temp', 'zenpower', 'cpu_thermal']);
        this._diskTempPath = findHwmon(['nvme', 'drivetemp']);
        this._gpu = findGpu();

        this._cpu = label();
        this._ram = label();
        this._box.add_child(icon('cpu'));
        this._box.add_child(this._cpu);
        this._box.add_child(icon('ram'));
        this._box.add_child(this._ram);
        if (this._gpu) {
            this._gpuL = label();
            this._box.add_child(icon('gpu'));
            this._box.add_child(this._gpuL);
            if (this._gpu.type === 'busy' && read(`${this._gpu.base}/device/mem_info_vram_total`)) {
                this._vram = label();
                this._box.add_child(new St.Label({text: 'VRAM', style_class: 'tbm-dim', y_align: Clutter.ActorAlign.CENTER}));
                this._box.add_child(this._vram);
            }
        }
        const nvDir = NvidiaMonitor.detect();
        if (nvDir) {
            this._nv = new NvidiaMonitor(nvDir, {interval: INTERVAL_S});
            this._nvL = label();
            this._nvVram = label();
            this._box.add_child(icon('gpu'));
            this._box.add_child(this._nvL);
            this._box.add_child(new St.Label({text: 'VRAM', style_class: 'tbm-dim', y_align: Clutter.ActorAlign.CENTER}));
            this._box.add_child(this._nvVram);
        }
        if (this._diskTempPath) {
            this._disk = label();
            this._box.add_child(icon('disk'));
            this._box.add_child(this._disk);
        }

        this._prevCpu = null;
        this._prevIdle = null;
        this._update();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, INTERVAL_S, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.BUTTON_RELEASE ||
            event.type() === Clutter.EventType.TOUCH_END) {
            for (const app of ['resources', 'gnome-system-monitor', 'missioncenter']) {
                if (GLib.find_program_in_path(app)) {
                    GLib.spawn_command_line_async(app);
                    break;
                }
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _temp(path) {
        const v = path ? parseInt(read(path)) : NaN;
        return isNaN(v) ? '' : ` ${Math.round(v / 1000)}°`;
    }

    _update() {
        // CPU %
        const stat = read('/proc/stat');
        if (stat) {
            const f = stat.slice(0, stat.indexOf('\n')).trim().split(/\s+/).slice(1).map(Number);
            const idle = f[3] + (f[4] || 0);
            const total = f.reduce((a, b) => a + b, 0);
            let pct = 0;
            if (this._prevCpu) {
                const dt = total - this._prevCpu.total;
                pct = dt > 0 ? 100 * (1 - (idle - this._prevCpu.idle) / dt) : 0;
            }
            this._prevCpu = {idle, total};
            this._cpu.text = `${Math.round(pct)}%${this._temp(this._cpuTempPath)}`;
        }

        // RAM %
        const mem = read('/proc/meminfo');
        if (mem) {
            const total = +(/MemTotal:\s+(\d+)/.exec(mem)?.[1] ?? 0);
            const avail = +(/MemAvailable:\s+(\d+)/.exec(mem)?.[1] ?? 0);
            if (total) this._ram.text = `${Math.round(100 * (1 - avail / total))}%`;
        }

        // GPU %
        if (this._gpu) {
            let pct = null;
            if (this._gpu.type === 'busy') {
                pct = parseInt(read(this._gpu.path));
                if (this._vram) {
                    const used = parseInt(read(`${this._gpu.base}/device/mem_info_vram_used`));
                    const tot = parseInt(read(`${this._gpu.base}/device/mem_info_vram_total`));
                    if (tot) this._vram.text = fmtPct(100 * used / tot);
                }
            } else {
                const idle = parseInt(read(this._gpu.path));
                const now = nowMs();
                if (this._prevIdle && !isNaN(idle)) {
                    const dt = now - this._prevIdle.t;
                    pct = dt > 0 ? 100 * (1 - (idle - this._prevIdle.v) / dt) : 0;
                }
                this._prevIdle = {v: idle, t: now};
            }
            if (pct !== null && !isNaN(pct))
                this._gpuL.text = fmtPct(pct);
        }

        // NVIDIA
        if (this._nv) {
            const d = this._nv.tick();
            if (this._nv.disabled) {
                this._nvL.text = 'n/a';
                this._nvVram.text = '–';
            } else if (d?.off) {
                this._nvL.text = 'off';
                this._nvVram.text = '–';
            } else if (d) {
                this._nvL.text = `${isNaN(d.util) ? '–' : fmtPct(d.util)}${isNaN(d.temp) ? '' : ` ${d.temp}°`}`;
                this._nvVram.text = d.memTotal > 0 ? fmtPct(100 * d.memUsed / d.memTotal) : '–';
            }
        }

        if (this._disk) this._disk.text = this._temp(this._diskTempPath).trim() || '–';
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._nv?.destroy();
        this._nv = null;
        super.destroy();
    }
});

export default class TopbarMonitorExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this.path);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
