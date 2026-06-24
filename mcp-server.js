#!/usr/bin/env node
// MCP server exposing Discord and Twitch/Chatty log query tools to Claude.
// Run via: claude mcp add discord-logs -- node /path/to/mcp-server.js
'use strict';

const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const SDK = path.join(__dirname, 'node_modules/@modelcontextprotocol/sdk/dist/cjs');
const { Server } = require(`${SDK}/server/index.js`);
const { StdioServerTransport } = require(`${SDK}/server/stdio.js`);
const { ListToolsRequestSchema, CallToolRequestSchema } = require(`${SDK}/types.js`);
const { apiFetch, CHANNELS, resolveChannel, GUILD_ID } = require('./discord_config.js');

const execFileAsync = promisify(execFile);
const CHATTY_QUERY = path.join(os.homedir(), 'Projects/chatty-log-query/chatty_query.py');

// ---------------------------------------------------------------------------
// Chatty helpers
// ---------------------------------------------------------------------------

async function runChattyQuery(args) {
  const { stdout } = await execFileAsync('python3', [CHATTY_QUERY, ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function daysArgs(days) {
  return days != null ? ['--days', String(days)] : [];
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'discord_search',
    description: 'Search Discord messages by content keyword across the whole server or a specific channel.',
    inputSchema: {
      type: 'object',
      properties: {
        query:   { type: 'string', description: 'Text to search for' },
        channel: { type: 'string', description: 'Channel name or ID (optional — omit to search all)' },
        limit:   { type: 'number', description: 'Max results 1-25 (default 25)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'discord_channel_stats',
    description: 'Message count and top-chatter stats for a Discord channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name or ID (default: chatters)' },
        pages:   { type: 'number', description: 'Pages of 100 messages to fetch (default 4)' },
      },
      required: [],
    },
  },
  {
    name: 'discord_list_channels',
    description: 'List all known Discord channel names and their IDs.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'twitch_search',
    description: 'Search Twitch chat logs (Chatty) for messages matching a pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Twitch channel name (without #)' },
        pattern: { type: 'string', description: 'Regex or plain string (case-insensitive)' },
        days:    { type: 'number', description: 'How many recent days to search (default: all)' },
        user:    { type: 'string', description: 'Filter by sender username (optional)' },
      },
      required: ['channel', 'pattern'],
    },
  },
  {
    name: 'twitch_user_messages',
    description: 'Fetch all Twitch chat messages from a specific user in a channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Twitch channel name (without #)' },
        user:    { type: 'string', description: 'Username to look up' },
        days:    { type: 'number', description: 'How many recent days to search (default: all)' },
      },
      required: ['channel', 'user'],
    },
  },
  {
    name: 'twitch_top_chatters',
    description: 'Rank Twitch chatters by message count in a channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Twitch channel name (without #)' },
        days:    { type: 'number', description: 'How many recent days (default: all time)' },
        limit:   { type: 'number', description: 'Number of results (default 20)' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'twitch_events',
    description: 'Query Twitch sub/bits/giftsub events in a channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Twitch channel name (without #)' },
        type:    { type: 'string', enum: ['bits', 'sub', 'giftsub'], description: 'Event type filter (optional)' },
        user:    { type: 'string', description: 'Filter by username (optional)' },
        days:    { type: 'number', description: 'How many recent days (default: all)' },
        top:     { type: 'boolean', description: 'Rank/aggregate results instead of listing (requires type)' },
        limit:   { type: 'number', description: 'Limit for --top mode (default 20)' },
      },
      required: ['channel'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleDiscordSearch({ query, channel, limit = 25 }) {
  const channelId = channel ? resolveChannel(channel) : null;
  const params = new URLSearchParams({ content: query, limit: Math.min(limit, 25) });
  if (channelId) params.append('channel_id', channelId);
  const data = await apiFetch(`/guilds/${GUILD_ID}/messages/search?${params}`);
  const messages = data.messages?.flat() || [];
  if (!messages.length) return `No results for "${query}".`;
  const lines = messages.map(m => {
    const author = m.author.global_name || m.author.username;
    const ts = new Date(m.timestamp).toLocaleString();
    const chName = Object.entries(CHANNELS).find(([, id]) => id === m.channel_id)?.[0] ?? m.channel_id;
    return `[${ts}] #${chName}  ${author}: ${m.content.replace(/\n/g, ' ').slice(0, 200)}`;
  });
  return `${messages.length} result(s) for "${query}":\n\n${lines.join('\n')}`;
}

async function handleDiscordChannelStats({ channel = 'chatters', pages = 4 }) {
  const channelId = resolveChannel(channel);
  let all = [], lastId = null;
  for (let i = 0; i < pages; i++) {
    let url = `/channels/${channelId}/messages?limit=100`;
    if (lastId) url += `&before=${lastId}`;
    const batch = await apiFetch(url);
    if (!batch.length) break;
    all = all.concat(batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < 100) break;
  }
  const authorCounts = {};
  for (const m of all) {
    const name = m.author.global_name || m.author.username;
    authorCounts[name] = (authorCounts[name] || 0) + 1;
  }
  const top = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const topStr = top.map(([name, n], i) => `  ${i + 1}. ${name}: ${n}`).join('\n');
  return `#${channel} — ${all.length} messages, ${Object.keys(authorCounts).length} chatters\n\nTop chatters:\n${topStr}`;
}

function handleDiscordListChannels() {
  const lines = Object.entries(CHANNELS).map(([name, id]) => `${name.padEnd(30)} ${id}`);
  return `Known channels (${lines.length}):\n\n${lines.join('\n')}`;
}

async function handleTwitchSearch({ channel, pattern, days, user }) {
  const args = ['search', '-c', channel, pattern, ...daysArgs(days)];
  if (user) args.push('-u', user);
  const out = await runChattyQuery(args);
  return out || `No messages matching "${pattern}" in #${channel}.`;
}

async function handleTwitchUserMessages({ channel, user, days }) {
  const args = ['messages', '-c', channel, '-u', user, ...daysArgs(days)];
  const out = await runChattyQuery(args);
  return out || `No messages from ${user} in #${channel}.`;
}

async function handleTwitchTopChatters({ channel, days, limit = 20 }) {
  const args = ['top-chatters', '-c', channel, '-n', String(limit), ...daysArgs(days)];
  const out = await runChattyQuery(args);
  return out || `No data for #${channel}.`;
}

async function handleTwitchEvents({ channel, type, user, days, top, limit = 20 }) {
  const args = ['events', '-c', channel, ...daysArgs(days)];
  if (type) args.push('--type', type);
  if (user) args.push('-u', user);
  if (top) { args.push('--top'); args.push('-n', String(limit)); }
  const out = await runChattyQuery(args);
  return out || `No events found in #${channel}.`;
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'discord-logs', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  let text;
  try {
    switch (name) {
      case 'discord_search':        text = await handleDiscordSearch(args);        break;
      case 'discord_channel_stats': text = await handleDiscordChannelStats(args);  break;
      case 'discord_list_channels': text = handleDiscordListChannels();             break;
      case 'twitch_search':         text = await handleTwitchSearch(args);         break;
      case 'twitch_user_messages':  text = await handleTwitchUserMessages(args);   break;
      case 'twitch_top_chatters':   text = await handleTwitchTopChatters(args);    break;
      case 'twitch_events':         text = await handleTwitchEvents(args);         break;
      default: text = `Unknown tool: ${name}`;
    }
  } catch (err) {
    text = `Error: ${err.message}`;
  }
  return { content: [{ type: 'text', text }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('discord-logs MCP server running\n');
}

main().catch(err => { process.stderr.write(`Fatal: ${err.message}\n`); process.exit(1); });
