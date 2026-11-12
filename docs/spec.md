# Spec: Grok Bot desk display

**Status: v0.1 (24 Oct 2026) is mostly built; the README says what works.** New, for approval
(12 Nov 2026): **xAI as a speech service** (§5.6.1) and the **Listen page** for hearing the bot on a
computer (§5.10). Items marked *(proposal)* are suggestions you can change; items marked *(to test)*
depend on how Grok Bot actually behaves, and get checked at milestone M2.

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
  page.
- Grok Bot setup texts: the MCP server entry, a skill with standing instructions, a routine with a webhook.
- Hardware: BOM, case and stand (STL + OpenSCAD source).

**Not in v1**
- Firmware updates over Wi-Fi (USB flashing only at first).
- A wake word, a battery, or text captions on the screen.
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
   which plays it with the "speaking" animation.

**B. You answer by voice**
1. Hold the screen → you speak → let go. The device streams the audio to the bridge while you hold.
2. The bridge transcribes it (STT) and POSTs it to the bot's routine webhook. HTTP 200 only means "run
   started". The device shows "thinking" right away.
3. The routine run acts on it like a typed message, then replies through `desk_say(text, request_id)`,
   and the flow continues as in A.3.

**Timing to expect.** One open-source project measured **30 to 40 s** from webhook to the bot's reply
(two samples, transcription under 1 s). The device must look clearly "busy" for that long.

---

## 4. Device

### 4.1 Hardware
- Waveshare **ESP32-S3-Touch-LCD-1.46** (cover-glass version): ESP32-S3R8 (8 MB PSRAM, 16 MB flash),
  1.46" 412x412 round display, SPD2010 controller over QSPI, SPD2010 touch over I2C, I2S microphone,
  PCM5101 DAC + amplifier + onboard speaker, QMI8658 motion sensor, TCA9554 I/O expander.
- USB-C power only. Slim printed case and a 15° desk stand; a right-angle USB-C cable runs out the back.
- Pins are in Waveshare's documentation; board bring-up follows Waveshare's examples. Note: the SPD2010
  needs every redraw area aligned to 4-pixel columns.

### 4.2 Firmware stack
- ESP-IDF 6.1 (in active service until about August 2027; 5.5 is in maintenance), C, LVGL 9, using
  the current drivers only (`i2c_master`, `i2s_std`, `esp_lcd`). Builds and flashes on Windows and macOS.
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
| listening | holding the screen | eyes wide, the ring swells and brightens with the voice level |
| thinking | bridge (after a voice message) or the bot | eyes look up, dots orbit the rim |
| working | the bot (`desk_status`) | faster orbit, eyes darting |
| waiting | the bot needs your approval | eyes on you, soft attention pulse |
| speaking | audio playing (or playing on the Listen page, §5.10) | body pulses with the audio level (a steady pulse when the audio plays elsewhere) |
| error | STT/TTS/webhook failure or no answer in 3 min | short shake, red tint, then idle |
| muted | the admin page | small "muted" mark, no audio |

The screen dims after a stretch with nothing happening and wakes on a touch or a message *(proposal:
10 min, adjustable)*.

### 4.4 Touch
**Hold to talk** is the only way to speak: letting go when finished is what a person expects. There
is no countdown and no silence timeout.

| When | Hold | Tap *(proposal)* |
|---|---|---|
| idle / dimmed | listen while held, send on letting go | wake; a small poke reaction |
| thinking / working / waiting | listen (a follow-up message) | small wiggle |
| speaking | stop speaking and listen | stop speaking |

- A press counts as a hold after **0.3 s**; a shorter touch is a tap. Recording starts at the touch
  itself, so a first word spoken while the hold is being counted isn't cut off; a tap sends nothing.
- Letting go with less than about **0.3 s of voice** sends nothing (an accidental touch).
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
- Volume is set in the admin page; the board's trimmer still works.

