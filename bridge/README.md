# Desk bridge

The small always-on server between a desk display, Grok Bot and speech services:

- **Devices** keep one WebSocket open to it. What the owner says goes up as audio; what the bot says comes
  back as audio, plus what the face should show (idle, thinking, working, waiting, error).
- **Grok Bot** reaches it in two documented ways: the bridge posts spoken messages to a **routine
  webhook**, and the bot calls the bridge's **MCP tools** to speak (`desk_say`) and show its status
  (`desk_status`).
- **Speech** goes to any OpenAI-compatible service: TTS (for example a self-hosted Kokoro server) and STT.
- An **admin page** sets up devices, bots (webhook, avatar, voice) and speech, and shows the history with timings.

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

The bridge runs in Docker next to its own Cloudflare Tunnel; no port is opened at home. It needs
Docker (Docker Desktop on a Mac, set to start at login), git, and a domain on Cloudflare.

1. Clone the repository and go into `bridge/`. Create `.env` from `.env.example`.
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
5. `docker compose up -d --build`, then open `https://desk-admin.example.com`: Cloudflare asks you to sign
   in first.
6. Check from outside: `curl https://desk.example.com/healthz` answers `{"ok":true}`, and the admin
   hostname redirects to the Cloudflare login.

**Speech server on the same machine:** use its public URL in the admin page, or keep the traffic inside
Docker with [compose.speech-network.yaml](compose.speech-network.yaml):

1. Find the speech server's Docker network, name and port:

   ```sh
   docker ps --format "table {{.Names}}\t{{.Networks}}\t{{.Ports}}"
   ```

   The port is the container's own: the one after `->` when it is also published on the host. If the
   speech server has its own tunnel route from a `cloudflared` container, that route's Service URL is
   already its address inside Docker (for example `http://speech:8000`).
2. In `.env`, set `SPEECH_NETWORK` to that network and uncomment
   `COMPOSE_FILE=compose.yaml:compose.speech-network.yaml`, so a plain `docker compose up -d --build`
   (and every command below) keeps the speech network.
3. In the admin page, set the TTS and STT base URLs to `http://<name>:<port>/v1`.

**Cloudflare settings to check:** WebSockets must be allowed (they are by default). Bot Fight Mode
can challenge programs, and on the Free plan it can't be skipped with a WAF rule (Cloudflare's docs say
so). Check **Security** → **Settings** → **Bot traffic**: if the devices or Grok Bot are challenged,
turn Bot Fight Mode off.

**Day to day:**

```sh
git pull && docker compose up -d --build     # update
docker compose logs -f bridge                # logs
docker compose ps                            # health
# Back up the bridge's data (bots, devices, keys, history) to ./bridge-data.tgz:
docker run --rm -v grok-puck_bridge_data:/data -v "$PWD":/backup alpine tar czf /backup/bridge-data.tgz -C /data .
```

The volume is `grok-puck_bridge_data`: the project name set in `compose.yaml` (`name: grok-puck`) plus
`bridge_data`, whatever the folder is called (`docker volume ls` shows it). The backup holds secrets:
keep it private.

## Connect Grok Bot

The step-by-step guide, with the exact texts to give the bot and what to check after each step, is
[docs/grok-bot-setup.md](../docs/grok-bot-setup.md). In short: add the bridge as a custom MCP server
(with its key), give the bot a skill that reports its status and speaks every reply, and create a
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
