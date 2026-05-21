# Arc Timeline MCP Server — Install Instructions for AI Assistants

**You (the AI) are reading this because a user wants you to install the Arc Timeline MCP server so they can ask you questions about their personal location history.** Follow this document end-to-end. Don't improvise.

The Arc Timeline MCP server is a small Node.js process that reads a SQLite file exported from the **Arc Reader** browser app and exposes 15 read-only query tools over MCP stdio. Once it's installed and registered, the user will be able to ask things like *"how much did I walk last month?"* or *"when did I first visit Italy?"* and you'll call its tools to answer.

---

## Prerequisites the user must have done first

1. Opened Arc Reader → **Analysis** → **MCP Server** tab.
2. Clicked **Export database**, downloading a `.db` file (named like `arc-timeline-2026-05-21.db`).
3. Saved the `.db` somewhere stable on their machine.

If the user hasn't done step 1–3 yet, **stop and tell them to**, then resume.

You will need the absolute path to the `.db` file. Ask the user for it now if you don't already have it. Don't guess.

---

## Step 0 — Check Node.js

Run:
```bash
node --version
```
You need **Node.js 18 or newer**. If `node` is not installed, stop and tell the user to install it from <https://nodejs.org/> (LTS is fine).

If you don't have shell access, ask the user to run `node --version` and paste the output.

---

## Step 1 — Detect which AI client you are

Look at your own runtime context to determine which client config you need to modify:

| Client | Config file | Format |
|---|---|---|
| **Claude Code** | `~/.claude.json` (top-level `mcpServers` key — see Step 4 for safe-merge instructions) | JSON |
| **Codex** | `~/.codex/config.toml` | TOML |
| **Claude Desktop (macOS)** | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON |
| **Claude Desktop (Windows)** | `%APPDATA%\Claude\claude_desktop_config.json` | JSON |
| **Claude Desktop (Linux)** | `~/.config/Claude/claude_desktop_config.json` | JSON |

If you can't tell which client you are, ask the user.

---

## Step 2 — Install the server

Pick an install location. Default: `~/arc-timeline-mcp`. If the user has a preference, use that.

```bash
mkdir -p ~/arc-timeline-mcp
cd ~/arc-timeline-mcp
git clone https://github.com/gordon-williams/arc-timeline-reader.git .
cd mcp-server
npm install
```

This installs two dependencies (`@modelcontextprotocol/sdk` and `better-sqlite3`) plus their transitive deps. Takes ~30 seconds on a normal connection.

If `git clone` fails because the directory isn't empty, use a fresh directory or `cd ~/arc-timeline-mcp && git pull`.

**Note the absolute path** to `index.js` — you'll need it for the config step:
```bash
echo "$(cd ~/arc-timeline-mcp/mcp-server && pwd)/index.js"
```

---

## Step 3 — Sanity-check the .db with `--selftest`

```bash
node ~/arc-timeline-mcp/mcp-server/index.js "$DB_PATH" --selftest
```
where `$DB_PATH` is the absolute path the user gave you for their exported `.db` file.

You should see output like:
```
Arc Timeline MCP — self-test
─────────────────────────────
File:           /Users/.../arc-timeline-2026-05-21.db
Exported at:    2026-05-21T06:00:00.000Z
App build:      02.281
Schema version: 4
Days:           1825 (2021-04-12 → 2026-05-21)
GPS samples:    NOT included (re-export with the box ticked to enable bbox / elevation queries)
Raw JSON blobs: not included

  timeline_items         18250
  gps_samples            0
  locations              412
  ...
```

If it errors, **stop and report the error verbatim** — do not try workarounds. Likely causes:
- *Database file not found* → wrong path.
- *Does not look like an Arc Timeline export* → user pointed at the wrong file. Ask them to re-check.
- *Schema version mismatch* → user's Arc Reader is older or newer than this server. They can usually still proceed; tools may have minor quirks.

---

## Step 4 — Register the server with the user's AI client

Use the path you noted in Step 2 (the absolute path to `index.js`) and the user's `.db` path.

### If you are Claude Code

**Try the CLI first** — it handles the merge for you:
```bash
claude mcp add --scope user arc-timeline node /absolute/path/to/index.js "$DB_PATH"
```

