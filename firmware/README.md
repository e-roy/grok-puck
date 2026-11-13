# Firmware

ESP-IDF 6.1 + LVGL 9 firmware for the Waveshare **ESP32-S3-Touch-LCD-1.46**: the face, touch (hold to
talk), microphone and speaker, Wi-Fi setup from a phone, and the link to the bridge. Design and
behaviour: [docs/spec.md](../docs/spec.md) §4.

## Install it from the browser

No ESP-IDF needed: open the [Grok Puck installer](https://e-roy.github.io/grok-puck/) in Chrome, Edge
or Firefox (151 or newer) on a computer, plug the board in with a USB-C cable that carries data, and
press **Install**. It installs the latest release and keeps the device's settings (its Wi-Fi networks,
bridge address and key); tick **Erase device** for a clean start. The whole setup, in order:
[docs/setup.md](../docs/setup.md).

## Releases

Each [release](https://github.com/e-roy/grok-puck/releases) is built by GitHub Actions from `main`
([.github/workflows/release.yml](../.github/workflows/release.yml)), never on someone's computer, and
the installer page is deployed from the same build. Its files:

| File | Flash offset | What it is |
|---|---|---|
| `grok-puck-<version>-bootloader.bin` | 0x0 | the bootloader |
| `grok-puck-<version>-partition-table.bin` | 0x8000 | the partition table ([partitions.csv](partitions.csv)) |
| `grok-puck-<version>-ota-data.bin` | 0xf000 | the OTA boot data (blank: start the first app slot) |
| `grok-puck-<version>-app.bin` | 0x20000 | the app |
| `manifest.json` | | the installer's manifest (ESP Web Tools) |
| `grok-puck-<version>-notices.txt` | | the licences of everything in the firmware ([NOTICES.md](NOTICES.md)) |

The parts are always written separately and never as one merged image: NVS, between 0x9000 and
0xf000, keeps the device's settings, and a merged image would overwrite it. The packaging script
([installer/](../installer/)) refuses any build in which a part would reach into NVS or any other
partition but its own. To flash a release without the browser, with esptool 5:

```sh
esptool --chip esp32s3 write-flash 0x0 grok-puck-<version>-bootloader.bin 0x8000 grok-puck-<version>-partition-table.bin 0xf000 grok-puck-<version>-ota-data.bin 0x20000 grok-puck-<version>-app.bin
```

Making a release: [CONTRIBUTING.md](../CONTRIBUTING.md#making-a-release).

## Build and flash (for developers)

1. Install **ESP-IDF 6.1** (the Espressif installer on Windows, or `eim` / the install script on macOS
   and Linux) and open its terminal, so `idf.py` is on the path.
2. Plug the board in with USB-C. It shows up as a serial port (`COMx` on Windows, `/dev/cu.usbmodem…`
   on macOS).
3. In this folder:

   ```sh
   idf.py build                 # first build downloads the managed components (pinned in idf_component.yml)
   idf.py -p <port> flash       # e.g. -p COM3, or -p /dev/cu.usbmodem1101
   idf.py -p <port> monitor     # optional: the log (Ctrl+] to quit)
   ```

   Build in a short path: Windows' 260-character path limit breaks deep build folders.
4. On first start the screen shows a QR code for its setup network `Desk-Setup-XXXX`. Join it with a
   phone: the setup page usually opens by itself; if it doesn't, open `http://192.168.4.1` in the
   phone's browser. Add your Wi-Fi (2.4 GHz) with its password (the device joins it to check the
   password before saving it), and type the bridge address (`wss://desk.example.com/device` behind
   the tunnel, or `192.168.1.20:8787` on the home network).
5. Approve the device in the bridge's admin page.

The device keeps up to 5 Wi-Fi networks and joins the strongest one in reach, so it can travel. More
networks are added from the same setup page: the device card's **Wi-Fi setup** in the admin page
opens it, and so does being out of reach of every saved network for a minute. Updating from 0.5 or
earlier keeps the one network that firmware saved; going back to 0.5 or earlier afterwards means
setting up its Wi-Fi again.

If the board doesn't flash, hold **BOOT** while plugging it in (download mode), then try again. To set
a device up again from scratch (Wi-Fi networks, bridge address and key), flash it with
`idf.py -p <port> erase-flash flash`, or use **Erase device** in the installer.

To try the installer page with your own build: package it and serve it locally, as in
[installer/README.md](../installer/README.md).

Setting up the whole desk, in order (bridge, speech, device, Grok Bot): [docs/setup.md](../docs/setup.md).

The published firmware contains third-party software under its own licences:
[NOTICES.md](NOTICES.md).

## Layout (`main/`)

| File | Does |
|---|---|
| `main.c` | wiring: what the face shows, touch, the handlers for the bridge |
| `board.c` | display (SPD2010, QSPI), touch, backlight, I/O expander |
| `audio.c` | speaker (PCM5101) and microphone over I2S |
| `face.c` | the avatar, its states and the setup screen (LVGL) |
| `net.c`, `portal.c` | Wi-Fi (joining the saved networks), the setup network and its captive page |
| `link.c` | the WebSocket link to the bridge |
| `player.c`, `listen.c` | playing the bot's speech; hold to talk |
| `settings.c` | what is kept in flash (NVS) |
