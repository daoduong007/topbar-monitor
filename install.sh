#!/bin/sh
# Install Topbar Monitor for the current user.
#   ./install.sh                      install from this source folder
#   ./install.sh path/to/file.zip     install from a packed release zip
set -e
UUID=topbar-monitor@daoduong007
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -n "$1" ]; then
    gnome-extensions install --force "$1"
else
    DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp -r "$DIR"/extension.js "$DIR"/nvidia.js "$DIR"/util.js "$DIR"/metadata.json \
          "$DIR"/stylesheet.css "$DIR"/icons "$DEST"/
fi

# Ubuntu/GNOME can block every user-installed extension with this key.
if [ "$(gsettings get org.gnome.shell disable-user-extensions)" = "true" ]; then
    echo "Note: 'disable-user-extensions' was true (blocks all user extensions) - setting it to false."
    gsettings set org.gnome.shell disable-user-extensions false
fi

# Works right away if GNOME already knows the extension; otherwise after re-login.
gnome-extensions enable "$UUID" 2>/dev/null || \
    gsettings set org.gnome.shell enabled-extensions \
      "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, '$UUID']/; s/\[, /[/; s/@as \[\]/['$UUID']/")"

echo "Installed $UUID."
echo "On Wayland, log out and back in to load it (or to load a new version)."
