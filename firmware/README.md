# Firmware

ESP-IDF 6.1 + LVGL 9 firmware for the Waveshare **ESP32-S3-Touch-LCD-1.46**: the face, touch (hold to
talk), microphone and speaker, Wi-Fi setup from a phone, and the link to the bridge. Design and
behaviour: [docs/spec.md](../docs/spec.md) §4.

## Build and flash

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
   phone: the setup page opens by itself. Choose your Wi-Fi (2.4 GHz) and type the bridge address
   (`wss://desk.example.com/device` behind the tunnel, or `192.168.1.20:8787` on the home network).
5. Approve the device in the bridge's admin page.

If the board doesn't flash, hold **BOOT** while plugging it in (download mode), then try again. To set
a device up again from scratch (Wi-Fi, bridge address and key), flash it with
`idf.py -p <port> erase-flash flash`.

Setting up the whole desk, in order (bridge, speech, device, Grok Bot): [docs/setup.md](../docs/setup.md).

## Layout (`main/`)

| File | Does |
|---|---|
| `main.c` | wiring: what the face shows, touch, the handlers for the bridge |
| `board.c` | display (SPD2010, QSPI), touch, backlight, I/O expander |
| `audio.c` | speaker (PCM5101) and microphone over I2S |
| `face.c` | the avatar, its states and the setup screen (LVGL) |
| `net.c`, `portal.c` | Wi-Fi, the setup network and its captive page |
| `link.c` | the WebSocket link to the bridge |
| `player.c`, `listen.c` | playing the bot's speech; hold to talk |
| `settings.c` | what is kept in flash (NVS) |
