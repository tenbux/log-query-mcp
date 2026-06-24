# log-query-mcp

MCP server exposing Discord and Twitch/Chatty chat log query tools to Claude Code.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set DISCORD_BOT_TOKEN
```

Register with Claude Code (global):

```bash
claude mcp add discord-logs -- node /path/to/log-query-mcp/mcp-server.js
```

## Twitch logs

Requires [chatty-log-query](https://github.com/sweinstein/chatty-log-query) checked out at `~/Projects/chatty-log-query`. Reads Chatty log files from `~/.chatty/logs/`.

## Tools

### Discord

| Tool | Description |
|------|-------------|
| `discord_search` | Search messages by content across server or channel |
| `discord_channel_stats` | Message count and top chatters for a channel |
| `discord_list_channels` | List all known channel names and IDs |

### Twitch (Chatty logs)

| Tool | Description |
|------|-------------|
| `twitch_search` | Regex/string search across channel logs |
| `twitch_user_messages` | All messages from a user in a channel |
| `twitch_top_chatters` | Rank chatters by message count |
| `twitch_events` | Query sub/bits/giftsub events |

## Environment

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal |
