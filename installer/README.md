# Installer

The web page that installs Grok Puck's firmware from the browser, published on GitHub Pages
(https://e-roy.github.io/grok-puck/), and the script that packages a firmware build for it and for the
GitHub Release. People install with Chrome, Edge or Firefox (151 or newer) on a computer, without
ESP-IDF. Design: [docs/spec.md](../docs/spec.md) §4.7.

- `page/`: the page (plain HTML and CSS, light and dark). It uses
  [ESP Web Tools](https://github.com/esphome/esp-web-tools), installed with pnpm and served from the page's
  own site, so the page loads nothing from another server (its Content-Security-Policy says so too).
  Install is offered only where it works: ESP Web Tools checks for Web Serial on a secure page, and
  otherwise the page says which browser to use.
- `scripts/package.mjs`: takes a firmware build folder, checks it and writes the page, the release files
  and the release notes into `dist/` (git-ignored). The release workflow and CI run it, and so can you.
- `scripts/serve.mjs`: serves `dist/site` on http://127.0.0.1:8790 to try the page.
- `test/`: the packaging script on fixture builds, and the licence notices against the lockfiles.
- [NOTICES.md](NOTICES.md): the licences of what the page serves.

## What the packaging script checks

It reads `flash_args` from the build folder, which lists what `idf.py flash` writes: the bootloader, the
partition table, the OTA boot data and the app. The four parts go into the manifest separately, each at
its offset, and never as one merged image, so an install keeps NVS (0x9000-0xf000: the device's Wi-Fi
networks, bridge address and key). It refuses a build that lacks one of the four parts or lists
another, a part that would reach into any partition but its own (read from the build's own partition
table, in whole 4 KB sectors), an app that isn't an ESP image for a chip ESP Web Tools supports, and,
with `--version`, an app that reports another version.

The manifest offers ESP Web Tools' **Erase device** choice (`new_install_prompt_erase`), for a clean
start, and doesn't wait for Improv Wi-Fi after an install (`new_install_improv_wait_time: 0`): the
firmware doesn't speak it, and sets up its Wi-Fi from a phone instead.

## Commands

Node 24 and pnpm 11, as for the bridge: pnpm only, packages at least 7 days old
([pnpm-workspace.yaml](pnpm-workspace.yaml)), added with a major range (`pnpm add esp-web-tools@^10`).

```sh
cd installer
pnpm install
pnpm test                                       # the packaging script, the page build, the notices
pnpm package --build ../firmware/build          # package your build (after idf.py build) into dist/
pnpm serve                                      # then open http://127.0.0.1:8790
```

Run `pnpm package` in the ESP-IDF terminal (with `IDF_PATH` set): the notices take the C library's
licence file from ESP-IDF (`components/esp_libc/COPYING.picolibc`), which isn't kept in this
repository. CI copies it into the build folder instead.

http://127.0.0.1 counts as a secure origin, so the page installs from there as it does over HTTPS.
A local build is for trying things only: releases are built by GitHub Actions
([CONTRIBUTING.md](../CONTRIBUTING.md#making-a-release)).

Updating ESP Web Tools or the firmware's components means checking the licence notices again: the
tests say what changed.
