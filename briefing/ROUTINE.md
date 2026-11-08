# Kikker morning briefing routine

A scheduled Claude Code task runs this every weekday at 8:00. It reads the connected sources,
writes a short briefing, and republishes it to one private claude.ai Artifact that the
Kikker Assistant app links to. It only reads: it never sends, replies, deletes, accepts or edits anything.

## Settings for this Claude account

The account-specific settings live in `settings.local.md` next to this file. It is git-ignored so
personal details stay out of the public repo. It has: Briefing page (Artifact URL), Person (name,
Microsoft 365 address, Slack user ID), Time zone, Working folder, Output folder, Schedule.
Read it first.

To move to another Claude account: connect the sources there (Microsoft 365, Slack, Linear, Gmail...),
copy this folder and `kikker.js`, write a new `settings.local.md` (leave the Artifact URL blank so the
first run creates a new page, then paste the new URL there and into the app's Settings > Briefing
link), and create a scheduled task whose prompt is: "Read and follow <working folder>\ROUTINE.md."

## Steps

1. **Window.** From the previous weekday at 8:00 AM to now (on Monday, from Friday 8:00 AM).
2. **Read every source that's connected.** Skip a source quietly if its tools aren't available,
   and note it in `source_notes`. Never ask questions; this runs unattended.
   - **Outlook email:** `outlook_email_search` with `afterDateTime` = window start, newest first, page
     through all results (25 per page). Open a message with `read_resource` only when the summary
     isn't enough to tell whether it needs a reply.
   - **Outlook calendar:** `outlook_calendar_search` with query `*` for today 00:00 to 23:59. Flag
     overlaps, early starts (before 8:00) and anything that changed.
   - **Teams:** `chat_message_search` with query `*` and `afterDateTime` = window start; drop the
     person's own messages.
   - **Slack:** `slack_search_public_and_private` with filters `to:<@USER_ID> after:YYYY-MM-DD`
     (DMs and mentions), sorted by timestamp, plus a second search for `is:thread` replies to them.
   - **Linear (when connected):** issues assigned to the person that changed in the window or are
     due within 3 days.
   - **Other email (Gmail etc., when connected):** same rules as Outlook.
3. **Sort into three groups.**
   - `needs_you`: someone is waiting on a reply, a decision or a deliverable; deadlines; meeting
     conflicts; requests from colleagues. Also personal messages from people (kindness matters,
     these feed the person's social goals). Most important first. Each gets a one-line `action`
     written as a to-do that starts with a verb and names the person or topic ("Reply to Sam about
     the Q3 budget"); the page's "+ Planner" buttons copy it into the Kikker daily planner as is.
   - `today`: calendar events in time order, with `flag` for conflicts or problems.
   - `fyi`: worth knowing, no action needed (threads they're copied on, updates, alerts worth a glance,
     things they're waiting on from others).
   - Count and skip noise: automated reports, notifications, marketing, newsletters, security notices.
4. **Write `out/briefing.json`** in this shape (keep text short and plain; no greetings; times in
   12-hour local time; `link` = the item's webLink or permalink when there is one):

   ```json
   {
     "date_label": "Monday, November 9",
     "headline": "One sentence about the day",
     "kikker_note": "One or two friendly sentences naming the top things",
     "needs_you": [{"source": "Outlook|Teams|Slack|Calendar|Linear", "from": "", "when": "", "title": "", "why": "", "action": "", "link": ""}],
     "today_label": "Today",
     "today": [{"time": "9:00 AM", "title": "", "detail": "", "flag": "", "link": ""}],
     "fyi": [{"source": "", "from": "", "title": "", "detail": "", "link": ""}],
     "sources": ["Outlook email", "Outlook calendar", "Teams chats", "Slack DMs and mentions"],
     "window": "Friday 8:00 AM to now",
     "skipped": {"automated reports": 0, "marketing emails": 0},
     "source_notes": [],
     "generated_label": "Mon Nov 9, 8:02 AM"
   }
   ```
5. **Render:** `node "<working folder>\render.js" "<output folder>\briefing.json" "<output folder>\briefing.html"`
6. **Publish:** Artifact tool, `action: publish`, `file_path` = the rendered HTML, `url` = the
   Briefing page URL from settings.local.md (read it first with `action: read` if the publish asks for it). Never
   create a second artifact when the URL is set. If the URL is blank, publish without `url`
   (icon `sun`) and report the new URL so it can be saved in the table.
7. **Finish** with a two-line summary: how many items need the person, and any source that failed.

## Privacy
- Briefing data stays in the git-ignored output folder and the private Artifact. Never commit it,
  never post it anywhere else, never include it in the Kikker Assistant repo.
- Read-only: no sending, replying, reacting, marking read, moving or deleting.