### 4.6 Setup and link
1. First boot, or after "forget Wi-Fi": the device starts its own Wi-Fi network (`Desk-Setup-XXXX`,
   WPA2 with a new random password each time) and shows a QR code to join it, plus the name and
   password. A phone that joins opens the setup page by itself (captive portal); there you pick the
   home Wi-Fi (2.4 GHz), type its password and the bridge address (`desk.example.com` through the
   tunnel, or `192.168.1.20:8787` on the home network).
2. The device joins Wi-Fi, connects to `wss://<bridge host>/device`, says hello (its ID from the MAC
   address, firmware version), and waits as **pending**.
3. In the admin page you approve it and attach it to a bot. The bridge issues a device key, which the
   device stores (NVS) and uses from then on.
4. If the link drops, it reconnects with backoff and shows "offline" meanwhile.

**Travelling: several saved networks.** The device remembers up to **5** Wi-Fi networks, so it can be
taken elsewhere and brought back without setting it up again.
- **Joining:** at start, or when Wi-Fi drops, it scans and joins the saved network with the strongest
  signal; if that fails it tries the next one. The network it joins moves to the top of the list.
- **Passwords stay on the device** (NVS). The bridge and the admin page only ever see network names.
- **The bridge address** should be the public one (`wss://desk.example.com/device`), so the device
  reaches its bridge from any network. A home-network address only works at home. Changing the
  address drops the device's key (a key belongs to one bridge); the new bridge asks for approval.
- **Networks it can join:** 2.4 GHz with a normal password (WPA2/WPA3 personal) or open. Networks with
  a sign-in web page (hotels, cafés) or a username and password (eduroam, work Wi-Fi) can't be joined:
  use a phone's hotspot there.

**The setup network opens** (`Desk-Setup-XXXX` with its QR code, as at first boot) when:
1. none of the saved networks is joined within about a minute of starting or of losing Wi-Fi;
2. Wi-Fi works but the bridge can't be reached for **2 minutes** (a network that blocks it, or a wrong
   bridge address);
