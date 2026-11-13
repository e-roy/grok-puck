# Set up your own Grok Puck

This guide takes you from the parts to a desk display that speaks for your Grok Bot and listens when
you hold it. Follow the steps in order: each one ends with a **Check**, so you know it works before
you go on. If something doesn't, see [Troubleshooting](#troubleshooting).

| Step | What you do | Where |
|---|---|---|
| [1. Parts and case](#1-get-the-parts-and-print-the-case) | buy the board and a cable, print the case and stand | your desk, a 3D printer |
| [2. The bridge](#2-run-the-bridge) | run the bridge in Docker behind a Cloudflare Tunnel | your always-on machine, Cloudflare |
| [3. Speech and your bot](#3-set-up-speech-and-your-bot) | choose the speech services, add your bot, pick its look and voice | the admin page |
| [4. The device](#4-flash-and-connect-the-device) | flash the firmware, set up its Wi-Fi from a phone, approve it | a computer with USB, your phone, the admin page |
| [5. Grok Bot](#5-connect-grok-bot) | add the MCP server, the standing instructions and the voice routine | the Grok Bot desktop app |
| [6. Talk to it](#6-talk-to-it) | type to your bot, then hold the screen and speak | your desk |

Then: [Keeping it running](#keeping-it-running) · [Troubleshooting](#troubleshooting) · [Costs](#costs)

**Want to try it before buying anything?** The bridge comes with a fake device and a fake Grok Bot
that run the whole loop on one computer: see
[Try the whole loop without hardware or Grok Bot](../bridge/README.md#try-the-whole-loop-without-hardware-or-grok-bot).

## What you need

- **A Grok Bot plan** and the Grok Bot **desktop app**: the routine's webhook details only show
  there.
- **A domain on Cloudflare** (its DNS managed by Cloudflare). Grok Bot runs in the cloud and can only
  reach the bridge at a public HTTPS address, which a free Cloudflare Tunnel provides without opening
  any port at home. In this guide the bridge is `desk.example.com` and its admin page
  `desk-admin.example.com`: use names under your own domain.
- **An always-on machine with Docker and git**, such as a Mac mini with Docker Desktop (tested), or a
  Linux machine. It runs the bridge.
- **A computer to flash the firmware**, with **ESP-IDF 6.1** (Windows, macOS or Linux) and a USB-C
  cable.
- **Speech services**: one turns the bot's text into speech (TTS), one turns what you say into text
  (STT). Any service with OpenAI's audio API works, for example OpenAI itself, Groq (speech to text),
  or a self-hosted server such as Kokoro (text to speech) or Speaches. TTS and STT can come from
  different services. You can start with the built-in **Mock** (beeps instead of speech, a fixed
  transcript) and choose later.

---

## 1. Get the parts and print the case

The parts list, with where to buy them, is in [hardware/README.md](../hardware/README.md#bill-of-materials):
the **Waveshare ESP32-S3-Touch-LCD-1.46** (the cover-glass version), a right-angle USB-C cable, a 5 V
USB power supply, three M2×4 screws and PLA.

The case and stand print without supports in PLA. Which files, the print settings and how to put it
together: [hardware/README.md](../hardware/README.md#prints). Ready-to-print files will be in
[hardware/print-files/](../hardware/print-files/).

The case is optional for the next steps: the bare board works on the desk while you set it up.

**Check:** you have the board, a data-capable USB-C cable and a power supply.

## 2. Run the bridge

The bridge is a small server that sits between the device, Grok Bot and the speech services. It runs
in Docker next to its own Cloudflare Tunnel, so nothing is opened on your router.

1. On the always-on machine, clone the repository and go into `bridge/`. Create `.env` from
   `.env.example`.

   ```sh
   git clone https://github.com/e-roy/grok-puck.git
   cd grok-puck/bridge
   cp .env.example .env
   ```

   Set `PUBLIC_BASE_URL` to `https://desk.example.com` (your bridge's name), and `CLOUDFLARED_VERSION`
   to a [cloudflared release](https://github.com/cloudflare/cloudflared/releases) at least a week old.
2. **Set up Cloudflare Zero Trust**, once per Cloudflare account: open Zero Trust in the dashboard,
   choose a team name and the **Free** plan. Cloudflare asks for a payment method but doesn't charge
   for the Free plan.
3. **The tunnel:** Zero Trust → Networks → Tunnels, create a tunnel for this project and copy its token
   into `.env` (`CLOUDFLARE_TUNNEL_TOKEN`). Add two **published application routes**, each with the
   bridge's address inside Docker as the **Service URL** and nothing in **HTTP Host Header**:
   - `desk.example.com` → `http://bridge:8787`, for devices and Grok Bot. No Access application for
     this one: those are programs and use their own keys.
   - `desk-admin.example.com` → `http://bridge:8788`, for the admin page.
4. **Access for the admin page:** Zero Trust → Access controls → Applications → **Create new
   application** → **Self-hosted and private** → **Add public hostname**: `desk-admin.example.com`.
   Give it a policy that allows only your email. The login method can be **Cloudflare** (you sign in
   with your Cloudflare account; the default for new organizations). Then copy into `.env`:
   - `CF_ACCESS_AUD`: the application's **Application Audience (AUD) Tag**, under the application's
     **Edit** → **Additional settings**;
   - `CF_ACCESS_TEAM_DOMAIN`: your team domain (`<team>.cloudflareaccess.com`), under **Settings** →
     **Team name and domain**.

   The session duration only sets how often the admin page asks you to sign in again. The devices and
   Grok Bot never go through Access, so it never affects them.
5. Start it:

   ```sh
   docker compose up -d --build
   ```

6. **Cloudflare settings to check:** WebSockets must be allowed (they are by default). Bot Fight Mode
   can challenge programs, and on the Free plan it can't be skipped with a WAF rule. Check
   **Security** → **Settings** → **Bot traffic**: if the device or Grok Bot are challenged later, turn
   Bot Fight Mode off.

**Check:**
- `curl https://desk.example.com/healthz` answers `{"ok":true}`.
- `https://desk-admin.example.com` asks you to sign in with Cloudflare first, then shows the admin
  page. Its **Setup** list at the top of **Devices** shows what is left to do; the next steps tick it
  off.

Every setting the bridge reads from `.env` is listed in [bridge/README.md](../bridge/README.md#settings).

## 3. Set up speech and your bot

Everything from here on is set in the admin page.

1. **Speech → Text to speech:** choose **OpenAI-compatible**, enter the service's base URL (ending in
   `/v1`) and its key, press **Find models** and pick the model (for Kokoro: `kokoro`). **Play a test
   sentence** plays it in your browser.
2. **Speech → Speech to text:** the base URL, key and model of the transcription service, and the
   language you speak.
3. **Bots → Add bot:** give it your bot's name. Choose its **Look** (the shape and colour of its
   avatar in the Grok Bot app) and its **Voice** (each has a play button). Save. The routine webhook
   comes in step 5.

**Speech server on the same machine?** Use its public URL, or keep the traffic inside Docker with
[compose.speech-network.yaml](../bridge/compose.speech-network.yaml):

1. Find the speech server's Docker network, name and port:

   ```sh
   docker ps --format "table {{.Names}}\t{{.Networks}}\t{{.Ports}}"
   ```

   The port is the container's own: the one after `->` when it is also published on the host. If the
   speech server has its own tunnel route from a `cloudflared` container, that route's Service URL is
   already its address inside Docker (for example `http://speech:8000`).
2. In `.env`, set `SPEECH_NETWORK` to that network and uncomment
   `COMPOSE_FILE=compose.yaml:compose.speech-network.yaml`, so a plain `docker compose up -d --build`
   keeps the speech network.
3. In the admin page, set the TTS and STT base URLs to `http://<name>:<port>/v1`.

**Check:** the **Setup** list ticks "Text to speech answers", "Speech to text is set up" and "A bot
has a voice".

## 4. Flash and connect the device

1. **Flash the firmware** from a computer with ESP-IDF 6.1 (installed with Espressif's installer, then
   used from its terminal so `idf.py` is on the path). Plug the board in with USB-C, then in
   `firmware/`:

   ```sh
   idf.py build
   idf.py -p <port> flash       # e.g. -p COM3 on Windows, -p /dev/cu.usbmodem1101 on macOS
   ```

   On Windows, keep the repository in a short path: deep build folders break the 260-character limit.
   If the board doesn't flash, hold **BOOT** while plugging it in, then try again. More in
   [firmware/README.md](../firmware/README.md).
2. **Its Wi-Fi, from your phone:** on first start the screen shows a QR code for its setup network,
   `Desk-Setup-XXXX`. Join it with your phone: the setup page usually opens by itself; if it
   doesn't, open `http://192.168.4.1` in your phone's browser. Under **Add a network**, choose your
   Wi-Fi (2.4 GHz only), type its password and press **Add**: the device joins it to check the
   password, and your phone may lose the setup network for a moment (join it again if it doesn't come
   back by itself; the page then shows the result). Then type the bridge address,
   `wss://desk.example.com/device`, and press **Save the address**.
3. **Approve it:** in the admin page, **Devices** shows the new device. Choose its bot and press
   **Approve** while the device is online: it receives its own key and shows your bot's avatar.
4. Put it in its case and stand, if you printed them ([assembly](../hardware/README.md#prints)).

**Check:** on the device's card, **Try it** speaks a sentence on the device, and the **Setup** list
ticks "A device is approved and has a bot".

## 5. Connect Grok Bot

Three things connect your bot to the desk, all done in the Grok Bot app. Each one changes your Grok
Bot account, so do them one at a time. The full guide, with the exact messages to send to your bot:
**[docs/grok-bot-setup.md](grok-bot-setup.md)**.

1. **A custom MCP server** (the bridge's `https://desk.example.com/mcp`, with a key from the admin
   page's **Grok Bot** section). It gives your bot the tools to speak on the desk and show what it is
   doing. The header value is `Bearer`, a space and the key.
2. **Standing instructions**, saved as a skill or in your bot's memory: report what it is doing, and
   speak every reply on the desk.
3. **A routine with a webhook trigger**: what you say at the desk reaches your bot through it. Its
   webhook URL and key go into your bot under **Bots** in the admin page.

**Check:** the admin page's **Grok Bot** section ticks all three steps, and **Bots** → **Send a test
message to the bot** makes the device show "thinking", then speak the answer. Every routine run,
tests included, uses your Grok Bot plan's usage.

## 6. Talk to it

- **Type** a short question to your bot in the Grok Bot app. The device shows "thinking", then speaks
  the reply.
- **Hold the screen** and speak, then let go. Your words reach the bot as if you had typed them, and
  its answer is spoken. A tap while it speaks stops it; holding while it speaks stops it and listens.
- The device's card in the admin page has its volume, mute, and the longest message (60 s by default).
  The admin page's **History** shows every message with how long each part took.

The voice routine's instructions ask the bot to confirm before anything important it heard by voice
(sending, deleting, buying, publishing), since a transcription can mishear.

---

## Keeping it running

On the always-on machine, in `bridge/`:

```sh
git pull && docker compose up -d --build     # update the bridge
docker compose logs -f bridge                # its log
docker compose ps                            # is it healthy?
# Back up the bridge's data (bots, devices, keys, history) to ./bridge-data.tgz:
docker run --rm -v grok-puck_bridge_data:/data -v "$PWD":/backup alpine tar czf /backup/bridge-data.tgz -C /data .
```

The data lives in the Docker volume `grok-puck_bridge_data`, whatever the folder is called. The backup
holds keys: keep it private.

**Firmware updates** go over USB for now: `git pull`, then `idf.py build` and `idf.py -p <port> flash`
in `firmware/`. The device keeps its Wi-Fi networks, bridge address and key.

**Travelling:** the device keeps up to 5 Wi-Fi networks and joins the strongest one in reach. To add
one, press **Wi-Fi setup** on the device's card in the admin page (its setup network opens for 10
minutes and it stays online), or just switch it on somewhere new: when no saved network is in reach
for a minute, the setup network opens by itself. The card lists the saved networks, which one is in
use and its signal, with **Forget** for each. Networks with a sign-in page (hotels, cafés) or a
username (work Wi-Fi) can't be joined: use your phone's hotspot there.

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| `curl …/healthz` fails, or Cloudflare shows error 530 | the tunnel isn't connected | `docker compose logs cloudflared`; check the tunnel token in `.env` and the routes' Service URLs (`http://bridge:8787`, `http://bridge:8788`) |
| The admin page shows an error after the Cloudflare login | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` is wrong | copy both again (step 2.4), then `docker compose up -d` |
| Speech: "fetch failed (… can't find that host name …)" | the bridge can't reach the speech server from inside Docker | use the speech server's public URL, or the speech network (step 3) |
| The device shows its setup QR code again a minute after starting | it can't join any of its saved networks | join its setup network: the page says why each saved network failed (not found, password not accepted). Check the network is 2.4 GHz, or add it again with its password |
| The setup QR code comes back about 2 minutes after the device joined Wi-Fi | it can't reach the bridge | the setup page says so: the address must be `wss://desk.example.com/device` (`ws://` only for a bridge on the home network, with port 8787); check Bot Fight Mode (step 2.6) |
| The device stays offline (eyes closed, grey) on a working Wi-Fi | a wrong bridge address, or Cloudflare challenges it | as above; its setup network opens by itself after 2 minutes. To set a device up again from scratch, flash it with `idf.py -p <port> erase-flash flash` |
| Joining the setup network doesn't open the setup page | some phones don't open it by themselves | open `http://192.168.4.1` in the phone's browser while it is on the setup network |
| A phone warns that the setup network has no internet | it hasn't: it is the device's own network | expected; stay on it while you use the setup page |
| Grok Bot can't connect to the MCP server | the key or header is wrong | the admin page's **Recent calls** lists refused calls and what the key looked like. The header value must be `Bearer <key>`, the key whole (43 characters). **Replace the key** and paste the new value. Requests for `/.well-known/oauth-…` answered 404 in the log are Grok Bot looking for a sign-in after the refusal: harmless |
| Typed replies aren't spoken | the bot didn't keep its standing instructions | **Recent calls** shows whether it calls `desk_say`; send the instructions again ([step 2 of the Grok Bot guide](grok-bot-setup.md#2-the-standing-instructions)) |
| A spoken message ends in an error, or "no answer" after 3 minutes | the routine's webhook URL or key is wrong, or the routine is paused | the Webhook key is the routine's **key** field alone, not the **header** field. In the app, the routine's switch (bot panel → **Activity** → **Upcoming**) must be on |
| Speech is quiet | volume | the volume slider on the device's card; the board also has a volume trimmer |
| Your words are often misheard | the speech-to-text service | set the language under **Speech**, or try another service: the admin page's **History** shows each transcript |

## Costs

- **Grok Bot:** every message you speak to the desk starts a routine run, which uses your plan's usage
  (Grok Bot allows 200 runs an hour per routine). Typed chat costs what it always does.
- **Cloudflare:** the Tunnel and Access are free on the Free plan; you pay your registrar for the domain.
- **Speech:** free when self-hosted; hosted services charge per use.
- **Hardware:** the board, a cable, a power supply, three screws and some PLA
  ([parts list](../hardware/README.md#bill-of-materials)).
