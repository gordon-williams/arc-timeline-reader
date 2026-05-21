# Arc Timeline MCP Server

A small [Model Context Protocol](https://modelcontextprotocol.io) server that exposes an [Arc Reader](https://github.com/gordon-williams/Timeline-Reader---Claude-Code) timeline database (exported as SQLite) to any MCP-compatible AI client — Claude Code, Codex, Claude Desktop, and others.

The server is **read-only**. The `run_sql` tool refuses any statement that isn't a `SELECT` (or `WITH … SELECT`). No data leaves your machine except whatever your AI client sends to its model.

---

## Setup

### Recommended: have your AI install it

1. Open Arc Reader → Analysis → **MCP Server** tab → click **Export database**, save the `.db` file.
2. Copy the prompt from the **"Let your AI install it for you"** card on that same tab.
3. Paste it into Claude Code, Codex, or Claude Desktop. Your AI will read [INSTALL-FOR-AI.md](INSTALL-FOR-AI.md), clone the repo, install Node deps, register the server with itself, and tell you when to restart.

### Manual

1. Export the `.db` as above.
2. Install the server:

   ```bash
   git clone https://github.com/gordon-williams/Timeline-Reader---Claude-Code.git
   cd Timeline-Reader---Claude-Code/mcp-server
   npm install
   ```

   Requires **Node.js 18+**.

3. Verify it works:

   ```bash
   node index.js /path/to/arc-timeline.db --selftest
   ```

   You should see your day count, date range, and per-table row counts.

---

## Configuring your AI client

Replace `/path/to/index.js` and `/path/to/arc-timeline.db` with absolute paths on your machine.

### Claude Code

Add to `~/.config/claude-code/mcp.json` (or run `claude mcp add`):

```json
{
  "mcpServers": {
    "arc-timeline": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js", "/path/to/arc-timeline.db"]
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.arc-timeline]
command = "node"
args = ["/path/to/mcp-server/index.js", "/path/to/arc-timeline.db"]
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "arc-timeline": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js", "/path/to/arc-timeline.db"]
    }
  }
}
```

Then restart the client.

---

## What the server exposes

### Tools

| Tool                    | What it does |
|-------------------------|--------------|
| `run_sql`               | Run a read-only SELECT. **The most powerful tool** — Claude writes SQL fluently. |
| `get_schema`            | Returns a description of every table with usage examples. Call this first. |
| `get_export_info`       | When was the DB exported, what day range, what app build. Useful for "is this stale?" |
| `get_activity_summary`  | Totals (count/distance/duration) by activity type for a date range. |
| `get_monthly_summary`   | Per-month rollup, optionally filtered to one activity type. |
| `get_daily_stats`       | Per-day totals over a date range (up to 365 days). |
| `get_day_timeline`      | Every visit and activity for one day, in order. |
| `get_date_range_places` | Every named place visited in a date range. |
| `get_top_locations`     | Top N locations by visits or duration. |
| `search_locations`      | Substring search over location names. |
| `find_location_visits`  | Visit history for locations matching a query. |
| `get_location_details`  | Full details + last 100 visits for one location. |
| `find_days_in_region`   | Bounding-box GPS search ("when did I go to Japan?"). |
| `get_elevation_stats`   | Highest / lowest altitude samples. |
| `search_notes`          | FTS5 full-text search over diary notes. |

### Resources

The server also lists each day as a resource (`arc://day/YYYY-MM-DD`). Clients that support resources can pull a full day's raw blob without going through SQL.

---

## Refreshing the data

The .db file is a snapshot. To pick up new days, re-export from the **MCP Server** tab and overwrite the file. The server reloads automatically on every query — no restart needed.

If you want the server to point at a different file, update the path in your client's config and restart the client.

---

## Privacy notes

- The export skips API keys, tokens, and anything in browser metadata whose key matches `token`, `secret`, `api[_-]?key`, `password`, or `credential`.
- Unlike the in-browser **AI Chat** tab (which strips coordinates and addresses), this server returns whatever the AI client asks for — including raw GPS. That's the tradeoff for getting frontier-model intelligence.
- The server only listens on stdio. It does not open any network sockets.

---

## Troubleshooting

**`Error: database file not found`** — check the absolute path in your client config.

**`schema version mismatch` warning** — the export was produced by a newer (or older) Arc Reader than this server expects. Most tools will still work, but `get_schema` may not match reality. Update the server or re-export from a matching app version.

**Client doesn't see the server** — restart the client after editing config. Run `node index.js /path/to/your.db --selftest` to confirm the server itself is healthy.

**Queries time out** — `run_sql` caps results at 1000 rows; very expensive queries (full table scans on `gps_samples`) can still take seconds on a large database. Filter by `day_key` or use indexes.