3. the admin page asks for it (**Wi-Fi setup** on the device's card): the device stays online meanwhile
   and closes the setup network after 10 minutes.

While it is open, the device keeps trying its saved networks (every 30 s, unless a phone is on the
setup network), so a router that comes back after a power cut is joined without help.

**The setup page** (on the phone that joined the setup network): nearby networks, with saved ones
marked; **Add** a network (the device joins it to check the password before saving it, and says so if
it can't); the saved networks, each with **Forget**; and the bridge address.

**The admin page** (device card → Wi-Fi): the saved network names, which one is in use and its signal;
**Forget** for each; **Wi-Fi setup** (opens the setup network, to add a network from a phone); and
**Forget all networks** (restarts straight into setup). Networks are added only on the setup page, so
Wi-Fi passwords never pass through the bridge.

No button or gesture on the device is used (holding BOOT while plugging in is download mode).

### 4.7 Flashing
- USB flashing from Windows or macOS, with scripts that run on both.
- No backup of the factory firmware is made. The way back to it is Waveshare's demo image
  (`Firmware/ESP32-S3-Touch-LCD-1.46.bin` in their examples repo).
- ESP-IDF builds go to a folder outside any cloud-synced directory: a build makes thousands of files.

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
| Listen page + `/listen/ws` *(proposal, §5.10)* | you, on a computer or phone | as the admin page (same port, same checks) |
| `/healthz` | monitoring | none, reports nothing private |

### 5.3 Device protocol (implemented in `bridge/src/protocol.ts`)
One WebSocket per device: JSON control messages plus binary audio frames.
- Device → bridge:
  - `hello` (device id, firmware version, its key once approved);
  - `listen.start`, then microphone frames (16 kHz PCM), then `listen.end` or `listen.cancel`;
  - `played` (a clip finished or was stopped);
  - `stop` (the owner touched the screen to stop speech);
  - `state` (informational).
- Bridge → device:
  - `pending` (waiting for approval);
  - `welcome` (the device key, on approval);
  - `config` (name, bot avatar, volume, mute, longest message);
  - `show` (state to display);
  - `play.start`, then audio frames (24 kHz PCM, sent about 1 s ahead of real time), then `play.end`;
  - `stop`;
  - `wifi.forget` (from the admin page: forget the Wi-Fi network and open setup);
  - `error`.

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

A spoken reply ends "thinking" and "working"; "waiting" stays, because the reply may be the question.

Without `device`, a call goes to every device attached to the calling bot. A call that names a device
attached to a different bot is refused. **(to test)** whether the MCP call tells the bridge which bot is
calling. If it doesn't, the skill's instructions pass the bot's name, and the bridge checks it against
its list.

### 5.6 Speech
- **Two services, chosen separately.** Text to speech (TTS) and speech to text (STT) each have their
  own entry in the admin page, so they can come from different places: for example a self-hosted
  voice and a hosted transcriber. Each entry has a service type:
  - **OpenAI-compatible:** base URL, key, model. Covers the Kokoro speech server, OpenAI, Groq and
    others. TTS uses `/audio/speech` with `response_format: pcm` (24 kHz), streamed to the device as
    it arrives; STT uses `/audio/transcriptions`.
  - **xAI** *(proposal, §5.6.1)*: xAI's own speech API, with only a key.
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

#### 5.6.1 xAI as a speech service *(proposal, not built)*

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
- Device offline: spoken messages wait in a small queue *(proposal: 5 per device)*; states are not
  queued.
- No reply within 3 minutes of a voice message: error state and a short tone. A late reply is still spoken.
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
- the bot's avatar showing what the device shows (idle, thinking…), online or last seen, firmware;
- name (edited in place), bot, volume (slider), mute (switch), longest message;
- **Speak on** *(proposal, §5.10)*: the device, the Listen page or both, and whether a Listen page is
  ready for it, with a link to open one;
- **Try it:** a sentence to speak, with the last few used; showing a state is in a small Test menu;
- **Wi-Fi:** its saved networks, Forget for each, and Wi-Fi setup (§4.6);
- at the bottom, set apart: **Forget all networks** and **Forget**, each confirmed in a dialog that
  says what will happen.

**Bots.** A card per bot:
- **Look:** shape as a row of previews to click, colour as swatches plus a picker; the preview is
  what the device draws;
- **Voice:** a searchable list grouped by language and gender (Kokoro names say both: `af_` is
  American English, female), each with a play button;
- **Grok Bot routine:** webhook URL, key (write-only), "send the last few exchanges", Send a test
  message;
- Save is enabled when something changed; edits survive switching sections, and leaving or reloading
  the page with unsaved changes asks first. Add bot is a small dialog asking for the name.

**Speech.** A card each for text to speech and speech to text: service (OpenAI-compatible, or xAI:
§5.6.1), base URL, key (write-only), Find models → model list, and a status line (connected, or what
went wrong). Text to speech has
**Play a test sentence** in the browser; speech to text has the language.

**Grok Bot.** The MCP URL and the header with copy buttons; the key is created or replaced through a
dialog and shown once, with Copy. The setup steps of §6 as a checklist with copyable texts (filled in
M2). Recent MCP calls as a short list (time, tool, client); the technical details fold open.

**History.** Filters (all, voice, spoken, errors; by device). Each entry has its time, kind, text and
outcome; its timings are a small bar split into speech, STT, webhook and bot reply, so slow steps
stand out. Errors are red.

**Feedback.** Every action answers with a toast next to where you are: successes fade, errors stay
until closed. Confirmations are dialogs, not the browser's `confirm`. The page refreshes itself every
2 s without disturbing a field being edited.

**Quality bar.** Every control has a label and works from the keyboard; text contrast meets WCAG AA in
both themes. Checked with Chrome DevTools at 1280 and 390 px wide, light and dark, with no console
errors.

The admin API stays as it is; anything new on the page is worked out in the page.

### 5.9 Security
- Random 256-bit keys. Secrets are entered once and never shown again in full, and never logged.
- Nothing is reachable from the internet except through the tunnel; no home ports are opened.
- Transcripts and bot text are treated as data, never as commands to the bridge.
- `.env`, the data volume, backups and `private/` are git-ignored from the first commit.

### 5.10 The Listen page: hearing the bot on a computer *(proposal, not built)*

For when the bot should be heard through a computer, with headphones or better speakers, rather than
from the device. The Grok Bot app's documentation describes no reading aloud of typed replies, so this
is also the way to hear them on headphones.

- **What it is:** a page the bridge serves next to the admin page (`/listen`, same hostname, same
  Cloudflare Access login). Open it in a tab on a computer, or on a phone, and it plays the bot's
  speech. It shows the bot's avatar and state, drawn as on the device (the admin page already draws
  that preview), and a **Stop** button.
- **Where speech goes:** a setting per device in the admin page, **Speak on**: *the device* (the
  default), *the Listen page*, or *both*. When it is set to the Listen page but no page is ready, the
  device speaks, so nothing is lost.
- **Which device:** the page plays for one device, picked on the page and remembered in that browser.
  With one device there is nothing to pick. If several pages play for the same device, the one started
  last plays and the others show "playing elsewhere".
- **Starting sound:** browsers play sound only after a click on the page, so it opens with **Start
  listening**, and doesn't count as ready until that click. After it, speech plays as long as the tab
  is open, in the background too. Phones may pause a page when the screen locks, so on a phone it is
  best effort.
- **How the audio gets there:** a WebSocket on the admin port (`/listen/ws`, checked like the admin
  API) carries the same messages the device gets: `play.start`, 24 kHz PCM frames, `play.end` and
  `stop`. The page answers `played` and `stop`, and plays the audio with the Web Audio API. The error
  tone goes the same way.
- **The device meanwhile:** it still shows thinking, working and waiting. While the page plays, the
  bridge shows "speaking" on the device, then "idle" when the page reports the clip done. Speaking
  without audio is a steady pulse, which takes a small firmware change. *(Later: the voice level sent
  along, so the pulse follows the voice.)*
- **Stopping:** a tap on the device, or holding it to talk, stops speech wherever it plays. So does
  the page's Stop button.
- **Mute** silences speech everywhere. The device's volume slider sets the device only; the page uses
  the computer's volume.
- **Device offline:** with Speak on set to the Listen page, the page still plays while the device is
  offline.
- **Later, not in this step:** hold-to-talk on the page with the computer's microphone (hold a button
  or the space bar), through the same STT and webhook. With it, the page would work as a desk without
  the device, for example on a laptop when travelling.

