# Spec: Grok Bot desk display

**Status: v0.1 (24 Oct 2026) is mostly built; §8 shows each milestone's status, and the README says
what works.** Agreed on 12 Nov 2026 and not built yet: **xAI as a speech service** (§5.6.1). Built on
13 Nov 2026: the **Listen page** for hearing the bot on a computer (§5.10, milestone M7, with firmware
0.6.1), with "listening" and **Stop listening** added on 14 Nov 2026. **Firmware releases and the web
installer** (§4.7, milestone M9) are built, and v0.6.0 was released on 13 Nov 2026. Agreed and built
on 15 Nov 2026: **boards and what they can do** (§4.8, milestone M10), with a second board, the
Waveshare ESP32-S3-Touch-AMOLED-1.8 (firmware 0.6.2), now supported. Agreed on 19 Nov 2026 and built,
tried on a test bot on 20 Nov 2026: **turn records**, which show what the bot called and check it
against its standing instructions (§5.11, milestone M11), and **attention**: the device shows
clearly that the bot waits for you, until your next message (§4.3.1, firmware 0.6.3). Agreed on 22 Nov
2026: **the bot's name** under the face, an option per device (§4.3.2, firmware 0.6.3). Items marked
*(proposal)* are suggestions you can change; items marked *(to test)* depend on how Grok Bot actually
behaves, and get checked at milestone M2.

This document is written to be public: it has no personal details, hostnames or keys. Real values live
in `.env` files and in the bridge's admin page, both of which stay out of git.

---

## 1. Goal

A small round screen on the desk that **is** one Grok Bot:

- It shows that bot's avatar (the same shape and colour as in the Grok Bot app), animated while the
  bot thinks and works, like a little desk companion acting out what its agent is doing.
- It **speaks everything the bot types**, so you can follow the bot without keeping its window open.
- **Hold the screen and speak** to answer; let go to send. A spoken message acts exactly like a message
  typed into the app, actions included.

Grok Bot is the only "brain": nothing else decides what to say or do. Speech services only turn speech
into text and back. xAI's speech API can be one of them (§5.6.1); no other xAI developer API is used.

## 2. Scope

**In v1**
- One device, one bot. The design allows more devices and bots later without changes to the firmware.
- Device: avatar and states, hold-to-talk, spoken replies, setup through its own
  Wi-Fi hotspot, approval in the admin page.
- Bridge: device link, STT, the bot's routine webhook, an MCP server for the bot, TTS, an admin web
  page, and a Listen page that plays the bot's speech in a browser tab (§5.10).
- Grok Bot setup texts: the MCP server entry, a skill with standing instructions, a routine with a webhook.
- Hardware: BOM, case and stand (STL + OpenSCAD source).

**Not in v1**
- Firmware updates over Wi-Fi: updates go over USB, from the web installer (§4.7).
- A wake word, a battery, or captions of the speech on the screen (the bot's name can show under the
  face: §4.3.2).
- Reading the Grok Bot app's chats or status directly: there is no documented way to do that.

---

## 3. How the parts fit

```
 Desk (Wi-Fi)                  Always-on host (Docker)                     xAI cloud
┌───────────────┐  WebSocket  ┌─────────────────────────────┐  webhook   ┌──────────────────┐
│ Round screen  │────────────►│ bridge (TypeScript)         │───────────►│ Grok Bot         │
│ avatar, mic,  │◄────────────│  /device   device link      │            │  routine (voice) │
│ speaker       │ audio, state│  /mcp      tools for the bot│◄───────────│  skill (status,  │
└───────────────┘             │  admin     web page         │  MCP calls │  speak replies)  │
                              └───────┬─────────────┬───────┘            └──────────────────┘
                                      │ TTS         │ STT
                              speech server     STT service
                              (Kokoro, OpenAI-  (any OpenAI-compatible
                               compatible, xAI)  service, xAI)

Public entry: one Cloudflare Tunnel (outbound only; no ports open at home)
  bridge hostname        /device (device keys), /mcp (MCP key)   — no login page; programs use keys
  admin hostname         admin page, Listen page — Cloudflare Access login, checked again by the bridge
```

**Why a bridge.** The device sits behind a home router and can only open connections outward. Grok Bot
lives in xAI's cloud: it takes input only through a routine's webhook and sends output only by calling
tools on a public HTTPS MCP server. Speech-to-text and text-to-speech run elsewhere. The bridge is the
one always-on program that connects them, holds every key, matches answers to devices, and keeps the
configuration.

### 3.1 The two flows

**A. The bot does something in the app** (you typed, or it is working on its own)
1. Following its skill, the bot calls `desk_status("thinking" | "working" | "waiting")` as it goes.
   The device animates.
2. When it has written its reply, it calls `desk_say(text)` with the same text.
3. The bridge cleans the text for speech (§5.6), gets audio from TTS, and streams it to the device,
   which plays it with the "speaking" animation (or, as its Speak on setting says, to a Listen page
   in a browser tab: §5.10).

**B. You answer by voice**
1. Hold the screen → you speak → let go. The device streams the audio to the bridge while you hold.
2. The bridge transcribes it (STT) and POSTs it to the bot's routine webhook. HTTP 200 only means "run
   started". The device shows "thinking" right away.
3. The routine run acts on it like a typed message, then replies through `desk_say(text, request_id)`,
   and the flow continues as in A.3.

**Timing to expect.** On a test bot (20 Nov 2026, three spoken messages) the reply came **8 to 11 s**
after the webhook, its first desk call 8 to 11 s in; one open-source project had measured 30 to 40 s
(two samples). Typed messages took about 3 to 20 s from the bot's first call to its reply, the long
ones using tools. The device must look clearly "busy" for that long.

---

## 4. Device

### 4.1 Hardware
Two boards so far, each with its own firmware build (§4.8):
- Waveshare **ESP32-S3-Touch-LCD-1.46** (cover-glass version), the first board: ESP32-S3R8 (8 MB
  PSRAM, 16 MB flash), 1.46" 412x412 round display, SPD2010 controller over QSPI, SPD2010 touch over
  I2C, I2S microphone, PCM5101 DAC + amplifier + onboard speaker, QMI8658 motion sensor, TCA9554 I/O
  expander. USB-C power only. Slim printed case and a 15° desk stand; a right-angle USB-C cable runs
  out the back. Note: the SPD2010 needs every redraw area aligned to 4-pixel columns.
- Waveshare **ESP32-S3-Touch-AMOLED-1.8**: the same chip, a 1.8" 368x448 AMOLED (not
  round), an ES8311 codec with a speaker and microphone, in its own case (§4.8). Its display needs
  redraw areas on even rows and columns.
- Pins are in Waveshare's documentation; board bring-up follows Waveshare's examples.

### 4.2 Firmware stack
- ESP-IDF 6.1 (in active service until about August 2027; 5.5 is in maintenance), C, LVGL 9, using
  the current drivers only (`i2c_master`, `i2s_std`, `esp_lcd`). Builds and flashes on Windows and macOS.
- What differs between boards sits behind a board layer (`board.h`, `audio.h`), one folder per board
  in `firmware/boards/`; the rest of the firmware is the same on every board (§4.8).
- The face: the bot's avatar body with two eyes, a gaze that moves as if on a sphere, blinks and
  expressions. Any code derived from other open-source projects keeps its licence notice in
  `THIRD_PARTY_NOTICES.md`.

### 4.3 The face

The bot's avatar fills most of the screen: its **shape** and **colour** (set per bot in the admin page,
sent to the device on connect and whenever they change) with two eyes. Shapes seen so far in the app:
blob, teardrop, cloud, hex, squircle, circle *(to confirm against the app before M6)*.

| State | Comes from | Looks like *(proposal)* |
|---|---|---|
| setup | no Wi-Fi configured | avatar dimmed, slow pulse |
| offline | no link to the bridge | eyes closed, grey tint |
| idle | default | gentle breathing, blinks, gaze wanders |
| listening | holding the screen (the Listen page and the admin page show it too, §5.10) | eyes wide, the ring swells and brightens with the voice level |
| thinking | bridge (after a voice message) or the bot | eyes look up, dots orbit the rim |
| working | the bot (`desk_status`) | faster orbit, eyes darting |
| waiting | the bot needs your answer, your approval or you to act in the app (`desk_status`) | **attention** (§4.3.1): eyes on you, a "!" badge, the avatar hops; a chirp when it starts; until your next message |
| pending | the device waits for approval in the admin page | eyes on you, a soft pulse of the ring (the look "waiting" had before firmware 0.6.3) |
| speaking | audio playing (or playing on the Listen page, §5.10: firmware 0.6.1) | body pulses with the audio level (a steady pulse when the audio plays elsewhere) |
| error | STT/TTS/webhook failure or no answer in 3 min | short shake, red tint, then idle |
| muted | the admin page | small "muted" mark, no audio |

The screen dims after a stretch with nothing happening and wakes on a touch or a message *(proposal:
10 min, adjustable)*.

#### 4.3.1 Attention: the bot waits for you *(agreed 19 Nov 2026, firmware 0.6.3)*

When the bot needs you to answer, to approve something or to act in the Grok Bot app (a confirmation
card, a sign-in, a choice), it calls `desk_status("waiting")`, as its standing instructions ask
(`docs/grok-bot-setup.md`). The desk then shows it clearly and keeps showing it until you're back, so
that coming back to the desk you see that the app is waiting for you.

- **How it looks:** an excited little dance, about 2.2 s a round: the avatar hops twice (about 18
  design pixels up, then lower, a quarter of a second each), turns to one side and then the other
  (it leans 10 design pixels that way while its eyes slide round it as if it were a sphere, up to
  about 14°, the far eye narrowing; back to the front in a second), rests a moment and starts
  again. Its eyes are a little wider and squash as it lands, and a round amber badge with a dark
  "!" (76 design pixels across) sits at its upper right and moves with it. There is no ring: the badge and the movement say it (tried on the
  AMOLED-1.8, 19 Nov 2026). The badge is drawn with
  shapes rather than a font, so it scales with the face (§4.8), and stays well inside the LCD-1.46's
  circle. On an OLED the hop and the slow drift move the badge with the rest of the face.
