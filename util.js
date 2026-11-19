// Tiny sysfs/procfs helpers (only gi:// imports, so standalone gjs can load this too).
import GLib from 'gi://GLib';

const dec = new TextDecoder();

export function read(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? dec.decode(bytes) : null;
    } catch (_) {
        return null;
    }
}

export function eachEntry(dir, fn) {
    let d;
    try { d = GLib.Dir.open(dir, 0); } catch (_) { return; }
    let name;
    while ((name = d.read_name()) !== null) fn(name);
    d.close();
}

export const nowMs = () => GLib.get_monotonic_time() / 1000;
