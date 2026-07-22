# Notion Meeting Automation

Google Apps Script project (managed with [clasp](https://github.com/google/clasp)) that runs a daily Notion pipeline:

1. Find meetings that took place today
2. Sync Meeting Date + Attendee Names from Google Calendar
3. Extract Action Items into the Tasks database
4. Create a Daily Summary page

## Prerequisites

- Node.js 20+
- Apps Script API enabled: https://script.google.com/home/usersettings
- Access to the Apps Script project (script ID in `.clasp.json`)

## Connect clasp

```bash
npm install
npm run login          # authorize in the browser (Google account that owns the script)
npm run status         # confirm local files map to the remote project
npm run pull           # download latest from Apps Script (optional)
npm run push           # upload local .gs files to Apps Script
```

Credentials are stored in `~/.clasprc.json` (gitignored). Do not commit that file.

### Headless / CI / cloud agents

On a machine that cannot open a browser interactively:

1. On your laptop, run `npx @google/clasp login` once.
2. Copy the contents of `~/.clasprc.json`.
3. In the remote environment, write it before any clasp command:

```bash
echo "$CLASPRC_JSON" > ~/.clasprc.json
npm run status
npm run push
```

Or paste the JSON into Cursor / CI secrets as `CLASPRC_JSON`.

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run login` | OAuth login to Google |
| `npm run status` | List files clasp will push/pull |
| `npm run pull` | Download from Apps Script |
| `npm run push` | Upload local sources (`--force`) |
| `npm run open` | Open the project in the Apps Script editor |

## One-time Apps Script setup

In the Apps Script editor (after `npm run push` / `npm run open`):

1. Set Script Properties: `NOTION_TOKEN`, `SUMMARY_DB_ID` (from `setupSummaryDatabase()`)
2. Run `installDailyTrigger()` once (8 PM, script timezone `America/Chicago`)
3. Optional catch-up: set `CATCHUP_DATE` (`yyyy-MM-dd`) and run `runCatchUpForConfiguredDate()`