- **The sound:** when attention starts, a short chirp in the mock voice's style (§5.6: three chirps,
  the last one rising like a question) plays once, where the device's speech plays (the device, a
  Listen page or both). Muted: no sound. A "waiting" while it already shows plays nothing.
- **What it outlasts:** the bot's spoken question (its `desk_say` in the same turn, §5.11: attention
  comes back once it has played); the device going offline and reconnecting; a bridge restart (the
  bridge keeps it in its data file). It doesn't expire: the 10-minute status expiry (§5.7) no longer
  applies to "waiting".
- **What ends it:** your next message, once it is being answered.
  - Typed in the app: the bot's first desk call for it, normally `desk_status("thinking")`. Any desk
    call from that bot that starts a new turn (§5.11) counts: another status, or a reply that comes
    after the turn that asked has ended.
  - Spoken at the desk (or sent with the admin page's test message): when it is sent, since the
    device shows "thinking" from then on. It ends on every device of that bot.
  - For a bot that never calls again: **Clear**, next to "Waiting for you" on the device's card in
    the admin page, for that device.

  A tap doesn't end it: it gives the small wiggle, as during thinking and working.
- **Elsewhere:** the device's card in the admin page (its preview hops with the "!", and it says
  "Waiting for you since 14:02") and the Listen page (the same look; while it waits, the tab's title
  starts with "(!)", so a tab in the background shows it).
- **The device's own waiting** for approval in the admin page keeps the quiet look, without the "!".
- **One state, not two:** "waiting" covers attention. The standing instructions already use it for
  exactly this, so the bot learns nothing new and the device protocol gains no state.
- **Compatibility:** firmware 0.6.3 lists `attention` in its hello's `features`. Older firmware is
  sent "waiting" as before and shows its quiet look, and its card's preview shows that look too. The
  sound, the end and the missing expiry are the bridge's, so they work with any firmware. Firmware
  0.6.3 on an older bridge shows the new look for "waiting", which that bridge ends after 10 minutes,
  as before.

#### 4.3.2 The bot's name *(agreed 22 Nov 2026, firmware 0.6.3)*

With several bots on one bridge, the desk can say whose it is: **Show the bot's name**, a switch per
device on its card in the admin page (§5.8), off by default. The name is the bot's name as set in the
admin page's Bots section, so a rename reaches the desk at once.

- **Where:** under the face, centred, in a soft grey (#9ca3af), never touching the avatar or the
  attention badge (§4.3.1). It drifts with the face and stays put while the avatar hops.
  - **Under the ring** where the screen has black to spare there: on the AMOLED-1.8, the 47 px under
    the face. The name sits 10 px below the ring, at most 295 px wide (about 20 letters), and shows in
    every state.
  - **Under the body** on a round screen, which has nothing to spare: on the LCD-1.46 the band between
    the body and the circle's edge is where the ring swells (listening, speaking) and the dots orbit
    (thinking, working). The name's line starts 10 px below the shape's lowest point, so it never
    touches the body however it hops or leans, and is as wide as the circle allows 6 px from its edge,
    at most 240 px: 161 px for the teardrop, whose body reaches lowest, to 240 px for the cloud (about
    10 to 16 letters). It shows while neither the ring nor the dots do (idle, attention, offline) and
    fades out in about a quarter of a second while they show, then back.
  - The rule goes by the screen, not the board, so later screens follow it: under the ring when the
    black there is at least 36 px (the line, 26 px, and the drift), under the body otherwise.
  - Tried on the AMOLED-1.8 (22 Nov 2026, demo builds): on the body, below the eyes, the name read
    as a mouth, so a round screen has it under the body instead.
- **Font:** Montserrat Bold at 24 px, the family of the setup screen's text, heavier: the built-in
  Montserrat Medium looked thin for a name (compared with SemiBold and Bold on the AMOLED-1.8, 22 Nov
  2026). LVGL builds in Montserrat Medium only, so the firmware carries a font made from Montserrat
  Bold with LVGL's converter, its 95 printable ASCII characters only (about 15 KB of flash;
  `firmware/main/fonts/README.md` says how, `firmware/NOTICES.md` lists it). Capitals are about 1.5 mm
  tall on the LCD-1.46 and 1.3 mm on the AMOLED-1.8; a 14 px font would be under 1 mm.
- **A long name** is cut where its line is full, ending in "..." (three dots: the font has no "…").
- **When:** as above; dimmer while offline (#6b7280). The setup screen covers it, as it covers the
  face. The device keeps the name with the avatar's look, so after a restart it shows before the
  bridge answers.
- **Burn-in (OLED):** the name drifts with the face (§4.8), up to 6 design pixels each way, more than
  its strokes are thick, so each pixel of a letter is lit only part of the time; and it is grey, about
  a third of white's brightness. It wears the panel less than the body, which stays lit inside, so it
  doesn't dim by itself: the screen's dimming (M6) will dim it with the rest.
- **Characters:** the name's font has only basic Latin (ASCII: letters without accents, digits,
  punctuation), as do the built-in ones. The bridge sends the name in those characters: accents come off (é → e, ü → u, ç → c),
  a few letters are spelled out (ß → ss, æ → ae, ø → o, ł → l), curly quotes, dashes and "…" become
  plain ones, and everything else is left out: emoji, other scripts, symbols. Spaces at the ends, and
  doubled ones, go. A name with nothing left shows nothing. The admin page says when the device shows
  a name differently, and when it can't show it at all.
  - More characters are possible later, as flash has room (the app uses 1.6 MB of its 4 MB): the
    name's font made again with Latin-1 and Latin Extended-A (the accented letters of most European
    languages) adds about 35 KB; Cyrillic about as much again; Greek needs another font; Chinese, Japanese or Korean 1 MB or more;
    colour emoji can't be drawn with LVGL's fonts. Not in this step.
- **Elsewhere:** the card's preview (§5.8) and the Listen page (§5.10) draw the name where the device
  does, cut where the device cuts it, give or take a letter (they measure with the device font's
  letter widths), in the page's grey (the device's grey is meant for black), and under the body only
  at rest, as on the device. On the card's small preview it only shows where the name sits; the text
  under the switch gives it in full, and the cut when there is one.
- **Compatibility:** firmware 0.6.3 lists `bot-name` in its hello's `features`. The admin page offers
  the switch only to such firmware (for other firmware it is greyed out, with why), and the bridge
  refuses to turn it on for them. The bridge puts the name in `config` (§5.3) only while the switch is
  on and the firmware lists `bot-name`; older firmware ignores fields it doesn't know anyway. Firmware
  0.6.3 on an older bridge is sent no name, so it shows none.

### 4.4 Touch
**Hold to talk** is the only way to speak: letting go when finished is what a person expects. There
is no countdown and no silence timeout.

| When | Hold | Tap *(proposal)* |
|---|---|---|
| idle / dimmed | listen while held, send on letting go | wake; a small poke reaction |
| thinking / working / waiting | listen (a follow-up message; it ends attention, §4.3.1) | small wiggle (attention stays) |
| speaking (here, or on a Listen page) | stop speaking, drop what is queued, and listen | stop speaking, wherever it plays |

- A press counts as a hold after **0.3 s**; a shorter touch is a tap. Recording starts at the touch
  itself, so a first word spoken while the hold is being counted isn't cut off; a tap sends nothing.
- Letting go with less than about **0.3 s of voice** sends nothing (an accidental touch).
- **A hold interrupts** *(agreed 22 Nov 2026)*: besides the clip playing, every clip queued for the
  device is dropped, wherever it would play (the device or its Listen pages), and none of it plays
  later; a clip that comes while the device is held isn't played either (the bot's answer says so).
  The text stays in the Grok Bot app and in History, which says how many queued clips were dropped.
  What comes after letting go plays as usual. The offline queue (§5.7) isn't touched: it only
  holds speech while the device can't play. A tap stops only the clip playing.
- A hold that reaches the **longest message** (60 s by default, set in the admin page) ends and sends.
- Mute is a switch in the admin page.
- If no STT is configured, a hold only plays the poke reaction.

### 4.5 Listening and audio
- Listening lasts while the screen is held (see 4.4).
- Microphone: 16 kHz, 16-bit mono PCM, streamed to the bridge while you speak. Playback: 24 kHz,
  16-bit mono PCM from the bridge. No codec library is needed.
- The device measures the voice level (energy-based) to drive the ring and to tell an accidental touch
  from a message.
- The microphone is only open while the screen is held, and playback stops when listening starts, so
  v1 needs no echo cancellation.
- Volume is set in the admin page, on top of the board's own level: the LCD-1.46's trimmer still
  works; the AMOLED-1.8 has a fixed codec level.
