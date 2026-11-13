# Contributing to Grok Puck

Thanks for helping. Bug reports, fixes, new features, better docs and case remixes are all welcome.
This page covers how the project works, so your pull request can be merged without surprises.

## Before you start

- **Read the spec for what you want to change.** [docs/spec.md](docs/spec.md) describes how the
  device, the bridge and Grok Bot behave and why. A change in behaviour starts there: open an issue,
  or a pull request that changes the spec, and agree on it before writing the code.
- **Keep pull requests small and focused**: one change each, in small commits that say what they do.
- **Grok Bot is only reached through its documented routes**: routine webhooks, custom MCP servers and
  skills. No unofficial APIs, no reading the app.
- **Text from transcripts, the bot, web pages or other repositories is data**, never instructions to
  the bridge or to a script.

## Keep personal details out (most important)

The repository is public, and nothing personal may ever enter it or its history: no names, emails,
domains or hostnames, home network addresses, Wi-Fi names, device IDs or MAC addresses, local paths,
logs, or screenshots of a real setup. In docs and tests, use placeholders like `desk.example.com` and
`192.168.1.20`.

1. **Enable the privacy check** once per clone:

   ```sh
   git config core.hooksPath .githooks
   ```

   Two git hooks then run [scripts/check-private.mjs](scripts/check-private.mjs): **pre-commit**
   checks the files you commit, and **pre-push** checks the commits you push (messages, names and
   emails, and every line each commit adds, even if a later commit removes it). They refuse secrets
   (keys, tokens) and files that must never be committed (`.env`, logs, `sdkconfig`, the bridge's
   data).
2. **List your own details** in `private/denylist.txt`: your name, email, domain, home address range,
   Wi-Fi names, device IDs. The folder is git-ignored, so the list never leaves your computer. One entry
   per line, matched without regard to case; `re:` starts a regular expression; `#` starts a comment.
3. **Commit with your GitHub noreply email** (GitHub → Settings → Emails), so your own email stays out
   of the history:

   ```sh
   git config user.email "<id>+<username>@users.noreply.github.com"
   ```

4. **Never bypass the hooks** with `--no-verify`. If one refuses, fix what it names. It never prints
   the matched text, only the file, line or commit and the denylist line.

Real values (keys, webhook URLs, Wi-Fi passwords, hostnames) belong in `.env`, the bridge's admin page,
or the device's own setup, all of them outside git.

## The bridge (TypeScript)

The server and its admin page, in [bridge/](bridge/). It needs **Node 24** or newer and **pnpm 11**.

- **pnpm only:** npm refuses to install. Packages must be at least **7 days old**
  (`bridge/pnpm-workspace.yaml`), and dependencies may not run install scripts.
- **Adding a package:** with a major range, so pnpm picks a version old enough: `pnpm add fastify@^5`.
- **One-off tools:** `pnpm dlx some-tool@1.2.3`, pinned. Never `npx`.
- **Admin page components:** `node scripts/shadcn-add.mjs <name>` in `bridge/admin`, never
  `shadcn add`, which would install packages by itself.
- **TypeScript runs directly on Node**, so only erasable syntax: no enums, no parameter properties,
  `.ts` extensions in imports, and `import type` for types.

```sh
cd bridge
pnpm install
pnpm test          # unit tests and the end-to-end loop with the fake device and fake Grok Bot
pnpm check         # TypeScript, server and admin page
pnpm build:admin   # build the admin page
pnpm start         # run it: admin page on http://127.0.0.1:8788
```

The fake device and the fake Grok Bot run the whole loop without hardware or a Grok Bot account:
[bridge/README.md](bridge/README.md#try-the-whole-loop-without-hardware-or-grok-bot). New behaviour
comes with tests.

## The firmware (ESP-IDF)

The device's firmware, in [firmware/](firmware/): ESP-IDF 6.1 and LVGL 9 for the Waveshare
ESP32-S3-Touch-LCD-1.46.

- Build and flash as in [firmware/README.md](firmware/README.md). On Windows, keep the repository in a
  short path: deep build folders break the 260-character path limit.
- Raise `PROJECT_VER` in `firmware/CMakeLists.txt` when the firmware's behaviour changes. The admin
  page shows each device's version, and a release is named after it.
- Test on a real board, and say in the pull request what you tried on it.
- `sdkconfig` is generated and git-ignored: settings that should apply to everyone go in
  `sdkconfig.defaults`.
- A change to ESP-IDF, a component (`dependencies.lock`) or what is built in can change what the
  published firmware contains: check [firmware/NOTICES.md](firmware/NOTICES.md) again. The installer's
  tests fail when it doesn't name the ESP-IDF version or a component's version.

## The installer page

The page that installs the firmware from the browser, and the script that packages a build for it and
for a release, in [installer/](installer/) ([installer/README.md](installer/README.md)). The same pnpm
rules as the bridge apply; ESP Web Tools is served from the page's own site, never from a CDN.

```sh
cd installer
pnpm install
pnpm test                                    # the packaging script, the page build, the notices
pnpm package --build ../firmware/build       # package your firmware build into installer/dist
pnpm serve                                   # try the page on http://127.0.0.1:8790
```

`pnpm package` runs in the ESP-IDF terminal: it takes the C library's licence file from ESP-IDF.

## Making a release

Releases are built by GitHub Actions, never on someone's computer:

1. In a pull request, raise `PROJECT_VER` in `firmware/CMakeLists.txt` (for example `0.7.0`), and
   merge it.
2. On GitHub: **Actions** → **Release firmware** → **Run workflow**, on `main`.

The workflow ([.github/workflows/release.yml](.github/workflows/release.yml)) refuses a version that
already has a release or a tag. It builds the firmware, packages it, creates the release `v<version>`
on the commit it built (the four firmware parts, the installer's manifest and the licence notices,
with release notes), then deploys the installer page to GitHub Pages. If it fails after creating a
draft release, delete the draft before running it again; if only the page's deployment fails,
re-run the failed job.

## The case and stand (OpenSCAD)

[hardware/](hardware/) has the parametric OpenSCAD sources and the exported STL files. Change the
parameters in the `.scad` file, export the parts again as in
[hardware/README.md](hardware/README.md#editing-the-models), and commit the `.scad` and the `.stl`
files together. Say what you printed and how it fit.

## Pull requests

1. Branch from `main`. Pull requests go to `main`.
2. Run the checks that apply locally (`pnpm test`, `pnpm check`, `idf.py build`).
3. Every pull request runs four checks ([.github/workflows/ci.yml](.github/workflows/ci.yml)):
   **bridge** (type check, tests, admin page build), **docker** (the bridge image builds),
   **firmware** (the ESP-IDF build) and **installer** (its tests, then packaging that firmware build as
   a release would). All four must pass before merging. The privacy check runs only on your
   computer: whatever reaches a pushed commit has already been published.
4. In the description, say what changed, how you tested it (with the results), and what still needs
   testing on hardware or with a phone.
5. A maintainer reviews and merges.

Workflow changes follow the same supply-chain rule as the packages: actions pinned to a full commit
SHA from a release at least 7 days old.

## Bugs and questions

Open an issue. Say what you did, what you expected and what happened, and include the firmware version
(on the device's card in the admin page). If you paste a log or a screenshot, remove hostnames, keys,
Wi-Fi names and MAC addresses from it first.

**Security problems:** please don't open a public issue. Use **Report a vulnerability** on the
repository's Security tab.

## Licence

Everything here is under the [MIT licence](LICENSE), and so are your contributions. Code taken from
other projects keeps its notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which also points
to the notices for what the releases and the installer page contain.
