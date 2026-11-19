# Firmware

ESP-IDF 6.1 + LVGL 9 firmware for two Waveshare boards: the face, touch (hold to talk), microphone and
speaker, Wi-Fi setup from a phone, and the link to the bridge. Design and behaviour:
[docs/spec.md](../docs/spec.md) §4 (the boards: §4.8).

| Board | Its id | |
|---|---|---|
| Waveshare **ESP32-S3-Touch-LCD-1.46** | `waveshare-lcd-1.46` | round 412×412 LCD; the first board. Its parts and printed case: [hardware/waveshare-lcd-1.46/](../hardware/waveshare-lcd-1.46/) |
| Waveshare **ESP32-S3-Touch-AMOLED-1.8** (V1 and V2) | `waveshare-amoled-1.8` | 368×448 AMOLED in its own case. Its parts: [hardware/waveshare-amoled-1.8/](../hardware/waveshare-amoled-1.8/) |

Each board has its own firmware build, from the same code: what differs sits in its folder in
[boards/](boards/). Its hardware (parts, prints, photos) sits in the folder of the same name in
[hardware/](../hardware/).

## Install it from the browser

No ESP-IDF needed: open the [Grok Puck installer](https://e-roy.github.io/grok-puck/) in Chrome, Edge
or Firefox (151 or newer) on a computer, plug the board in with a USB-C cable that carries data, and
press **Install** under your board. It installs the latest release and keeps the device's settings
(its Wi-Fi networks, bridge address and key); tick **Erase device** for a clean start. The whole setup,
in order: [docs/setup.md](../docs/setup.md).

## Releases

Each [release](https://github.com/e-roy/grok-puck/releases) is built by GitHub Actions from `main`
([.github/workflows/release.yml](../.github/workflows/release.yml)), never on someone's computer, and
the installer page is deployed from the same build. It has these files for each board (`<board>` is
its id):

| File | Flash offset | What it is |
|---|---|---|
| `grok-puck-<version>-<board>-bootloader.bin` | 0x0 | the bootloader |
| `grok-puck-<version>-<board>-partition-table.bin` | 0x8000 | the partition table ([partitions.csv](partitions.csv)) |
| `grok-puck-<version>-<board>-ota-data.bin` | 0xf000 | the OTA boot data (blank: start the first app slot) |
| `grok-puck-<version>-<board>-app.bin` | 0x20000 | the app |
| `grok-puck-<version>-<board>-manifest.json` | | the installer's manifest for that board (ESP Web Tools) |

and one `grok-puck-<version>-notices.txt`: the licences of everything in the firmware, for every
board ([NOTICES.md](NOTICES.md)).

The parts are always written separately and never as one merged image: NVS, between 0x9000 and
0xf000, keeps the device's settings, and a merged image would overwrite it. Every board has the same
flash layout. The packaging script ([installer/](../installer/)) refuses any build in which a part
would reach into NVS or any other partition but its own, and a build packaged as another board. To
flash a release without the browser, with esptool 5 (here for the AMOLED-1.8):

```sh
esptool --chip esp32s3 write-flash 0x0 grok-puck-<version>-waveshare-amoled-1.8-bootloader.bin 0x8000 grok-puck-<version>-waveshare-amoled-1.8-partition-table.bin 0xf000 grok-puck-<version>-waveshare-amoled-1.8-ota-data.bin 0x20000 grok-puck-<version>-waveshare-amoled-1.8-app.bin
```

Making a release: [CONTRIBUTING.md](../CONTRIBUTING.md#making-a-release).

## Build and flash (for developers)

1. Install **ESP-IDF 6.1** (the Espressif installer on Windows, or `eim` / the install script on macOS
   and Linux) and open its terminal, so `idf.py` is on the path.
2. Plug the board in with USB-C. It shows up as a serial port (`COMx` on Windows, `/dev/cu.usbmodem…`
   on macOS).
3. In this folder, for the **LCD-1.46** (a plain build, into `build/`):

   ```sh
   idf.py build                 # first build downloads the managed components (pinned in idf_component.yml)
   idf.py -p <port> flash       # e.g. -p COM3, or -p /dev/cu.usbmodem1101
   idf.py -p <port> monitor     # optional: the log (Ctrl+] to quit)
   ```

   For **another board**, name it with `-D BOARD=<id>` and give it a build folder of its own. CMake
   keeps the board in that folder, so later commands need only `-B`:

   ```sh
   idf.py -D BOARD=waveshare-amoled-1.8 -B <folder> build
   idf.py -B <folder> -p <port> flash monitor
   ```

   A build folder holds one board: switching it to another fails with a message (use another folder).
   The LCD-1.46 keeps its `sdkconfig` in this folder, as before; other boards keep theirs in their
   build folder. Settings for every board go in `sdkconfig.defaults`, a board's own in
   `boards/<id>/sdkconfig.defaults`.

   **On Windows, keep build folders short**: the 260-character path limit is close (with the
   repository in a typical user folder, the deepest paths in `build/` already pass 240). For example
   `idf.py -D BOARD=waveshare-amoled-1.8 -B C:\esp\b\amoled18 build`, and keep the repository in a
   short path too.
4. On first start the screen shows a QR code for its setup network `Desk-Setup-XXXX`. Join it with a
   phone: the setup page usually opens by itself; if it doesn't, open `http://192.168.4.1` in the
   phone's browser. Add your Wi-Fi (2.4 GHz) with its password (the device joins it to check the
   password before saving it), and type the bridge address (`wss://desk.example.com/device` behind
   the tunnel, or `192.168.1.20:8787` on the home network).
5. Approve the device in the bridge's admin page. Its card shows the firmware version and the board.

The device keeps up to 5 Wi-Fi networks and joins the strongest one in reach, so it can travel. More
networks are added from the same setup page: the device card's **Wi-Fi setup** in the admin page
opens it, and so does being out of reach of every saved network for a minute. Updating from 0.5 or
earlier keeps the one network that firmware saved; going back to 0.5 or earlier afterwards means
setting up its Wi-Fi again.

**The log** (`idf.py monitor`, or **Logs** in the installer) shows the firmware's own lines (`desk`,
`net`, `link`, `setup`, `board`...) and only the warnings and errors of ESP-IDF's Wi-Fi driver
(`wifi`, `wifi_init`, `phy_init`, `pp`, `net80211`, `esp_netif_handlers`, `esp_netif_lwip`). Its info
lines name the network, the router, the board's MAC and its addresses, so a log is easier to share
without them. To see them again while debugging Wi-Fi, set `WIFI_DRIVER_LOG_LEVEL` in
[main/main.c](main/main.c) to `ESP_LOG_INFO` and build again. Before sharing a log, still look it
over: the firmware's own lines give the board's address, the bridge address and the device's ID.

If the board doesn't flash, hold **BOOT** while plugging it in (download mode), then try again. To set
a device up again from scratch (Wi-Fi networks, bridge address and key), flash it with
`idf.py -p <port> erase-flash flash` (with `-B <folder>` for another board), or use **Erase device** in
the installer.

Every board's components are in `main/idf_component.yml`, so every build has them all in
`managed_components/` (shared by the build folders), and building one board never removes another
board's. Each firmware links only what its board's code calls.

To try the installer page with your own builds: package them and serve them locally, as in
[installer/README.md](../installer/README.md).

Setting up the whole desk, in order (bridge, speech, device, Grok Bot): [docs/setup.md](../docs/setup.md).

The published firmware contains third-party software under its own licences:
[NOTICES.md](NOTICES.md).

## Layout

| File | Does |
|---|---|
| `main/main.c` | wiring: what the face shows, touch, the handlers for the bridge |
| `main/board.h`, `main/audio.h` | the board layer: what the rest asks of a board (spec §4.8) |
| `main/face.c` | the avatar, its states and the setup screen (LVGL), scaled to the board's screen |
| `main/net.c`, `main/portal.c` | Wi-Fi (joining the saved networks), the setup network and its captive page |
| `main/link.c` | the WebSocket link to the bridge |
| `main/player.c`, `main/listen.c` | playing the bot's speech; hold to talk |
| `main/audio_level.c` | audio levels, for the face's ring and to tell a voice from an accidental touch |
| `main/settings.c` | what is kept in flash (NVS) |
| `boards/<id>/board_config.h` | the board: its id, screen size, what it has, whether it is an OLED |
| `boards/<id>/board.c` | display, touch, buttons, brightness |
| `boards/<id>/audio.c` | speaker and microphone |

The boards:

- `boards/waveshare-lcd-1.46/`: SPD2010 display (QSPI) and touch, backlight, TCA9554 I/O expander;
  PCM5101 speaker and the microphone, each on its own I2S channel.
- `boards/waveshare-amoled-1.8/`: CO5300 / SH8601 AMOLED (QSPI; brightness is a display command), the
  touch chip that answers (FT3168 on V1, CST820 on V2, told apart at start-up), TCA9554 I/O expander;
  the ES8311 codec on one I2S port at 24 kHz both ways, with the microphone resampled to 16 kHz. Its
  AXP2101 power manager is left at its power-on settings.

Adding a board: a folder in `boards/` with these three files (and `sdkconfig.defaults` if it needs
settings of its own), its components in `main/idf_component.yml`, its rows in `NOTICES.md`, and the
board in `installer/scripts/package.mjs` and on the installer page.
