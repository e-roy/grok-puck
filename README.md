# Grok Bot desk display

A small round touch screen that **is** one of your Grok Bots, sitting on your desk:

- it shows the bot's avatar (shape and colour as in the Grok Bot app), animated while the bot thinks
  and works;
- it **speaks everything the bot writes**, so you can follow it without keeping its window open;
- **hold it and speak** to answer, then let go: your words reach the bot as if you had typed them.

Grok Bot is the only "brain": there is no separate voice model or AI API to pay for. Speech-to-text and
text-to-speech come from any OpenAI-compatible service, including a self-hosted one.

An unofficial hobby project, not affiliated with or endorsed by xAI.

## How it works

```
Round screen  ⇄  bridge (your always-on machine, behind a Cloudflare Tunnel)  ⇄  Grok Bot
                      │                                                   webhook in, MCP tools out
                      └─ speech services (TTS, STT)
```

Grok Bot runs in the cloud: it can only take a webhook and call MCP tools on a public HTTPS address, and
the device sits on a home (or any) Wi-Fi. So a small **bridge** sits between them. It keeps one
connection to each device, turns speech into text and back, starts the bot's routine when you speak,
and gives the bot tools to speak (`desk_say`) and show what it is doing (`desk_status`). The full
design: [docs/spec.md](docs/spec.md).

## Status

| Part | State |
|---|---|
| [Bridge](bridge/) (TypeScript server + admin page) | working, with tests and a fake device / fake Grok Bot |
| [Firmware](firmware/) (ESP-IDF, Waveshare ESP32-S3-Touch-LCD-1.46) | working: Wi-Fi setup from a phone, approval, avatar and states, spoken replies, hold to talk. Next: several saved Wi-Fi networks |
| Grok Bot setup | working: MCP server, standing instructions and voice routine. Some checks still to run: [docs/grok-bot-setup.md](docs/grok-bot-setup.md) |
| [Case and stand](hardware/) (3D prints) | slim case and stand designed; an earlier larger case printed and fitting |

## Getting started

1. **The bridge** on an always-on machine with Docker, behind a Cloudflare Tunnel:
   [bridge/README.md](bridge/README.md).
2. **The device:** build and flash the firmware ([firmware/README.md](firmware/README.md)), then set it
   up from your phone: it opens a `Desk-Setup-…` Wi-Fi network with a QR code.
3. **Grok Bot:** connect it to the bridge: [docs/grok-bot-setup.md](docs/grok-bot-setup.md).

## Hardware

- Waveshare **ESP32-S3-Touch-LCD-1.46** (with cover glass): 1.46" 412×412 round touch display,
  microphone, speaker, ESP32-S3 with Wi-Fi.
- A right-angle USB-C cable for power.
- A printed case and a 15° desk stand (PLA).

Full BOM, print settings and the OpenSCAD sources: [hardware/](hardware/).

## Contributing

Enable the privacy check once per clone: `git config core.hooksPath .githooks`. It refuses
secrets and anything listed in your own `private/denylist.txt` (git-ignored), in two git hooks:
**pre-commit** checks the staged files, and **pre-push** checks the commits about to be pushed
(messages, names and emails, and what each commit adds, even if a later one removes it). See
[scripts/check-private.mjs](scripts/check-private.mjs). It runs locally only: whatever reaches a
pushed commit or a pull request has already been published.

Every pull request to `main` runs three checks ([.github/workflows/ci.yml](.github/workflows/ci.yml)):
**bridge** (type check, tests, admin page build), **docker** (the bridge image builds) and
**firmware** (the ESP-IDF v6.1 build for the ESP32-S3).

## Licence

MIT ([LICENSE](LICENSE)), for the code, the docs and the 3D files. Third-party code:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
