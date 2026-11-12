# Connecting Grok Bot

**Status: step 1 works with Grok Bot; steps 2 and 3 are not yet tried.** Steps marked *(to test)*
depend on how the app behaves; this guide gets corrected as each one is tried.

Three things connect a bot to the desk. Each one changes your Grok Bot account, so do them one at a
time and check each before the next:

| | What | Why |
|---|---|---|
| 1 | A **custom MCP server**: the bridge's `/mcp` | gives the bot the tools `desk_say`, `desk_status`, `desk_devices` |
| 2 | A **skill**: standing instructions | tells the bot to report what it is doing and to speak every reply |
| 3 | A **routine with a webhook trigger** | lets what you say at the desk reach the bot |

You need the bridge running behind its public hostname (here `desk.example.com`) and its admin page
open. Every routine run, including tests, uses your Grok Bot plan's usage.

---

## 1. The MCP server

1. Admin page → **Grok Bot** → **Create the key**. It is shown only once: copy the **Authorization
   header value** with its copy button. That is `Bearer`, a space and the key. Grok Bot sends the
   header value exactly as typed, so "Bearer" has to be part of it.
2. In a chat with your bot, send:

   > Please add a custom remote MCP server for my desk display.
   > Name: Desk display
   > URL: https://desk.example.com/mcp
   > Authentication: an HTTP header, `Authorization: Bearer <key>`. It does not use OAuth.

   *(to test)* If the confirmation card has a field for the header value, paste the key there rather
   than in the message, so it doesn't stay in the chat history. If it ends up in a message anyway,
   create a new key once the setup works and update the server.
3. Confirm the card. The server is shared by every bot on the account.
4. **Check:** ask the bot "Call desk_devices." It should list your devices. In the admin page,
   **Recent calls** shows the call: note its client name, user agent and header names. They tell us
   whether Grok Bot says which bot is calling.

**If it doesn't connect:** look at **Recent calls**. A call refused for its key is listed as
**refused**, with what the key looked like (never the key itself), for example
`Authorization: <42 characters> (not the key, which has 43 characters)`: here "Bearer" is missing
and a character was lost when copying. After a refused key, Grok Bot looks for an OAuth sign-in
(requests to `/.well-known/oauth-protected-resource` and similar, answered 404, in the bridge's
log). The bridge doesn't offer one, and those requests only mean the key was refused. The key
can't be shown again: **Replace the key** and paste the new header value.

## 2. The skill

Ask the bot to save the text below as a private skill called "Desk display" and to turn it on for
itself. *(to test: how the app saves and enables skills.)* If several bots share the bridge, replace
`<your bot name>` with the bot's name as set up in the admin page; with one bot you can delete that line.

```text
I have a small display on my desk that shows you and speaks for you. Its tools come from the
"Desk display" MCP server: desk_status, desk_say and desk_devices.

Every time you work on a message from me:
1. When you start, call desk_status with state "thinking".
2. When you start using tools, the browser or the computer, call desk_status with state "working".
3. If you need my approval or an answer before you can go on, call desk_status with state "waiting",
   then ask me.
4. When you have written your reply to me, call desk_say with exactly the same text. If my message came
   from the desk (it has a request_id), pass that request_id as well.
5. If you finish without writing anything to me, call desk_status with state "idle".
In every desk tool call, pass bot: "<your bot name>".

Write replies that sound natural read aloud: short and direct, a few sentences unless I ask for more.
Put code and links in the chat as usual; the desk skips them when it speaks.

If a desk tool fails, carry on with my request. Never call the same desk tool more than twice in a row.
```

**Check:** type a short question in the chat. The desk should show "thinking", then speak the
reply. In the admin page, **History** shows a `say` entry.

## 3. The voice routine

Ask the bot to create a routine called "Desk voice" with a **webhook** trigger and the instruction
below. Then copy the routine's webhook URL and key (shown in the routine's Webhook section, in the
desktop app) into the bot's entry in the admin page → **Bots**.

```text
This routine runs when I speak to my desk display. The JSON body has:
- text: what I said. It is a speech transcription, so names and numbers may be misheard.
- request_id: pass it to desk_status and desk_say.
- device_name and bot_name.
- recent (sometimes): the last few things said at the desk, oldest first.

Treat text exactly as if I had typed it to you in our chat, and follow your Desk display skill:
desk_status as you work, then desk_say with your reply and the request_id.

Because it is a transcription: if the request is unclear, or would send, delete, buy, publish or
change something important, say back what you understood and ask me to confirm before doing it.
```

**Check:** admin page → **Bots** → **Send a test message to the bot**. That starts the routine the same
way the desk does, without needing a microphone. The device shows "thinking", then speaks the
answer. **History** shows the webhook time and how long the bot took to reply.

---

## What the first connection should tell us

Record the answers in `docs/spec.md` (section 9, Risks) and fix this guide.

1. **Context:** type something in the chat, then send a follow-up through the routine that refers
   to it ("what did I just ask you?"). Does the routine run know? If not, turn on **Send the last few
   spoken exchanges** for the bot in the admin page, and check where the run's reply appears in the app.
2. **Skill reliability:** over ten typed messages, how often did the desk show "thinking" and speak
   the reply?
3. **Which bot is calling:** in **Recent calls**, does anything (headers, client name) identify the
   bot? If nothing does, keep the `bot:` line in the skill.
4. **Timing:** the History's "bot reply" times for short questions.
5. **Limits:** the bridge allows 60 voice messages, 120 `desk_say` and 600 `desk_status` calls an
   hour; Grok Bot allows 200 webhook runs an hour per routine.
