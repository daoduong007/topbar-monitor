UUID := topbar-monitor@daoduong007
SRC  := extension.js nvidia.js util.js metadata.json stylesheet.css LICENSE
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: zip install uninstall test

zip: $(UUID).shell-extension.zip

$(UUID).shell-extension.zip: $(SRC) $(wildcard icons/*)
	gnome-extensions pack --force --extra-source=nvidia.js --extra-source=util.js \
		--extra-source=icons --extra-source=LICENSE .

install: zip
	./install.sh $(UUID).shell-extension.zip

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(DEST)

test:
	gjs -m tests/nvidia-test.js
