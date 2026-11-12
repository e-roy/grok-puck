# Connecting Grok Bot

**Status: all three steps work with Grok Bot.** Typed chat, the test message and hold-to-talk all
reach the desk. The checks at the end ([What the first connection should tell us](#what-the-first-connection-should-tell-us))
have not been run yet.

Three things connect a bot to the desk. Each one changes your Grok Bot account, so do them one at a
time and check each before the next:

| | What | Why |
|---|---|---|
| 1 | A **custom MCP server**: the bridge's `/mcp` | gives the bot the tools `desk_say`, `desk_status`, `desk_devices` |
| 2 | **Standing instructions**: a skill, or the bot's memory | tell the bot to report what it is doing and to speak every reply |
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

## 2. The standing instructions

Send the message below to the bot. If several bots share the bridge, add the line
`In every desk tool call, pass bot: "<your bot name>".` with the bot's name as set up in the admin
page; with one bot, leave it out.

```text
Please save the text below as a private skill called "Desk display", just for yourself, and turn it on.

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

Write replies that sound natural read aloud: short and direct, a few sentences unless I ask for more.
Put code and links in the chat as usual; the desk skips them when it speaks.

If a desk tool fails, carry on with my request. Never call the same desk tool more than twice in a row.
```

Grok Bot keeps skills in one private library that every bot on the account shares, and turns each
skill on per bot (sidebar → **Connect apps** → the connected count → **Private skills**). So the bot
may answer that it can't keep a skill of its own, and save the instructions to its memory instead.
That works too: the first bot connected did exactly that, and the desk spoke its next reply.

**Check:** type a short question in the chat. The desk should show "thinking", then speak the
reply. In the admin page, **History** shows a `say` entry.

## 3. The voice routine

1. In the same chat, send the message below. It spells the desk steps out itself, so it works
   whether step 2 became a skill or a memory.

   ```text
   Please create a routine called "Desk voice" with a webhook trigger and no schedule, with this instruction:

   This routine runs when I speak to my desk display. The JSON body has:
   - text: what I said. It is a speech transcription, so names and numbers may be misheard.
   - request_id: pass it to desk_status and desk_say.
   - device_name and bot_name.
   - recent (sometimes): the last few things said at the desk, oldest first.

   Treat text exactly as if I had typed it to you in our chat. Use the desk display as you always do:
   desk_status "thinking" when you start and "working" while you use tools, then desk_say with your
   reply. Pass the request_id in every desk call.

   Because it is a transcription: if the request is unclear, or would send, delete, buy, publish or
   change something important, say back what you understood and ask me to confirm before doing it.
   ```

2. **Find the webhook details.** They show only in the **desktop** app: click the bot's name at the
   top of the chat, open the **Details** tab, then **Routines** → **Desk voice**. Its **Webhook**
   section has three fields, **POST to**, **key** and **header**; clicking one copies it.
3. **Paste them into the admin page** → **Bots** → your bot:
   - **Webhook URL:** the **POST to** value;
   - **Webhook key:** the **key** value alone. Not the **header** field: the bridge adds "Bearer"
     itself.

   Save.

**Check:** admin page → **Bots** → **Send a test message to the bot**. That starts the routine the same
way the desk does, without needing a microphone. The device shows "thinking", then speaks the
answer. **History** shows the webhook time and how long the bot took to reply. Then try it for real:
hold the device, ask something, and let go.

---

## What the first connection should tell us

Not run yet. Record the answers in `docs/spec.md` (section 9, Risks) and fix this guide.

1. **Context:** type something in the chat, then send a follow-up through the routine that refers
   to it ("what did I just ask you?"). Does the routine run know? If not, turn on **Send the last few
   spoken exchanges** for the bot in the admin page, and check where the run's reply appears in the app.
2. **Reliability:** over ten typed messages, how often did the desk show "thinking" and speak
   the reply?
3. **Which bot is calling:** in **Recent calls**, does anything (headers, client name) identify the
   bot? If nothing does, keep the `bot:` line in the instructions.
4. **Timing:** the History's "bot reply" times for short questions.
5. **The app's own voice:** in a voice chat with the bot in the Grok Bot app, does it still call the
   desk tools? If it does, the desk speaks over the call: mute the device in the admin page first.
6. **Limits:** the bridge allows 60 voice messages, 120 `desk_say` and 600 `desk_status` calls an
   hour; Grok Bot allows 200 webhook runs an hour per routine.