- Boards whose speaker and microphone share one clock (the AMOLED-1.8's ES8311) record at 24 kHz and
  turn it into 16 kHz on the device, so the bridge gets the same audio from every board (§4.8).

### 4.6 Setup and link
1. First boot, or after **Forget all networks**: the device starts its own Wi-Fi network
   (`Desk-Setup-XXXX`, WPA2 with a new random password each time) and shows a QR code to join it, plus
   the name and password. A phone that joins usually opens the setup page by itself (captive portal);
   if it doesn't, the page is at `http://192.168.4.1` in the phone's browser. There you add the home
   Wi-Fi (2.4 GHz) with its password, and type the bridge address (`desk.example.com` through the
   tunnel, or `192.168.1.20:8787` on the home network).
2. The device joins Wi-Fi, connects to `wss://<bridge host>/device`, says hello (its ID from the MAC
   address, firmware version), and waits as **pending**.
3. In the admin page you approve it and attach it to a bot. The bridge issues a device key, which the
   device stores (NVS) and uses from then on.
4. If the link drops, it reconnects with backoff and shows "offline" meanwhile.

**Travelling: several saved networks.** The device remembers up to **5** Wi-Fi networks, so it can be
taken elsewhere and brought back without setting it up again.
- **Joining:** at start, or when Wi-Fi drops, it scans and joins the saved network with the strongest
  signal; if that fails it tries the next one. Saved networks the scan didn't find (a hidden network)
  are tried last. The network it joins moves to the top of the list. Rounds are retried after 1, 2, 4,
  8 and then every 15 s.
- **Passwords stay on the device** (NVS). The bridge and the admin page only ever see network names.
- **The bridge address** should be the public one (`wss://desk.example.com/device`), so the device
  reaches its bridge from any network. A home-network address only works at home. Changing the
  address drops the device's key (a key belongs to one bridge); the new bridge asks for approval. A
  device that was already connected to a bridge restarts to connect to the new one. The page refuses
  an address typed after another left in the field (a second `://`, or a second scheme right after
  the first, like `ws://wss://desk.example.com`) and says why; nothing is saved, so the device keeps
  its address and its key *(firmware 0.6.4)*.
- **Updating from older firmware** (0.5 and before kept one network): the first start moves that
  network into the list, so the device stays on its Wi-Fi. Going back to 0.5 or earlier afterwards
  means setting up its Wi-Fi again, since that firmware doesn't read the list.
- **Networks it can join:** 2.4 GHz with a normal password (WPA2/WPA3 personal) or open. Networks with
  a sign-in web page (hotels, cafés) or a username and password (eduroam, work Wi-Fi) can't be joined:
  use a phone's hotspot there.

**The setup network opens** (`Desk-Setup-XXXX` with its QR code, as at first boot) when:
1. none of the saved networks is joined within about a minute of starting or of losing Wi-Fi (at once
   when none is saved);
2. Wi-Fi works but the bridge can't be reached for **2 minutes** (a network that blocks it, or a wrong
   bridge address), or no bridge address is saved yet;