---

## 6. Grok Bot setup (each step done by the owner, or with the owner's OK)

1. **Custom MCP server:** the bridge's `/mcp` URL with the `Authorization` header. It is added by asking
   the bot in chat, and the app shows a confirmation card. MCP servers are shared by every bot on the account.
2. **Skill "Desk display"**, turned on for the bot: standing instructions to report `desk_status` while
   working, and to call `desk_say` with every reply it writes. It also states the reply style (concise,
   speakable).
3. **Routine "Desk voice"** with a webhook trigger on the bot: its instructions say the text is the
   owner speaking, to treat it exactly like a typed message, to confirm before anything destructive (an
   STT error could mean a misheard command), and to answer with `desk_say` passing the `request_id`. The webhook URL and key go
   into the admin page.

The exact texts are written in M2 and kept in `docs/grok-bot-setup.md`.

---

## 7. Repository

- **Local first.** No git repository until the code is mature: everything is built and tested as
  local files, at least through the first connection to Grok Bot (M2).
- **Before the repo is created**, personal notes, research about other projects and the screenshots
  move to `private/`. That folder is git-ignored from the first commit, so none of it ever enters the
  history. The licence notices for code we derive from other projects stay public, because MIT
  requires them.
- **Nothing personal, ever, in the repo or its history:** no names, emails, domains or hostnames, home
  network addresses, Wi-Fi names, device IDs or MAC addresses, local paths, logs or screenshots of real
  setups. Checked automatically: a script scans every commit for the patterns in a git-ignored list
  (`private/denylist.txt`: the owner's name, email, domain, home address range, network names, device
  IDs) and for anything that looks like a key or token, and refuses the commit if it finds one. It runs
  as a git pre-commit hook from the first commit, so the history starts clean.
