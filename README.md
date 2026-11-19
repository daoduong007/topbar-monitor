# Topbar Monitor

A tiny GNOME Shell extension that shows CPU, RAM, GPU and temperatures in the top bar.

```
[CPU] 6% 44°   [RAM] 55%   [GPU] 3%   [GPU] 3% 30° VRAM 8%   [SSD] 50°
```

- **Light**: runs inside `gnome-shell`, reads `/proc` and `/sys` every 2 s. It starts no extra process, except one `nvidia-smi` on NVIDIA machines.
- **No root, no dependencies.** About 300 lines of JavaScript.
- Click the bar to open **Resources**, **GNOME System Monitor** or **Mission Center**, whichever is installed.

## What it shows

| Item | Source |
|---|---|
| CPU % | `/proc/stat`, change since the previous read |
| CPU temp | hwmon `coretemp` / `k10temp` / `zenpower` / `cpu_thermal` |
| RAM % | `/proc/meminfo`, `1 − MemAvailable / MemTotal` |
| GPU %: Intel i915 | RC6 idle time, `gt/gt0/rc6_residency_ms` (estimate) |
| GPU %: Intel xe | `device/tile0/gt0/gtidle/idle_residency_ms` (estimate) |
| GPU % + VRAM: AMD | `gpu_busy_percent`, `mem_info_vram_*` |
| GPU % + temp + VRAM: NVIDIA | one long-running `nvidia-smi --loop` |
| Disk temp | hwmon `nvme` / `drivetemp` |

An item is hidden when its sensor isn't present.

### NVIDIA on hybrid laptops

A running `nvidia-smi` keeps the dGPU awake. When the GPU uses runtime power management (`power/control = auto`), the extension runs `nvidia-smi` for 30 s, then pauses so the GPU can suspend. While the GPU is suspended the extension shows `off` and starts nothing. It starts `nvidia-smi` again only after something else wakes the GPU. On desktops the loop runs all the time.

## Requirements

- **GNOME Shell 45 – 50**: Ubuntu 24.04+, Fedora 39+, Debian 13, Arch…
- Not for GNOME 44 or older (Ubuntu 22.04, Debian 12), and not for KDE, XFCE, Cinnamon, etc.

## Install

From the [latest release](https://github.com/daoduong007/topbar-monitor/releases/latest):

```bash
gnome-extensions install --force topbar-monitor@daoduong007.shell-extension.zip
gnome-extensions enable topbar-monitor@daoduong007
```

Or from source:

```bash
git clone https://github.com/daoduong007/topbar-monitor.git
cd topbar-monitor
./install.sh
```

Then **log out and back in**. On Wayland, GNOME only picks up new extensions, or new versions, at login.

> **Nothing shows up?** Ubuntu can block every user-installed extension with
> `org.gnome.shell disable-user-extensions`. `install.sh` turns that off. To do it by hand:
> `gsettings set org.gnome.shell disable-user-extensions false`

Uninstall: `make uninstall`, or `gnome-extensions uninstall topbar-monitor@daoduong007`.

## Development

```bash
make zip      # build topbar-monitor@daoduong007.shell-extension.zip
make install  # pack and install for the current user
make test     # test the NVIDIA logic with a fake sysfs tree and a fake nvidia-smi
```

To change the refresh rate, edit `INTERVAL_S` in `extension.js`.

---

## Tiếng Việt

Extension GNOME hiển thị CPU / RAM / GPU / nhiệt độ ở góc phải thanh trên cùng. Nó chạy ngay trong GNOME, chỉ đọc file `/proc` và `/sys`, không cần root.

Cài: tải file `.zip` ở mục Releases, rồi chạy hai lệnh `gnome-extensions` phía trên. Sau đó **đăng xuất và đăng nhập lại**. Nếu không thấy gì, chạy `gsettings set org.gnome.shell disable-user-extensions false`.

## License

GPL-2.0-or-later
