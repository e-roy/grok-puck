# Connecting Grok Bot

Step 5 of the [setup guide](setup.md): by now the bridge runs behind its public hostname, and the
admin page has your bot and an approved device.

**Status: all three steps work with Grok Bot.** Typed chat, the test message and hold-to-talk all
reach the desk. The checks at the end ([Checking what the bot does](#checking-what-the-bot-does)) ran
on a test bot on 20 Nov 2026: it followed every instruction.

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

Send the message below to the bot. The first bot on the bridge needs nothing more: calls that don't
name a bot go to it (admin page → **Bots**, "Calls that don't name a bot"). For every bot added after
it, add the line `In every desk tool call, pass bot: "<the bot's name>".`, with its name exactly as
set up in the admin page, so its calls reach its own devices.

```text
Please save the text below as a private skill called "Desk display", just for yourself, and turn it on.

I have a small display on my desk that shows you and speaks for you. Its tools come from the
"Desk display" MCP server: desk_status, desk_say and desk_devices.

Every time you work on a message from me:
1. When you start, call desk_status with state "thinking".
2. When you start using tools, the browser or the computer, call desk_status with state "working".
3. If you need my answer, my approval, or me to do something in the app before you can go on, call
   desk_status with state "waiting", then ask me. Leave it at "waiting" until I answer: the desk
   shows that you are waiting for me.
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
   top of the chat. In the panel that opens, **Desk voice** is listed on the **Activity** tab under
   **Upcoming** ("When a webhook fires", with a switch that pauses it). Click it: its **Webhook**
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

## Checking what the bot does

Run once, on a test bot (20 Nov 2026): the [results](#results-20-nov-2026) are at the end. Record
new results the same way (counts and timings only, never reply text), here and in `docs/spec.md`
(section 9, Risks).

Every turn the bot takes shows under **History** → **Turns** in the admin page: its desk calls in
order, with their times, checked against the instructions above (spec §5.11). **Export** saves them
with a summary.

Run the checks on a **test bot**, not on a bot you rely on: each message lands in its chat and uses
your plan's usage. Give it a device of its own on the bridge, the standing instructions with its
`bot:` line (step 2), and its own "Desk voice" routine (step 3) for the spoken messages.

| # | Send to the test bot | Its turn should show | The device should |
|---|---|---|---|
| 1 | "What is the capital of Australia? One sentence." | thinking, then `desk_say`; every check passes | think, then speak |
| 2 | "Look up the latest ESP-IDF release on the web and tell me its version." | thinking, working, `desk_say` | think, work (the faster orbit), speak |
| 3 | "Help me choose a name for a houseplant. Ask me one question first, then wait for my answer." | thinking, waiting, `desk_say` with the question ("question spoken" passes) | show attention (the "!" and the hop) with one chirp, and keep it while you're away: leave it for 11 minutes or more, past the old expiry |
| 4 | Answer its question, typed | a new turn, thinking first; attention ends at its first call | drop the "!", think, speak |
| 5 | "Save a note in your memory that the test phrase is blue kettle. Don't write me a reply." | thinking, working, idle, and no `desk_say` | think, work, then rest |
| 6 | "Show me a three-line Python hello world and a link to python.org." | a `desk_say` with fewer characters spoken than written | speak, skipping the code and the link |
| 7 | Hold the device and ask "What time zone is Tokyo in?" | a voice turn: the webhook, then thinking and `desk_say`, all with the `request_id` | think at once, then speak |
| 8 | Type "What is 17 times 23?", then hold the device and ask "What did I just ask you, and what was the answer?" | a typed turn, then a voice turn | speak whether the routine run knew the typed question (context, below) |
| 9 | "Explain in about 300 words how a heat pump works." | one long `desk_say` | speak it to the end, about two minutes |
| 10 | Ten short questions, typed one after another, each after the last reply | ten turns | think and speak ten times |
| 11 | Mute the device in the admin page, then talk with the bot in the app's voice chat for a minute | whatever turns appear | stay silent |

What the results tell:

1. **Context** (message 8): does the routine run know what was typed in the chat? If not, **Send the
   last few spoken exchanges** (admin page → **Bots**) carries only what was said at the desk, so
   say in the routine's message what it needs; check where the run's reply appears in the app.
2. **Reliability** (messages 1 to 10): how many turns passed every check, and which checks failed
   how often. A check that keeps failing calls for a change to the standing instructions.
3. **Which bot is calling:** answered: nothing in the call says so (spec §5.5), so every bot after
   the first keeps its `bot:` line.
4. **Timing:** the export's summary: the reply time of typed and of voice turns (median and range),
   and how long speech takes to start.
5. **The app's own voice** (message 11): if the bot calls the desk tools during a voice chat, the
   desk would speak over the call: keep the device muted during voice chats.
6. **Limits:** the bridge allows 60 voice messages, 120 `desk_say` and 600 `desk_status` calls an
   hour; Grok Bot allows 200 webhook runs an hour per routine.

### Results (20 Nov 2026)

A test bot with the standing instructions above (instruction 3 as it reads now) and its `bot:`
line, on a bridge it shared with a first bot that names none; firmware 0.6.3 on its device.
Messages 1 to 9 were sent; 10 and 11 were skipped.

- **Every check passed** on the 10 turns of messages 1 to 9: "thinking" first 10 of 10, ended 10
  of 10, `request_id` 2 of 2, question spoken 1 of 1, no repeats, no errors. "Working" came on the
  two turns that used the web, and on no other.
- **Before the script,** while setting it up: one reply was refused because the bot had no voice
  yet, and the routine's first run (the admin page's **Send a test message**) replied without
  "thinking" first: 1 of its 3 spoken turns.
- **Attention** (message 3): "waiting" 4.6 s into the turn, the question 8 s later; it stayed
  15 minutes, past the old 10-minute expiry, and the bot's "thinking" for the answer ended it at
  once.
- **No reply** (message 5): "thinking", then "idle", and nothing spoken.
- **Code and links** (message 6): 92 of 179 characters spoken.
- **The first bot's desk** stayed quiet throughout: no call from the test bot lost its name.
- **Timing:** typed turns took 2.8 to 20.7 s from the first call to the reply (median about 5 s;
  the long one used the web). Spoken turns took 8.1 to 11.1 s from the webhook to the reply
  (median 10.8 s), the first call 8 to 11 s after the webhook.
- **Still to test:** context (message 8: the typed message held the spoken question too, so it
  showed nothing; to repeat, type only "What is 17 times 23?", then ask the follow-up at the desk),
  ten messages in a row (10) and the app's voice chat (11).

What it changes: nothing in the standing instructions. The `bot:` line for a second bot works; a
first bot keeps its instructions as they were.