- **MIT** for everything (code, docs, 3D files).
- Layout: `firmware/`, `bridge/` (server, admin page, a fake device and a fake Grok Bot for tests),
  `hardware/` (BOM, STL, OpenSCAD `.scad` sources), `docs/`.
- Placeholders only (`desk.example.com`).

---

## 8. Build order

| | Milestone | Done when |
|---|---|---|
| M1 | Bridge core running locally with a **fake device** (a script that talks the device protocol), a **fake Grok Bot** (receives the webhook, answers through MCP) and a first admin page | fake device: approve, say hello via TTS, voice message via STT → webhook → reply played |
| M2 | Bridge deployed on the always-on host with tunnel and Access; **first connection to Grok Bot** (MCP, skill, routine) | typed chat → status and speech reach the fake device; voice message acts like typed; timings logged; spec updated with what we learn |
| M3 | Firmware: display, touch and face on the board, offline; audio in/out check | avatar animates through all states from a test menu; tap and hold work; mic level and a tone work |
| M4 | Device ⇄ bridge: setup hotspot, approval, config, states, playback | the bot's replies are spoken on the real device |
| M5 | Listening: hold-to-talk, voice level, STT, full voice turn | hold, speak, let go, the bot acts, the reply is spoken |
| M6 | Polish: avatar shapes matched to the app, dimming, mute, errors, docs for the public release | ready to make public |
| R | When the code is mature: move personal and research files to `private/`, clean up `CLAUDE.md` and the docs, create the repo | first commit contains nothing personal |
| M7 | *(proposal)* Listen page (§5.10) | with Speak on set to the Listen page, a typed chat reply plays in the browser tab while the device shows "speaking"; a tap on the device stops it; with no page ready, the device speaks |
| M8 | *(proposal)* xAI as a speech service (§5.6.1) | the device speaks with an xAI voice, a voice message is transcribed by xAI, and the tests pass against a fake xAI server |

M1 and M2 come first so that any surprise on the Grok Bot side shows up before the firmware is far
along. M3 can run in parallel. M7 and M8 don't depend on each other, so either can come first.

## 9. Risks and open points

| Risk | Plan |
|---|---|
| Routine runs may not see the ongoing chat, so voice answers lose context | test in M2; fallback: `recent` in the webhook body |
| The bot may not always follow the skill (missed status or missed speech) | measure in M2; tighten the skill text; the bridge's own states cover voice turns |
| 30–40 s per voice turn | clear "thinking" animation; timings in the history to tune the bot's instructions |
| The MCP call may not identify the calling bot | the skill passes the bot's name; the bridge checks it |
| Exact avatar shapes and colours of the app | match by eye in M6 using the admin preview |
| STT quality | provider is configurable; the speech server's STT for testing only |
| Grok Bot app changes | only documented routes are used (webhook, custom MCP, skills) |
| The bot may call the desk tools during the app's voice chat, so the device talks over the call | test in M2; mute the device during calls |
| xAI's TTS docs show two answer formats (JSON with base64 audio, and a plain audio body) | accept both; check with a real key in M8 |
| xAI speech is billed per use, outside the Grok Bot plan | opt-in; the prices are stated in the admin page's Speech card and here |
| Browsers block sound until the page is clicked; phones may pause a page | the Listen page counts as ready only after a click; otherwise the device speaks |
