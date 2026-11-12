# Grok Puck

A desk display for Grok Bot: a small round touch screen that **is** one of your Grok Bots, sitting on
your desk:

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

**[Set up your own](docs/setup.md)**: one guide, in order, from the parts to a desk display that talks:

1. the parts, and printing the case and stand;
2. the bridge on an always-on machine with Docker, behind a Cloudflare Tunnel;
3. the speech services and your bot, in the bridge's admin page;
4. the device: flashing it, its Wi-Fi from your phone, approving it;
5. connecting Grok Bot;
6. talking to it.

To try it before buying anything, the bridge comes with a fake device and a fake Grok Bot:
[bridge/README.md](bridge/README.md#try-the-whole-loop-without-hardware-or-grok-bot).

## Hardware

- Waveshare **ESP32-S3-Touch-LCD-1.46** (with cover glass): 1.46" 412×412 round touch display,
  microphone, speaker, ESP32-S3 with Wi-Fi.
- A right-angle USB-C cable for power.
- A printed case and a 15° desk stand (PLA).

Full BOM, print settings and the OpenSCAD sources: [hardware/](hardware/).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). In short:
- enable the privacy check once per clone (`git config core.hooksPath .githooks`);
- behaviour changes start in the spec;
- every pull request must pass three checks: bridge, docker and firmware.

## Licence

MIT ([LICENSE](LICENSE)), for the code, the docs and the 3D files. Third-party code:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