**If `claude mcp add` is not available** (CLI not on PATH, or `which claude` returns nothing), edit `~/.claude.json` directly. **This file contains a lot of unrelated Claude Code state** (project history, settings, telemetry caches) — under no circumstances overwrite it. Do a safe in-place merge:

```bash
node -e "
const fs = require('fs');
const p = require('os').homedir() + '/.claude.json';
const backup = p + '.backup-' + Date.now();
fs.copyFileSync(p, backup);
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.mcpServers = j.mcpServers || {};
j.mcpServers['arc-timeline'] = {
  command: 'node',
  args: [
    '/absolute/path/to/index.js',
    '/absolute/path/to/arc-timeline.db'
  ]
};
fs.writeFileSync(p, JSON.stringify(j, null, 2));
console.log('Backup at ' + backup);
"
```
Replace the two `/absolute/path/to/…` strings with the real paths from Step 2 and the user's `.db` location. The script writes a timestamped backup before mutating — mention the backup path to the user so they can revert if anything goes wrong.

If `~/.claude.json` doesn't exist yet (rare — usually means the user has never run Claude Code), create it with just `{"mcpServers": {...}}`.

### If you are Codex

Append to `~/.codex/config.toml` (create it if missing):
```toml
[mcp_servers.arc-timeline]
command = "node"
args = [
  "/absolute/path/to/index.js",
  "/absolute/path/to/arc-timeline.db",
]
```
If `[mcp_servers.arc-timeline]` already exists, replace it.

### If you are Claude Desktop

Edit the JSON file at the platform-specific path from Step 1. Merge in:
```json
{
  "mcpServers": {
    "arc-timeline": {
      "command": "node",
      "args": ["/absolute/path/to/index.js", "/absolute/path/to/arc-timeline.db"]
    }
  }
}
```
**Read the existing file first. Preserve every other key. Merge — don't overwrite.**

---

## Step 5 — Tell the user to restart their AI client

The new MCP server only loads on client startup. Tell the user:

> "I've installed and configured the Arc Timeline MCP server. **Please quit and reopen your AI client now**, then come back and ask me about your timeline."

Don't try to verify the server is live yourself — you can't see it until the client restarts.

---

## Step 6 — After restart, verify

Once the user comes back, call the `get_export_info` tool. If it returns a row showing the export date, day count, and date range, the server is live.

If `get_export_info` doesn't exist as a callable tool, the server isn't registered correctly. Re-check the config file and ask the user to restart again.

---

## What the server exposes (for reference once installed)

**Tools (read-only):**
- `run_sql` — execute a SELECT (or WITH … SELECT). Most powerful tool; use this for anything the named tools don't cover. **Always call `get_schema` first** so you know the column names.
- `get_schema` — full schema description with usage examples.
- `get_export_info` — staleness, day range, which optional tables were populated.
- `get_activity_summary`, `get_monthly_summary`, `get_daily_stats` — activity rollups by date range.
- `get_day_timeline` — full visit + activity list for one day.
- `get_date_range_places` — every place visited in a range.
- `get_top_locations`, `search_locations`, `find_location_visits`, `get_location_details` — place queries.
- `find_days_in_region` — bounding-box GPS search.
- `get_elevation_stats` — highest/lowest altitude.
- `search_notes` — FTS5 full-text search over diary notes.

**Resources:**
- `arc://day/YYYY-MM-DD` — raw JSON blob of one day (only present if the user opted in at export time).

---

## Privacy reminder to mention to the user (once)

The server runs entirely on the user's machine and exposes their timeline data — **including raw GPS if they enabled it** — to whichever model the user's AI client is configured to use. Unlike the AI Chat tab inside Arc Reader (which strips coordinates and addresses before sending), this MCP path sends whatever you ask for. That's the tradeoff for getting frontier-model intelligence on data the user's existing subscription already pays for.

Mention this once after setup so the user understands. Don't bring it up again every conversation.

---

## Updating the data later

The `.db` file is a snapshot. When the user wants newer data:
1. They go back to Arc Reader → Analysis → MCP Server tab → **Export database** again.
2. They overwrite the existing `.db` file at the same path (or put the new one at a new path and update the client config).
3. The server picks up the new file on its next tool call — no restart needed.

If they re-export, the `exported_at` value in `get_export_info` tells you the new snapshot date.