3. the admin page asks for it (**Wi-Fi setup** on the device's card): the device stays online meanwhile
   and closes the setup network after 10 minutes.

It closes once none of these holds any more, but never sooner than 2 minutes after its page was last
used, so a phone can see the result of what it just did.

While it is open, the device keeps trying its saved networks (every 30 s, unless a phone is on the
setup network), so a router that comes back after a power cut is joined without help.

**The setup page** (on the phone that joined the setup network): why it is open (no saved network
joined, the bridge can't be reached, or asked from the admin page); nearby networks, with saved ones
marked; **Add** a network; the saved networks, each with whether it is in use or in reach and why it
last failed, and **Forget**; and the bridge address.
- **Add** joins the network first, to check the password, and saves it at the top only if that
  works; otherwise it says why (the password was not accepted, the network wasn't found) and the
  saved networks stay as they were. Adding a network that is saved already changes its password. At
  5 saved networks, one must be forgotten first.
- **The phone may drop off meanwhile:** the device has one radio, so its setup network moves to the
  channel of the network being tried. The page shows "Checking…" with a spinner and asks every 2 s;
  once the phone is back on the setup network (by itself, or joined again by hand), it shows the
  result, which stays until the next Add.
- **Forget** on the network in use makes the device leave it and join another saved one.
- A phone may warn, when the page is closed, that the setup network has no internet: it doesn't, and
  that is expected.

**The admin page** (device card → Wi-Fi): the saved network names, which one is in use and its signal;
**Forget** for each; **Wi-Fi setup** (opens the setup network, to add a network from a phone); and
**Forget all networks** (restarts straight into setup). Networks are added only on the setup page, so
Wi-Fi passwords never pass through the bridge. Devices on firmware older than 0.6.0 don't report
their networks: their card has no Wi-Fi part, only Forget all networks.

No button or gesture on the device is used (holding BOOT while plugging in is download mode).

### 4.7 Installing the firmware: releases and the web installer

People install the firmware from a web page, without ESP-IDF; developers build and flash it with
ESP-IDF as before.

- **Releases are built by GitHub Actions only**, in the same pinned Espressif container as the CI
  firmware check; a build from someone's computer is never published. A maintainer starts the
  "Release firmware" workflow (`.github/workflows/release.yml`) by hand, and only from `main`. It takes
  the version from `PROJECT_VER` (`firmware/CMakeLists.txt`), refuses one that already has a release
  or a tag, builds every board, creates the GitHub Release `v<version>` on the commit it built (each
  board's four firmware parts and installer manifest, and the licence notices: 11 files for two
  boards), then deploys the installer page to GitHub Pages. Running from `main` keeps the
  `github-pages` environment's default rule (deploys from `main` only). How to make one:
  CONTRIBUTING.md.
- **The installer page** (`installer/`, on GitHub Pages) uses ESP Web Tools: an **Install** button
  for each board, each with its own manifest (§4.8), through Web Serial, in Chrome, Edge or Firefox
  (151 or newer) on a computer. The boards' USB is the chip's own USB Serial/JTAG, so no driver is
  needed. Install is offered only where it works (Web Serial,
  on a secure page); elsewhere the page says which browser to use. ESP Web Tools is installed with
  pnpm and served from the page's own site, never from a CDN: a page that writes firmware to people's
  boards runs no code from another server, and its Content-Security-Policy allows only its own site.
- **An install keeps the device's settings.** The manifest lists the four parts separately, at the
  build's own offsets (bootloader 0x0, partition table 0x8000, OTA boot data 0xf000, app 0x20000), never
  one merged image: NVS (0x9000-0xf000: the Wi-Fi networks, bridge address and device key) is never
  written. The packaging script (`installer/scripts/package.mjs`) refuses a build in which a part would
  reach into any partition but its own, on every board. After the install the board restarts by itself
  and reconnects.
- **Erase device**, offered by the installer before it writes, erases the whole flash first: a clean
  start, for the first install over Waveshare's demo firmware or to set a device up again. It replaces
  `idf.py erase-flash flash` for people without ESP-IDF.
- The firmware doesn't use Improv Wi-Fi (its Wi-Fi is set up from a phone, §4.6), so the installer
  doesn't wait for it after an install.
- **Licence notices** ship with every release and on the page: what the firmware contains
  (`firmware/NOTICES.md`, worked out from the build's link map) and what the page serves
  (`installer/NOTICES.md`).
- **Developers** build and flash with ESP-IDF (`firmware/README.md`), in a folder outside any
  cloud-synced directory: a build makes thousands of files.
- No backup of the factory firmware is made. The way back to it is Waveshare's demo image
  (`Firmware/ESP32-S3-Touch-LCD-1.46.bin` in their examples repo for the LCD-1.46; the AMOLED-1.8's
  examples repo has its own demo firmware).

### 4.8 Boards and what they can do *(agreed 15 Nov 2026; the AMOLED-1.8 built with firmware 0.6.2)*

The firmware runs on more than one board. What differs between boards sits behind a small board
layer, so the face, the link, Wi-Fi setup, speaking and listening are the same code on every board.
The first step is a second board, the AMOLED-1.8; boards that lack a speaker or a microphone are
described below but not built yet.

| Board | Its id | Screen | Touch | Audio | Status |
|---|---|---|---|---|---|
| Waveshare ESP32-S3-Touch-LCD-1.46 | `waveshare-lcd-1.46` | round LCD, 412×412 (SPD2010) | SPD2010 | PCM5101 DAC with amplifier and speaker; I2S microphone | the first board |
| Waveshare ESP32-S3-Touch-AMOLED-1.8 | `waveshare-amoled-1.8` | AMOLED, 368×448, upright, not round: SH8601 (V1) or CO5300 (V2) | FT3168 (V1) or CST820 (V2) | ES8311 codec: speaker (NS4150B amplifier) and an analogue microphone | supported: works with real speech on an always-on bridge |

Both have an ESP32-S3R8 (8 MB PSRAM), 16 MB flash, USB-C (the chip's own USB Serial/JTAG) and BOOT on
GPIO0. The AMOLED-1.8 comes in its own case, with an AXP2101 power manager (battery connector, PWR
button) and a TCA9554 I/O expander for the display's and touch's resets.

**The board layer.**
- `firmware/main/` is the same for every board. `board.h` and `audio.h` are what it asks of a board:
  start the display, touch and LVGL; set the brightness; read BOOT; start the speaker and microphone;
  play 24 kHz and record 16 kHz, 16-bit mono; set the volume.
- `firmware/boards/<id>/` holds one board: `board.c` (display, touch, power, brightness), `audio.c`
  (speaker and microphone), `board_config.h` (its id, its screen size, what it has, whether it is an
  OLED) and settings of its own (`sdkconfig.defaults`), if any.
- Every board's components are listed in `main/idf_component.yml` and pinned in the one
  `dependencies.lock`, so every build has them all on disk: the component manager deletes from
  `managed_components/` whatever a build doesn't list, which would break the other boards' build
  folders. A board's firmware links only what its own code calls (`firmware/NOTICES.md` says which).
- One firmware build per board, chosen when the build folder is set up: a plain `idf.py build` builds
  the LCD-1.46 into `build/`, as before; another board is chosen with `-D BOARD=<id>`, in a build
  folder of its own (`idf.py -D BOARD=waveshare-amoled-1.8 -B <folder> build`, firmware/README.md).
  CMake keeps the board in that folder, so flash and monitor need only `-B`, and a folder can't be
  switched to another board. The LCD-1.46 keeps its `sdkconfig` next to the project, as before; other
  boards keep theirs in their build folder. On Windows the folder needs a short path: the 260-character
  limit is close.
- Every board has the same flash layout (`partitions.csv`) and keeps the same things in NVS, so an
  install keeps the settings on every board, and the packaging script checks every board's build the
  same way (§4.7).

**Revisions within a model** share one build when the firmware can tell them apart at start-up.
The AMOLED-1.8's V1 (SH8601 + FT3168) and V2 (shipped from 30 May 2026: CO5300 + CST820) differ in the
touch chip, which answers on I2C at 0x38 (FT3168) or 0x15 (CST820), as in Waveshare's examples. Both
displays take the same commands (Waveshare's board support drives both with one driver); on V2 the
picture starts 16 columns in. The revision found goes in the log. A model whose revisions can't be
told apart that way would get a build per revision. Only V2 has been tried so far; V1's touch chip is
found the same way, but untested.

**What a device tells the bridge** (firmware 0.6.2): its hello gains its board, and its hardware in
`features`, next to what the firmware can do (`speaking`):

```json
{ "type": "hello", "device_id": "desk-a1b2c3", "firmware": "desk-display/0.6.2",
  "board": "waveshare-amoled-1.8", "features": ["speaking", "touch", "microphone", "speaker"] }
```

A hello with a `board` lists all the hardware the board has; firmware before 0.6.2 sends no board
(it only ran on the LCD-1.46), and has touch, a microphone and a speaker. Older bridges ignore both
fields. In this step the bridge keeps the board with the device and the admin card shows it as a
badge next to the firmware ("AMOLED-1.8", with the full name on hover); nothing else in the bridge
changes, since both boards have everything.

**Later, not built: boards without a speaker or a microphone.**
- **No speaker:** Speak on is fixed to the Listen page, and the card says why; the device still shows
  "speaking" while the page plays, and nothing waits for the device to speak. The error and no-answer
  tones play on the page.
- **No microphone:** holding the screen gives the poke reaction, and the card says to talk to the bot
  in the Grok app (typed, or with the app's dictation). There is no talking through the computer: the
  Listen page doesn't record.
- **No touch:** not supported (a tap stops speech and a hold talks).

**The face on other screens.** The face is drawn for a 412 px circle. On another screen it scales by
the screen's shorter side over 412 and sits in the middle; everything scales together, its movements
too (the gaze, the wobble, the orbiting dots).
- On the LCD-1.46 every number is the same as before.
- On the AMOLED-1.8 (368 wide) it is 0.89 times the size: a 268 px body in a 354 px ring, filling the
  width, with about 47 px of black above and below.
- Later sizes follow the same rule: a round screen fills its circle, a landscape screen its height.
- The setup screen keeps its layout (about 300 × 330 px), which fits both screens.
- The bot's name (§4.3.2) goes in the black under the ring where there is room (the AMOLED-1.8), and
  under the body otherwise (the LCD-1.46), at rest only.
- An AMOLED's black is off, so the face looks as it does on the LCD. Its brightness is a panel command
  rather than a backlight (`board_set_backlight` sends it), and the panel stays dark until the first
  frame is drawn.
- An OLED wears where pixels stay lit, and the body would sit in one place all day. On OLED boards
  (`BOARD_OLED` in `board_config.h`) the whole face drifts slowly around a small loop, a pixel at a
  time, never more than 6 design pixels from the centre (11 minutes across, 17 up and down). The
  LCD-1.46 doesn't move. Dimming comes later (M6).

**Audio on the AMOLED-1.8.** The ES8311 plays and records on one I2S port with one clock, so both
directions run at 24 kHz: speech plays as it arrives, and the microphone's 24 kHz is turned into
16 kHz on the device (a 2:3 resampling filter), so the bridge gets what it gets from the LCD-1.46.
The admin page's volume scales the samples, as on the LCD-1.46, on top of a fixed codec level for the
board. The microphone gain is fixed for the board so that voice levels match what listening expects
(§4.5: a quiet room at -35 to -44 dB, a voice at -15 to -23 dB). GPIO46 switches its amplifier on.

**Power.** The AXP2101's power-on settings already power the ESP32-S3, the display and the audio
(read on a V2 board: DCDC1 and ALDO1 on at 3.3 V, every other rail off), so the firmware leaves it
alone. Its PWR button turns the board off and on by itself; the firmware doesn't use it. Running from
a battery is not part of this step.

**Installing (§4.7).** USB can't tell ESP32-S3 boards apart, so the installer page has one Install
button per board, each with its own manifest, the board's name and a photo of it (the round puck in
its printed case; the rectangle in its own case), from `hardware/<board>/images/`. The page says how
to tell them apart: the LCD-1.46 is round; the AMOLED-1.8 is
rectangular, and its name is on the label on its back. A wrong choice doesn't start: the screen stays
dark, and installing the right one fixes it.
- Each manifest's name says its board ("Grok Puck for ESP32-S3-Touch-AMOLED-1.8").
- The page says once if the browser can't install (a browser check of its own), rather than under
  every board's button.
- Release files per board: `grok-puck-<version>-<id>-<part>.bin` (the four parts) and
  `grok-puck-<version>-<id>-manifest.json`, plus one notices file for both boards: 11 files.
- The packaging script refuses a build that is for another board than the one it is packaged as (the
  app names its board), and a release that lacks a board.

**What is ported for a board, and what is tested on it.**
- Ported for the AMOLED-1.8: display and brightness, touch (tap and hold), the speaker with the admin
  page's volume, the microphone, BOOT for download mode. Not used: the QMI8658 motion sensor, the
  PCF85063 clock, the TF slot, the battery and the PWR button.
- Tested on each new board before it goes in the BOM: the face fills the screen and shows every
  state; tap and hold; speech at a usable volume across the volume range (the mock voice and a real
  one); the microphone's level and speech-to-text; Wi-Fi setup from a phone; approval; an install from
  its own button keeps the settings, and Erase starts clean; the right revision is found; in its case,
  USB-C, BOOT, the speaker and the microphone work through it.

**CI and releases** build every board: the `firmware` check builds each board in turn, `installer`
packages them all, and every release carries every board's files. The check names stay as they are.

---

## 5. Bridge

### 5.1 Runtime
- TypeScript on Node, in Docker Compose on the always-on host, with its own `cloudflared` container
  and its own hostnames. The same code runs locally on Windows or macOS for development. Docker is the
  install method for now (the project assumes developers); an installer app may come later.
- Settings and state live in one JSON file in a data volume (a few devices and bots, plus a capped
  history; no database needed).
- HTTP with Fastify and `ws`, MCP with the official `@modelcontextprotocol/sdk` (Streamable HTTP), the
  admin page with Vite + React, served by the bridge. TypeScript runs directly on Node 24 (no build step
  for the server).
- **pnpm only**, with supply-chain protection in `bridge/pnpm-workspace.yaml`:
  - packages must be at least **7 days old**, and pnpm fails rather than falling back to a newer one;
  - pnpm fails when the registry gives no publish date;
  - a version is refused if its publisher trust evidence is weaker than an earlier version's;
  - dependency install scripts are blocked.

  `package.json`'s `devEngines` makes npm refuse to install.
- Two ports: the **public** one (`/device`, `/mcp`, `/healthz`) and the **admin** one (page + API).
  Locally the admin port listens on 127.0.0.1 only; behind the tunnel it requires Cloudflare Access.

### 5.2 Entry points
| Path | Who | Auth |
|---|---|---|
| `/device` (WebSocket) | devices | device key (pending devices: hello only) |
| `/mcp` | Grok Bot | `Authorization: Bearer <MCP key>` |
| admin page + its API | you | Cloudflare Access, plus the bridge verifies Access's signed token |
| Listen page (`/listen`) + `/listen/ws` (§5.10) | you, on a computer or phone | as the admin page (same port, same checks); the WebSocket's `Origin` must be the page's own address |
| `/healthz` | monitoring | none, reports nothing private |

### 5.3 Device protocol (implemented in `bridge/src/protocol.ts`)
One WebSocket per device: JSON control messages plus binary audio frames.
- Device → bridge:
  - `hello` (device id, firmware version, its key once approved, and from firmware 0.6.0 its Wi-Fi:
    `"wifi": {"saved": ["Home", "Phone"], "current": "Home", "rssi": -58, "setup": false}`, network
    names only; from firmware 0.6.1, what it can do beyond 0.6.0: `"features": ["speaking"]`, it can
    show "speaking" without playing audio; from firmware 0.6.2, its board, `"board":
    "waveshare-amoled-1.8"`, and that board's hardware in `features`: `"touch"`, `"microphone"`,
    `"speaker"` (§4.8); from firmware 0.6.3, `"attention"`: it shows "waiting" with the "!" and the
    hop (§4.3.1), and `"bot-name"`: it shows the bot's name under its face when `config` gives one
    (§4.3.2). An older bridge ignores these fields; a board that doesn't look like an id is
    dropped, never the hello);
  - `listen.start`, then microphone frames (16 kHz PCM), then `listen.end` or `listen.cancel`;
  - `played` (a clip finished or was stopped);
  - `stop` (the owner touched the screen to stop speech);
  - `state` (informational);
  - `wifi` (the same fields as in hello, when the saved networks, the one in use, the setup network or
    the signal (by 5 dB or more) change). An older bridge answers it with an `error`
    ("unrecognised message"); the device then sends no more until it reconnects.
- Bridge → device:
  - `pending` (waiting for approval);
  - `welcome` (the device key, on approval);
  - `config` (name, bot avatar, volume, mute, longest message; and `botName`, the bot's name in the
    characters the device can show, while its Show the bot's name is on and its hello lists
    `bot-name`, §4.3.2):

    ```json
    { "type": "config", "name": "Desk",
      "bot": { "name": "José ✨", "avatar": { "shape": "blob", "color": "#f59e0b" } },
      "volume": 70, "muted": false, "timings": { "maxListenMs": 60000 }, "botName": "Jose" }
    ```

    `bot.name` stays the name as typed; without `botName` the device shows no name;
  - `show` (state to display: idle, thinking, working, waiting, error; and `speaking` while a Listen
    page plays its speech, only to devices whose hello lists `speaking`: firmware 0.6.0 logs a state
    it doesn't know and keeps what it shows. Never `listening`: while held, the device shows its own
    listening face);
  - `play.start`, then audio frames (24 kHz PCM, sent about 1 s ahead of real time), then `play.end`;
  - `stop`;
  - `wifi.setup` (from the admin page: open the setup network for 10 minutes, staying online);
  - `wifi.forget_network` with `ssid` (from the admin page: forget one saved network);
  - `wifi.forget` (from the admin page: forget all networks and restart into setup);
  - `error`.

  The bridge sends `wifi.setup` and `wifi.forget_network` only to devices that report their networks;
  older firmware ignores message types it doesn't know.

### 5.4 Webhook to the bot
POST to the routine's webhook URL with `Authorization: Bearer <webhook key>` and a body like:
```json
{ "request_id": "…", "text": "what you said", "device_id": "…", "device_name": "…", "recent": [] }
```
`recent` (the last few spoken exchanges) is **off by default**. Turn it on if M2 shows that routine runs
don't see the ongoing chat *(to test)*. 200 means the run started; anything else shows the error state.
Grok Bot limits webhook runs (documented: 200 per hour per routine, 300 per hour in total), and every
run uses plan usage. The bridge adds its own cap *(proposal: 60 per hour)*.

### 5.5 MCP tools for the bot
| Tool | Purpose |
|---|---|
| `desk_status(state, request_id?, device?, bot?)` | `thinking` / `working` / `waiting` / `idle` on the device(s) |
| `desk_say(text, request_id?, device?, bot?)` | speak this text (the reply the bot just typed); with a `request_id` it answers the device that asked |
| `desk_devices()` | list devices, online state, which bot each is attached to |

One tool for every reply keeps the bot's instructions simple: "call `desk_say` with every reply", plus
"pass the `request_id` if the message came from the desk". The same text arriving twice within a minute
is spoken once.

A spoken reply ends "thinking" and "working"; "waiting" stays, because the reply may be the question,
until the bot's next turn (§4.3.1).

Without `device`, a call goes to every device attached to the calling bot. A call that names a device
attached to a different bot is refused.

**Which bot is calling.** The MCP call doesn't say. Every Grok Bot call looks the same, whatever the
bot or the chat: the client "Cursor 1.0.0" on `initialize`, the user agent "Cursor/1.0.0" and the
same header names (seen 19 Nov 2026). Custom MCP servers are also shared by every bot on the account.
So a call finds its bot by, in this order:
1. its `request_id` (a voice turn's, which belongs to one bot);
2. its `device`;
3. the `bot` name it passes;
4. with none of these: the only bot, or with several bots the **default bot**, chosen in the admin
   page (§5.8). When a second bot is added, the default is set to the bot that was already there,
   so that bot's instructions never need to change; each bot added later passes its name (`bot:
   "Test Bot"`). With no default (data from an older bridge that already has several bots), such a
   call is refused, as before.

A call that reached its bot only as the default may have come from another bot that forgot its name:
turn records note how each call found its bot (§5.11).

### 5.6 Speech
- **Two services, chosen separately.** Text to speech (TTS) and speech to text (STT) each have their
  own entry in the admin page, so they can come from different places: for example a self-hosted
  voice and a hosted transcriber. Each entry has a service type:
  - **OpenAI-compatible:** base URL, key, model. Covers the Kokoro speech server, OpenAI, Groq and
    others. TTS uses `/audio/speech` with `response_format: pcm` (24 kHz), streamed to the device as
    it arrives; STT uses `/audio/transcriptions`.
  - **xAI** *(proposal, §5.6.1)*: xAI's own speech API, with only a key.
  - **Mock** (the default, for tests; no service): STT gives a fixed transcript, and TTS a short chirp
    per word. The chirps sit at about 800-1,400 Hz, each word gliding up or down, at half of full
    scale: clearly heard on the board's small speaker (which hardly plays anything below about
    500 Hz), louder than the error and no-answer tones without clipping, and well above their pitches
    (390-660 Hz, each held steady), so they can't be mistaken for them.
- **Voice:** chosen per bot in the admin page, from the TTS service's voice list, with a sample button.
- **Text cleanup before speaking:** remove markdown, skip code blocks and URLs (replaced by a short
  "code omitted" or "link"), keep everything else. Replies are spoken in full; long replies are long
  on purpose, as a prompt to tune the bot to be concise.
- **The Grok Bot app's own voice.** The app has dictation (speech typed into the message box) and
  voice chat (a live spoken call with the bot, with its own voice picker). They belong to the app: no
  documented route (webhook, MCP, skills) carries audio, so the bridge can't use them. They work
  alongside the desk: a dictated message is a typed message, so the desk speaks the reply as usual.
  During a voice chat, mute the device so it doesn't talk over the call. *(to test)* whether the bot
  calls the desk tools during a voice chat.

#### 5.6.1 xAI as a speech service *(agreed 12 Nov 2026, not built)*

xAI's developer API has text to speech and speech to text, with voices from the same family as Grok's
own apps. It is a **separate account and bill** from the Grok Bot plan: a key from xAI's developer
console, paid per use. The listed prices at the time of writing are $15 per million characters spoken
and $0.10 per hour transcribed. At those prices, 100 replies of 300 characters cost about $0.45. It is
opt-in: the default stays a self-hosted (or any OpenAI-compatible) service.

Its endpoints aren't OpenAI's, so it is a service type of its own (`xai`, next to `openai` and `mock`):

| | xAI's API | What the bridge does |
|---|---|---|
| Speak | `POST https://api.x.ai/v1/tts` with `text`, `voice_id`, `language`, `output_format: { codec: "pcm", sample_rate: 24000 }` | sends the bot's voice as `voice_id` and the service's language (`auto` unless set). The docs show the answer both as JSON with base64 `audio` and as a plain audio body, so the bridge accepts either, by its content type |
| Voices | `GET /v1/tts/voices` (`voice_id`, `name`, `language`) | the bot's voice list, grouped by language as for Kokoro |
| Listen | `POST /v1/stt`, multipart: `language`, then `file` (it must be the last field) | sends the recording as WAV, as now, and uses the answer's `text` |

- **Waiting for the first word.** This call returns the whole clip at once, while a streaming service
  starts sooner. So long replies are sent in pieces of a few sentences, one after the other, and the
  device starts speaking after the first piece *(proposal)*. If that still feels slow, xAI's streaming
  connection (`wss://api.x.ai/v1/tts`) is the next step.
- **Admin page.** Each Speech card gets a service choice: OpenAI-compatible or xAI. For xAI only the
  key is asked, since the address is fixed, and **Check** replaces Find models. It speaks a one-word
  test (TTS) or sends half a second of silence (STT), and the status line says connected or what went
  wrong. Each card keeps its own key, so the same xAI key is pasted into both cards when both use xAI.
- **Not used:** xAI's realtime voice agent (speech to speech). It would be a second brain answering
  instead of the Grok Bot; the bridge stays a translator between the desk and the bot.
- **Tests:** a fake xAI server in the test suite, answering in both documented formats.
- *(to test)* Whether the voices in the Grok Bot app's voice chat are among the API's voices.

### 5.7 Routing, queueing, limits
- A reply goes to the device that asked. `desk_say` and `desk_status` go to all devices attached to
  that bot.
- Each device's **Speak on** setting says where its speech plays: on the device, on a Listen page,
  or both (§5.10, with its table). Clips play one at a time per device, in order, wherever they play.
  Holding the device to talk drops the clips queued for it (§4.4).
- Device offline: spoken messages wait in a small queue *(proposal: 5 per device)*, unless a Listen
  page plays them (§5.10); states are not queued. A hold doesn't touch this queue.
- No reply within 3 minutes of a voice message: error state and a short tone. A late reply is still spoken.
- A status the bot never ended ("thinking", "working") goes back to idle after 10 minutes. "Waiting"
  doesn't expire: it stays until the owner's next message (§4.3.1).
- Caps against runaway loops *(proposal)*: 120 `desk_say` calls per hour, 600 status calls per hour.

### 5.8 Admin page
**Stack.** React + Vite as before, styled with **Tailwind CSS v4** and **shadcn/ui** components (on Base
UI, shadcn's default; the components are copied into the project, so they are our code), lucide icons
and Sonner toasts. The page is its own small package in the bridge's pnpm workspace (`bridge/admin`),
so its packages stay apart from the server's; it is built into static files the bridge serves. Light and
dark follow the system, with a switch in the header.

**Layout.** A header (name, "can't reach the bridge" when that happens, theme switch) and five sections:
**Devices · Bots · Speech · Grok Bot · History**: a sidebar on a computer, a bar at the bottom on a
phone. The section is in the address (`#bots`), so reload and back work. It works from 360 px wide.

**Setup checklist.** At the top of Devices while anything is missing: speech service answers, a bot
has a voice, a device is approved and has a bot, the MCP key exists, the bot's webhook is set. Each
item links to where it is fixed; when all are done it shrinks to "Ready".

**Devices.** A highlighted card for a new device waiting for approval (name, bot, Approve). For each
approved device a card with:
- the bot's avatar showing what the device shows (idle, listening while the owner holds it,
  thinking…), online or last seen; while the bot waits for the owner, "Waiting for you since 14:02",
  with **Clear** (§4.3.1);
- the firmware version as a badge next to the device's name ("0.6.1" from the hello's
  "desk-display/0.6.1", "unknown" when there is none; read as "Firmware 0.6.1"), on the card of a
  device waiting for approval too; and next to it the board as a badge ("AMOLED-1.8", its full name on
  hover; none for firmware before 0.6.2, §4.8);
- name (edited in place), bot, volume on the device (slider), mute (switch), longest message;
- **Show the bot's name** (switch, §4.3.2), saying what the device shows ("Under its face:
  “Grok”"), how it differs ("as “Jose”: its font has basic Latin letters only"), or why it can't
  (no bot, nothing in the name it can show, or firmware without `bot-name`: then the switch is greyed
  out). With it on, the card's preview shows the name too;
- **Speak on** (§5.10): the device, the Listen page or both, and whether a Listen page is open or ready
  for it, with a link to open one (`/listen?device=<id>`, in a new tab). A device whose firmware can't
  show "speaking" without audio (before 0.6.1) says so;
- **Try it:** a sentence to speak, where Speak on sends it, with the last few used; showing a state is
  in a small Test menu;
- **Wi-Fi:** its saved networks, Forget for each, and Wi-Fi setup (§4.6);
- at the bottom, set apart: **Forget all networks** and **Forget**, each confirmed in a dialog that
  says what will happen.

**Bots.** A card per bot:
- **Name**, as in the Grok Bot app; when a desk would show it differently (§4.3.2), the field says
  how ("On a desk: “Jose”");
- **Look:** shape as a row of previews to click, colour as swatches plus a picker; the preview is
  what the device draws;
- **Voice:** a searchable list grouped by language and gender (Kokoro names say both: `af_` is
  American English, female), each with a play button;
- **Grok Bot routine:** webhook URL, key (write-only), "send the last few exchanges", Send a test
  message;
- Save is enabled when something changed; edits survive switching sections, and leaving or reloading
  the page with unsaved changes asks first. Add bot is a small dialog asking for the name.
- With two bots or more, above the cards: **Calls that don't name a bot** go to one of them (the
  default bot, §5.5) or are refused. Adding a second bot sets it to the first, and says so in the
  toast; deleting the default bot sets it to the only one left, or to none.

**Speech.** A card each for text to speech and speech to text: service (OpenAI-compatible, or xAI:
§5.6.1), base URL, key (write-only), Find models → model list, and a status line (connected, or what
went wrong). Text to speech has
**Play a test sentence** in the browser; speech to text has the language.

**Grok Bot.** The MCP URL and the header with copy buttons; the key is created or replaced through a
dialog and shown once, with Copy. The setup steps of §6 as a checklist with copyable texts (filled in
M2). Recent MCP calls as a short list (time, tool, client); the technical details fold open, and for
a tool call they include the bot it went to and how it was found (§5.5).

**History.** Two views, **Entries** and **Turns**. Entries, as before: filters (all, voice, spoken,
errors; by device); each entry has its time, kind, text and outcome; its timings are a small bar
split into speech, STT, webhook and bot reply, so slow steps stand out. Errors are red. Turns (§5.11):
the turn records, newest first, with a filter by bot and **Export**.

**Feedback.** Every action answers with a toast next to where you are: successes fade, errors stay
until closed. Confirmations are dialogs, not the browser's `confirm`. The page refreshes itself every
2 s without disturbing a field being edited.

**Quality bar.** Every control has a label and works from the keyboard; text contrast meets WCAG AA in
both themes. Checked with Chrome DevTools at 1280 and 390 px wide, light and dark, with no console
errors.

The page's redesign didn't change the admin API: what it shows differently is worked out in the page.
New endpoints come only with new features, like Wi-Fi setup and Forget for one network (§4.6). Speak
on is a device field (`PATCH /api/devices/<id>` with `{"speakOn": "device" | "page" | "both"}`), and
the overview gives each device `speakOn`, `features`, `speaking` (where its speech plays right now)
and `listen` (`{"open": 1, "ready": true}`: its Listen pages). Its `showing` is `listening` while the
owner holds the device (§5.10). The firmware badge is worked out in the page from `firmware`, and the
board badge from the device's `board` (`""` before firmware 0.6.2). For attention and turn records
(§4.3.1, §5.11) the overview gives each device `attention` (`{"since": "<time>"}` while the bot waits
for the owner, else `null`) and gives `defaultBotId` (`""` for none); `PUT /api/default-bot` sets it,
`DELETE /api/devices/<id>/attention` clears attention, `GET /api/turns` lists the turn records (read
only while the Turns view is open, not every 2 s with the overview) and `GET /api/turns/export`
downloads them. For the bot's name (§4.3.2): `PATCH /api/devices/<id>` with `{"showBotName": true}`
(refused for firmware whose hello doesn't list `bot-name`), and the overview gives each device
`showBotName` and each bot `shownName` (its name in the characters a device can show, `""` for none).

### 5.9 Security
- Random 256-bit keys. Secrets are entered once and never shown again in full, and never logged.
- Nothing is reachable from the internet except through the tunnel; no home ports are opened.
- Transcripts and bot text are treated as data, never as commands to the bridge.
- The Listen page's WebSocket is refused unless its `Origin` is the page's own address, since the
  browser's same-origin rules don't cover WebSockets (§5.10).
- `.env`, the data volume, backups and `private/` are git-ignored from the first commit.

### 5.10 The Listen page: hearing the bot on a computer *(built 13 Nov 2026, milestone M7)*

For when the bot should be heard through a computer, with headphones or better speakers, rather than
from the device. The Grok Bot app's documentation describes no reading aloud of typed replies, so this
is also the way to hear them on headphones.

- **What it is:** a page the bridge serves next to the admin page (`/listen`, same hostname, same
  Cloudflare Access login). Open it in a tab on a computer, or on a phone, and it plays the bot's
  speech. It shows the bot's avatar and state as the device shows them (the admin page's preview, with
  a "speaking" state), a **Stop** button, and a link back to the admin page. It is a second entry of
  the admin page's build (`bridge/admin/listen.html`), with the same theme and components.
- **Listening:** while the owner holds the device to talk, the page (and the device's card in the
  admin page) shows "listening", with the device's listening look: eyes wide in a thick ring that
  swells and fades. It starts at `listen.start` and lasts until the turn moves on: "thinking" once
  the message goes to the bot, or back to what it showed before on a `listen.cancel`, when what was
  heard is too short to send, or when the device drops. The device itself is never sent "listening":
  it shows its own listening face while held.
- **Where speech goes:** a setting per device in the admin page, **Speak on**: *the device* (the
  default), *the Listen page*, or *both*. When it is set to the Listen page but no page is ready, the
  device speaks, so nothing is lost. Where each clip plays is decided when it starts, so a change (Speak
  on, a page started or closed, the device going offline) applies from the next clip; Stop and Mute
  are the exceptions, and end the clip playing.

  | Speak on | A Listen page ready | The device | Plays on |
  |---|---|---|---|
  | the device | either | online | the device |
  | the device | either | offline | nowhere yet: speech waits for the device (up to 5 clips, as in §5.7) |
  | the Listen page | yes | online or offline | the page; a device online shows "speaking" |
  | the Listen page | no | online | the device |
  | the Listen page | no | offline | nowhere yet: speech waits for the device or a ready page, whichever comes first |
  | both | yes | online | the device and the page, in step |
  | both | yes | offline | the page (nothing is kept for the device: it was heard) |
  | both | no | online | the device |
  | both | no | offline | nowhere yet: as for the Listen page |

  Muted: nowhere, whatever the rest. A clip with two places is **played** once both have played it
  (each answers `played`, or the bridge stops waiting 3 s after its length); the next clip waits for
  both. It is **stopped** when the owner stops it in either place, and then it stops in both. A place
  that drops out (the page closed, the device went offline) stops there and the other carries on.
  History says where each clip was sent ("Speaking on the Listen page for Desk."), and adds a line in
  the rare case that this changed while the clip waited for the one before.
- **Which device:** the page plays for one device, picked on the page (or given in its address,
  `/listen?device=<id>`, which the admin page's link uses) and remembered in that browser. With one
  device there is nothing to pick. If several pages are ready for the same device, the one started last
  plays and the others show "playing elsewhere" with **Play here**; when it closes, the one started
  before it plays again. A page that only reconnected doesn't take over from one started since.
- **Starting sound:** browsers play sound only after a click on the page, so it opens with **Start
  listening**, and doesn't count as ready until that click. After it, speech plays as long as the tab
  is open, in the background too: each piece of audio is scheduled on the Web Audio clock as it
  arrives, with no timers in the way (browsers slow timers in background tabs, not the audio clock).
  If the browser pauses the page's sound, the page tells the bridge it isn't ready, so the device
  speaks. Phones may pause a page when the screen locks, so on a phone it is best effort; a browser that
  puts inactive tabs to sleep (Chrome's Memory Saver, Edge's sleeping tabs) should be told to keep the
  admin hostname active.
- **Stop listening** turns the page off again, without closing the tab or changing Speak on: the page
  stops being ready, as if it were closed (the clip it was playing stops there, and with Speak on set
  to both, the device carries on with it), the device speaks from the next clip (or the page started
  before it, if one is still ready), and Start listening comes back. It is set apart from **Stop**,
  which cuts the speech short everywhere and leaves the page ready.
- **How the audio gets there:** a WebSocket on the admin port (`/listen/ws`, checked like the admin
  API, below) carries the messages the device gets: `show`, `play.start`, 24 kHz PCM frames,
  `play.end` and `stop`. The page answers `played` and `stop`, and plays the audio with the Web
  Audio API. The error tone goes the same way. The messages (`bridge/src/protocol.ts`):
  - page → bridge: `listen` (`{"type":"listen","device":"<id>","ready":false}`: which device it
    plays for; `ready: true` after a reconnect, when Start listening was pressed before; `ready: false`
    after Stop listening, or while the browser pauses its sound), `start` (Start listening or Play
    here), `played` (`{"type":"played","id":"<clip>"}`) and `stop`;
  - bridge → page: `status` (the devices to pick from, each with its bot, online, muted, Speak on,
    whether a page is ready for it, its board, and `shown_name`: the bot's name as the device shows it
    under its face, `null` when it shows none, §4.3.2; the device this page plays for; and its role:
    `off`, `here` or `elsewhere`), `show` (what the device shows, `speaking` while the desk speaks anywhere, or
    `listening` while the owner holds the device: `{"type":"show","state":"listening"}`), the audio
    messages above, and `error`.

  The page reconnects by itself (after 1, 2, 4, 8, then every 15 s) and says when it can't reach the
  bridge.
- **Checks:** `/listen` and `/listen/ws` pass the admin page's checks (this computer only, or a
  Cloudflare Access login checked again by the bridge). A WebSocket isn't held to the browser's
  same-origin rules, so the bridge also refuses an upgrade whose `Origin` isn't the page's own address
  (cross-site WebSocket hijacking). Behind Access, the socket closes when the login ends, as the next
  request would be refused; the page then asks to reload.
- **The device meanwhile:** it still shows thinking, working and waiting. While the page plays, the
  bridge shows "speaking" on the device, then its resting state when the page reports the clip done.
  Speaking without audio is a steady pulse (firmware 0.6.1). The bridge asks only devices whose hello
  lists the `speaking` feature (§5.3); older firmware keeps showing its resting state meanwhile, and a
  tap on it doesn't stop the page (holding it does). *(Later: the voice level sent along, so the pulse
  follows the voice.)*
- **Attention** (§4.3.1): the page shows it with the device's look whatever the device's firmware,
  plays its chirp when the device's speech plays there, and starts its tab's title with "(!)" while
  it lasts.
- **The bot's name** (§4.3.2): while the device shows it, the page's avatar shows it too, where the
  device does; the page's heading has the name as typed.
- **Stopping:** a tap on the device, or holding it to talk, stops speech wherever it plays. So does
  the page's Stop button, from any page for that device. A hold also drops the clips queued behind
  it, the page's too (§4.4). Stop listening stops speech only in its own tab, as it takes the page out
  (above).
- **Mute** silences speech everywhere, and switching it on ends the clip playing. The device's volume
  slider sets the device only; the page uses the computer's volume.
- **Device offline:** with Speak on set to the Listen page (or both), the page still plays while the
  device is offline.

### 5.11 Turn records: what the bot called, checked *(agreed 19 Nov 2026, milestone M11)*

The desk shows and speaks only what the bot sends it, and a bot doesn't always follow its standing
instructions. A turn record makes what it actually did visible: for each turn, its desk calls in
order with their times, checked against what the instructions ask (`docs/grok-bot-setup.md`, step 2).

**A turn** is the bot's work on one message, per bot:
- **Voice turn:** opens when the bridge posts the webhook. Its calls carry its `request_id`. A call
  from the same bot without the `request_id` while it is open joins it too, marked as missing it.
- **Typed turn:** the bridge doesn't see typed messages, only the bot's calls, so it groups them. A
  typed turn opens at the bot's first call when none of its turns is open. It closes at
  `desk_status("idle")`, 30 s after a `desk_say` or a "waiting" with no call since, or 10 minutes
  after its last call (when the status left showing expires). A "thinking" after a reply or a
  "waiting" starts a new turn: the owner has answered.
- **Open checks:** while a turn is open, a check that depends on what is still to come ("ended",
  "question spoken") shows as pending; it passes or fails when the turn closes.
- **Limits:** grouping by time can merge two quick typed messages if the bot skips "thinking" on the
  second, and splits a turn whose bot speaks a progress update and then works on for more than 30 s
  (the second part starts without "thinking"). A typed turn starts at the bot's first call, not when
  the message was typed, which the bridge never sees. Voice turns are exact.

**What it records**, each event with its time from the turn's start:
- the webhook (voice turns): the `request_id` and the transcript's length;
- each `desk_status` (its state) and each `desk_say` (characters written, characters spoken after
  the cleanup of §5.6, whether it carried the `request_id`, and what the bridge answered: where it
  speaks, or why not), each with how it found its bot (§5.5: `request_id`, `device`, `bot`, the only
  bot, or the default bot);
- calls the bridge refused or that failed, with the bridge's answer;
- its speech: where it played, when it started (its first audio going out, so the speech service's
  own delay counts), how long it played, and whether it played to the end, was stopped, or was
  dropped by a hold to talk (§4.4);
- attention starting or ending (§4.3.1).

No text is kept, only lengths. The admin page shows a reply's text from the History entry it links
to, while History still has it.

**Checks.** Each passes, fails, or doesn't apply. A failure is a flag: it never blocks anything.

| Check | Passes when | Standing instruction |
|---|---|---|
| thinking first | the bot's first call was `desk_status("thinking")` | 1: "When you start, call desk_status with state "thinking"" |
| ended | the turn ended with `desk_say` or "idle" (fails when it left a status showing, which then expired, or a voice message got no reply) | 4 and 5 |
| request_id | every call carried the voice turn's `request_id` (voice turns only) | 4, and the routine's "Pass the request_id in every desk call" |
| question spoken | a `desk_say` came in the same turn as "waiting" (turns with "waiting" only; one that came before the "waiting" counts, with a note) | 3: "call desk_status with state "waiting", then ask me" |
| no repeats | no call came more than twice in a row with the same arguments (the same state, or the same text: compared while the turn is open, never kept) | "Never call the same desk tool more than twice in a row" |
| no errors | the bridge refused or failed none of its calls | (none: a refused call means the desk missed something) |

Two things are noted rather than checked, since the bridge can't know them: whether "working" came
(it should if the bot used tools), and a call that found its bot only as the default (§5.5), which
may have been another bot's.

**Timings:** for a voice turn, from the webhook to the first call and to the reply; for a typed turn,
from the first call to the reply; from the reply to its speech starting; how long the speech played;
the whole turn.

**Where it shows:** History's **Turns** view (§5.8). Each turn shows its time, bot, typed or voice,
length, its checks (all passed, or the flags in words) and its calls in order with their times.
**Export** downloads the turns shown as JSON, with a summary (turns; how many passed and failed each
check; the median, lowest and highest of each timing), for test notes.

**Kept** in `turns.json` next to `state.json`: the turns of the last 30 days, and never more than the
latest 500, whichever is fewer. Older ones are dropped whenever a turn is added and when the bridge
starts. A bridge without the file starts with none, a file it can't read is set aside
(`turns.json.unreadable`) and started afresh, and older bridges ignore it.

**Privacy:** records and exports hold no text, but they name the bots and devices: they stay on the
bridge and the owner's computer. What goes into the repository from them is counts and timings.

A record (the export has the same, plus the summary):

```json
{
  "id": 42, "bot": "Test Bot", "kind": "typed", "devices": ["Desk"],
  "start": "2026-11-20T14:02:11.120Z", "end": "2026-11-20T14:02:52.320Z",
  "events": [
    { "ms": 0, "call": "desk_status", "state": "thinking", "via": "bot", "ok": true },
    { "ms": 4100, "call": "desk_status", "state": "working", "via": "bot", "ok": true },
    { "ms": 27300, "call": "desk_say", "chars": 212, "spoken": 188, "request_id": false, "via": "bot",
      "ok": true, "answer": "Speaking on Desk.", "history": 1311 },
    { "ms": 27700, "speech": "started", "place": "device" },
    { "ms": 41200, "speech": "played", "audio_ms": 13400 }
  ],
  "checks": { "thinking_first": "pass", "ended": "pass", "request_id": "n/a",
              "question_spoken": "n/a", "no_repeats": "pass", "no_errors": "pass" },
  "notes": [],
  "timings": { "reply_ms": 27300, "speech_wait_ms": 400, "speech_ms": 13400, "total_ms": 41200 }
}
```

---

## 6. Grok Bot setup (each step done by the owner, or with the owner's OK)

1. **Custom MCP server:** the bridge's `/mcp` URL with the `Authorization` header. It is added by asking
   the bot in chat, and the app shows a confirmation card. MCP servers are shared by every bot on the account.
2. **Standing instructions**, as a skill "Desk display" turned on for the bot, or in the bot's memory
   (skills live in one library shared by every bot, so a bot may save them to its memory instead; the
   first bot connected did): report `desk_status` while working, and call `desk_say` with every reply
   it writes. They also state the reply style (concise, speakable). The first bot on the bridge needs
   nothing more; each bot added after it passes its name in every desk call (§5.5).
3. **Routine "Desk voice"** with a webhook trigger on the bot: its instructions say the text is the
   owner speaking, to treat it exactly like a typed message, to confirm before anything destructive (an
   STT error could mean a misheard command), and to answer with `desk_say` passing the `request_id`. The webhook URL and key go
   into the admin page.

The exact texts are kept in `docs/grok-bot-setup.md`. All three steps work with Grok Bot; the M2
measurements (context, reliability, timing) are still to be taken.

---

## 7. Repository

- **Public on GitHub** (github.com/e-roy/grok-puck) since 9 November 2026, **MIT** for everything
  (code, docs, 3D files). Code derived from other projects keeps its licence notice in
  `THIRD_PARTY_NOTICES.md`; what the releases and the installer page contain has its own notices
  (`firmware/NOTICES.md`, `installer/NOTICES.md`).
- **Personal notes, research and screenshots** live in `private/` and `CLAUDE.local.md`, both
  git-ignored, so none of it enters the history.
- **Nothing personal, ever, in the repo or its history:** no names, emails, domains or hostnames, home
  network addresses, Wi-Fi names, device IDs or MAC addresses, local paths, logs or screenshots of real
  setups. A script (`scripts/check-private.mjs`) looks for the patterns in a git-ignored list
  (`private/denylist.txt`: the owner's name, email, domain, home address range, network names, device
  IDs) and for anything that looks like a key or token. It runs locally, in two git hooks: pre-commit
  checks the files being committed, pre-push checks each pushed commit (message, names and emails, and
  every line it adds). It doesn't run in CI: whatever reaches a pushed commit is already published.
- **Pull requests run CI** (`.github/workflows/ci.yml`), four checks that main's ruleset requires:
  **bridge** (type check, tests, admin page build), **docker** (the bridge image builds), **firmware**
  (the ESP-IDF build of every board, one after the other) and **installer** (its tests, then packaging
  those builds as a release would). Releases: §4.7.
- **Supply chain:** pnpm only, packages at least 7 days old and no install scripts; firmware
  components pinned to exact versions; GitHub Actions pinned to full commit SHAs of releases at least 7
  days old, from GitHub, pnpm and Espressif only.
- Layout: `firmware/`, `bridge/` (server, admin page, a fake device and a fake Grok Bot for tests),
  `installer/` (the web installer page and the script that packages a firmware build),
  `hardware/` (one folder per device, named like its board: BOM, STL, OpenSCAD `.scad` sources,
  photos), `docs/`, `scripts/` (the privacy check).
- Placeholders only (`desk.example.com`).

---

## 8. Build order

| | Milestone | Done when | Status |
|---|---|---|---|
| M1 | Bridge core running locally with a **fake device** (a script that talks the device protocol), a **fake Grok Bot** (receives the webhook, answers through MCP) and a first admin page | fake device: approve, say hello via TTS, voice message via STT → webhook → reply played | done |
| M2 | Bridge deployed on the always-on host with tunnel and Access; **first connection to Grok Bot** (MCP, skill, routine) | typed chat → status and speech reach the fake device; voice message acts like typed; timings logged; spec updated with what we learn | the connection works: the MCP server, the standing instructions (saved in the bot's memory) and the voice routine; typed and spoken turns reach the desk. The MCP call doesn't identify its bot (§5.5). Measured with M11's test script on a test bot (20 Nov 2026): reliability (every check passed on messages 1 to 9) and timing (spoken replies 8 to 11 s after the webhook). Still to test: whether a routine run sees the typed chat, ten messages in a row, and the app's voice chat |
| M3 | Firmware: display, touch and face on the board, offline; audio in/out check | avatar animates through all states from a test menu; tap and hold work; mic level and a tone work | done |
| M4 | Device ⇄ bridge: setup hotspot, approval, config, states, playback | the bot's replies are spoken on the real device | done |
| M5 | Listening: hold-to-talk, voice level, STT, full voice turn | hold, speak, let go, the bot acts, the reply is spoken | done |
| M6 | Polish: avatar shapes matched to the app, dimming, mute, errors, docs for the public release | ready to make public | partly: the docs for the public release are done and the repo is public; errors are done (a failed step or no answer shows the error face and plays a tone); mute works in the bridge (no speech or tones reach a muted device), but the face has no "muted" mark yet. Screen dimming and matching the avatar shapes to the app are still open |
| R | When the code is mature: move personal and research files to `private/`, clean up `CLAUDE.md` and the docs, create the repo | first commit contains nothing personal | done (9 Nov 2026) |
| M7 | Listen page (§5.10) | with Speak on set to the Listen page, a typed chat reply plays in the browser tab while the device shows "speaking"; a tap on the device stops it; with no page ready, the device speaks | built (bridge, Listen page, firmware 0.6.1): tested with the fake device and the fake Grok Bot, in Chrome (a background tab too), and on the board with a local bridge (the steady pulse while the page plays, a tap or a hold stops the page, both places together). v0.6.1 is to be released, and a typed reply through the real Grok Bot to be checked with it |
| M8 | xAI as a speech service (§5.6.1) | the device speaks with an xAI voice, a voice message is transcribed by xAI, and the tests pass against a fake xAI server | planned, not built |
| M9 | Firmware releases and the web installer (§4.7) | "Release firmware" publishes `v<version>` with the four parts, the manifest and the notices; the installer page on GitHub Pages installs it from the browser and the device keeps its settings; **Erase device** gives a clean start | released: v0.6.0 on 13 Nov 2026 |
| M10 | Boards and what they can do (§4.8): a board layer, and the AMOLED-1.8 as a second board | the AMOLED-1.8 shows the face, speaks and listens through a bridge, and is set up from a phone; the LCD-1.46 works as before; CI and a release build both boards; the installer page installs either from its own button | built (firmware 0.6.2): the AMOLED-1.8 (V2) works with real speech on the always-on bridge; the LCD-1.46's hardware check is still to come before the v0.6.2 release. Boards without a speaker or a microphone are described, not built |
| M11 | Turn records and attention (§5.11, §4.3.1) | the test script in `docs/grok-bot-setup.md` runs on a second bot on the always-on bridge, its turns show the calls, checks and timings, and the results are written up; attention starts, outlasts the old 10-minute expiry and ends with the next message, on both boards, and the first bot's replies reach its desk throughout | built (firmware 0.6.3): the test script's messages 1 to 9 ran on a test bot on the always-on bridge on 20 Nov 2026 with every check passed, attention held 15 minutes and ended with the next message on the AMOLED-1.8, and the first bot's desk stayed its own (results in `docs/grok-bot-setup.md`). The LCD-1.46's hardware check is still to come before the v0.6.3 release |

M1 and M2 came first so that any surprise on the Grok Bot side showed up before the firmware was far
along. M7, M8, M9 and M10 don't depend on each other, so any can come first.

## 9. Risks and open points

| Risk | Plan |
|---|---|
| Routine runs may not see the ongoing chat, so voice answers lose context | still to test (the 20 Nov 2026 run didn't show it: its typed message held the spoken question too); fallback: `recent` in the webhook body |
| The bot may not always follow the skill (missed status or missed speech) | turn records check every turn (§5.11). On a test bot (20 Nov 2026) every check passed on the test script's messages 1 to 9; the routine's first run skipped "thinking" once (1 of 3 spoken turns), which the bridge's own "thinking" covers. Tighten the skill text if the records show misses |
| A voice turn takes a while (another project measured 30–40 s) | measured 8–11 s from the webhook to the reply on a test bot (20 Nov 2026); clear "thinking" animation; timings in the history and the turn records to tune the bot's instructions |
| The MCP call doesn't identify the calling bot (confirmed 19 Nov 2026: every call looks the same) | bots after the first pass their name; calls without one go to the default bot (§5.5), and turn records note it |
| Adding a second bot used to cut off the first bot's typed replies (unnamed calls were refused) | the default bot is set when a second bot is added (§5.5) |
| A call from a second bot (such as a test bot) that forgets its `bot:` line goes to the default bot, so its words reach the first bot's desk; nothing in a call identifies the bot, so the checks can't catch it (the turn shows up as the default bot's, noted as found by default) | each later bot's instructions name it; while testing, watch that the first bot's desk stays quiet |
| Typed turns are grouped by time, so two quick messages can merge or a long turn split | voice turns are exact; the limits are stated with the records (§5.11), and "thinking first" keeps typed turns apart |
| Attention that never ends, if the bot never calls again after asking | it ends with the owner's next message, or **Clear** on the device's card (§4.3.1) |
| An OLED could wear where the "!" badge stays lit for hours | the badge moves with the hop and the drift (§4.8); dimming comes in M6 |
| Exact avatar shapes and colours of the app | match by eye in M6 using the admin preview |
| STT quality | provider is configurable; the speech server's STT for testing only |
| Grok Bot app changes | only documented routes are used (webhook, custom MCP, skills) |
| The bot may call the desk tools during the app's voice chat, so the device talks over the call | test in M2; mute the device during calls |
| xAI's TTS docs show two answer formats (JSON with base64 audio, and a plain audio body) | accept both; check with a real key in M8 |
| xAI speech is billed per use, outside the Grok Bot plan | opt-in; the prices are stated in the admin page's Speech card and here |
| Browsers block sound until the page is clicked; phones may pause a page | the Listen page counts as ready only after a click, and not while the browser has paused its sound; otherwise the device speaks |
| A browser may put a Listen tab left in the background to sleep (Chrome's Memory Saver, Edge's sleeping tabs) | the setup guide says to keep the admin hostname active; a page that comes back asks for Start listening again, and the device speaks meanwhile |
| An install could wipe the device's settings | the installer writes the four parts separately and never NVS; the packaging script refuses any build that would reach into another partition, in every pull request and every release |
| Not every browser can install (Web Serial) | the installer offers Install only where it works and says which browser to use otherwise; tested in Chrome (Edge shares its engine); Firefox 151+ is not tested yet |
| A published release built from the wrong files | releases are built only by the release workflow, from `main`, in the pinned ESP-IDF container; a version is never released twice |
| Someone installs the other board's firmware | one button per board, with its name and a photo; the packaging script refuses a build packaged as the wrong board; a wrong install leaves the screen dark, and installing the right one fixes it |
| An AMOLED wears where pixels stay lit (burn-in) | on OLED boards the face drifts slowly (§4.8); dimming when idle comes in M6 |
| The bot's name, shown all day on an OLED, wears the panel | it drifts with the face and is grey, about a third of white's brightness (§4.3.2); dimming comes in M6 |
| A bot's name in letters the device's font lacks (accents, other scripts, emoji) | the bridge takes accents off and leaves out the rest; the admin page says how the name shows, or that it can't (§4.3.2) |
| A board revision that can't be tested here (the AMOLED-1.8's V1) | it is told apart by its touch chip, as in Waveshare's examples, and uses Waveshare's display commands; it is marked untested until someone tries one |
