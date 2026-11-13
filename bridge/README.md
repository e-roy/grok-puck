# Desk bridge

The small always-on server between a desk display, Grok Bot and speech services:

- **Devices** keep one WebSocket open to it. What the owner says goes up as audio; what the bot says comes
  back as audio, plus what the face should show (idle, thinking, working, waiting, error).
- **Grok Bot** reaches it in two documented ways: the bridge posts spoken messages to a **routine
  webhook**, and the bot calls the bridge's **MCP tools** to speak (`desk_say`) and show its status
  (`desk_status`).
- **Speech** goes to any OpenAI-compatible service: TTS (for example a self-hosted Kokoro server) and STT.
- An **admin page** sets up devices (including their saved Wi-Fi networks, by name only), bots
  (webhook, avatar, voice) and speech, and shows the history with timings.

How the parts fit, and why: [../docs/spec.md](../docs/spec.md).

## Run it locally

Needs Node 24 or newer and pnpm 11 (npm is refused; see [Supply chain](#supply-chain)).

```sh
cd bridge
pnpm install
pnpm build:admin
pnpm start
```

- Admin page: <http://127.0.0.1:8788> (this computer only).
- Devices and MCP: port 8787 (`ws://<this computer>:8787/device`, `http://<this computer>:8787/mcp`).
- Data (bots, devices, keys, history) is kept in `bridge/data/state.json`. It holds the webhook and speech
  API keys, so keep it private.

## Try the whole loop without hardware or Grok Bot

Two stand-ins come with the bridge: a fake device and a fake Grok Bot. Speech starts as "Mock" (beeps
for speech, a fixed transcript), so nothing else is needed.

1. Admin page → **Grok Bot** → **Create the key**, and copy it.
2. In a second terminal: `pnpm fake-grokbot --mcp-key <the key>`. It listens for the webhook at
   `http://127.0.0.1:8790/webhook` with the key `test-key`.
3. Admin page → **Bots**: add a bot and set its webhook URL and key to those two values.
4. In a third terminal: `pnpm fake-device`. It appears under **Devices**: approve it and attach it to the bot.
   It reports two saved Wi-Fi networks, as firmware 0.6.0 does, so its card has a Wi-Fi part:
   **Wi-Fi setup**, **Forget** for each network and **Forget all networks** reach it and show in its
   terminal. `--networks "A,B,C"` chooses the names, `--old-firmware` reports none (like firmware
   before 0.6.0), and typing `signal -70` changes its signal.
5. In the fake device, type `talk`. The fake bot receives the message, shows "working", and answers
   "You said: …", which the fake device plays and saves in `.fake/out/` (add `--play` to hear it through
   ffplay).
6. In the fake bot, type `say Hello there` (the bot speaking on its own) or `status waiting`.

To hear real voices, set **Speech → Text to speech** to OpenAI-compatible with the speech server's base
URL (ending in `/v1`), key and model (`kokoro` for Kokoro), then choose a voice for the bot and press
**▶ Sample**. A WAV file at 16 kHz mono 16-bit can stand in for speech: `talk file.wav`.

## Settings

Everything about bots, devices and speech is set in the admin page. The environment only says where the
bridge listens and how the admin page is protected:

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_HOST`, `PUBLIC_PORT` | `0.0.0.0`, `8787` | devices, MCP and `/healthz` |
| `ADMIN_HOST`, `ADMIN_PORT` | `127.0.0.1`, `8788` | the admin page and its API |
| `ADMIN_AUTH` | `local` | `local`: this computer only. `cloudflare-access`: requires a Cloudflare Access login |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | | needed with `cloudflare-access` |
| `PUBLIC_BASE_URL` | | the bridge's public address, shown as the MCP URL |
| `DATA_DIR` | `data` | where `state.json` lives |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

`pnpm start` also reads a `.env` file in `bridge/` if there is one.

## On the always-on machine

The [setup guide](../docs/setup.md#2-run-the-bridge) walks through it: Docker, a Cloudflare Tunnel with
two routes, and Cloudflare Access for the admin page. Updating, logs and backups are in
[Keeping it running](../docs/setup.md#keeping-it-running).

## Connect Grok Bot

The step-by-step guide, with the exact texts to give the bot and what to check after each step, is
[docs/grok-bot-setup.md](../docs/grok-bot-setup.md). In short: add the bridge as a custom MCP server
(with its key), give the bot standing instructions (a skill or its memory) to report its status and
speak every reply, and create a
routine with a webhook for what you say at the desk. Each step changes the Grok Bot account.

### The tools

| Tool | What it does |
|---|---|
| `desk_say(text, request_id?, device?, bot?)` | Speaks the text on the bot's devices. With a `request_id` from a spoken message, it answers the device that asked. Code blocks and links are skipped when spoken. |
| `desk_status(state, request_id?, device?, bot?)` | Shows `thinking`, `working`, `waiting` or `idle`. |
| `desk_devices()` | Lists the devices: online or not, what each shows, which bot it belongs to. |

The webhook body is `{request_id, text, device_id, device_name, bot_name, reply_with}`, plus `recent`
(the last spoken exchanges) when that option is on for the bot. A 2xx answer only means the run started.
No reply within 3 minutes shows "no answer" on the device; a later reply is still spoken.

## Security

- From the internet, only `/device`, `/mcp` and `/healthz` are reachable, through the tunnel. `/mcp` needs
  the MCP key, and every approved device has its own key. Only hashes of both are stored.
- New devices wait for approval in the admin page; at most 10 may wait at once.
- The admin page is never public: on this computer only, or behind Cloudflare Access with its login
  token checked again by the bridge. Changes need an `x-desk-admin` header, which other websites can't send.
- Webhook and speech keys are kept in `data/state.json` and never shown again in full.
- Limits per hour: 60 spoken messages to the bot, 120 `desk_say` and 600 `desk_status` calls.
- The admin page's **Recent calls** list shows what each MCP caller sent (header names, client name, tool
  and argument names), never values.

## Supply chain

pnpm only, set in `pnpm-workspace.yaml`:

- packages must be at least **7 days old** (`minimumReleaseAge`), and an install fails rather than
  falling back to a newer one;
- an install fails if the registry gives no publish date;
- a version is refused if its publisher trust evidence is weaker than an earlier version's;
- dependencies may not run install scripts.

`package.json`'s `devEngines` makes `npm install` stop before it downloads anything. Docker installs
from the lockfile with a pinned pnpm.

## Development

```sh
pnpm test          # unit tests and the end-to-end loop (bridge + fake device + fake Grok Bot)
pnpm check         # TypeScript, server and admin page
pnpm dev           # the bridge, restarting on changes
pnpm dev:admin     # the admin page with hot reload on :5173, using a bridge running locally
```

The server runs its TypeScript directly on Node 24 (no build step); only the admin page is built.

### The admin page

`admin/` is its own package in this pnpm workspace (React, Vite, Tailwind CSS v4 and shadcn/ui on
Base UI), so its packages stay out of the server's. `pnpm build:admin` builds it into `admin/dist`,
which the bridge serves.

The components in `admin/src/components/ui/` are copied from shadcn/ui and are ours to change (licence
in `THIRD_PARTY_NOTICES.md`). Add more with the script, not `shadcn add`: the CLI would install
packages itself, outside the rules above.

```sh
cd admin
node scripts/shadcn-add.mjs tabs     # writes the files, then lists any packages to add
pnpm add -D some-package@^1          # if it listed one: a major range, so the 7-day rule applies
```
