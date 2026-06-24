// Shared Discord config for Risa's server scripts
// Token: set DISCORD_BOT_TOKEN in .env file (copy .env.example) or export as env var

const fs = require('fs');
const path = require('path');

// Load .env from project root if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function getToken() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN not set. Copy .env.example to .env and add your token.');
  }
  return process.env.DISCORD_BOT_TOKEN;
}

const GUILD_ID = '1102597418299703347';

const CHANNELS = {
  welcome:                  '1102597419297931357',
  rules:                    '1298127028779876355',
  announcements:            '1160265369198526544',
  'moderator-only':         '1298127028779876355',
  priv:                     '1214614664403623986',
  'clips-vods':             '1198821119864610898',
  'stream-objectives':      '1262232444522987530',
  chatters:                 '1102600550836600865',
  'movies-tv-shows':        '1501332767072583751',
  'documents-resources':    '1471908356875620588',
  'daily-goals':            '1379954772324651079',
  'game-suggestions':       '1163494587109757038',
  boo:                      '1165621655855439892',
  'other-pets-aka-not-boo': '1261677073458794588',
  ootd:                     '1176649815115960341',
  musica:                   '1269285858758885407',
  foodies:                  '1270534581535379466',
  'book-club':              '1299751009593069578',
  'french-talkers':         '1175241449630085170',
  'workout-gym':            '1362050051005743325',
  fishing:                  '1306403733550403644',
  'legendary-quotes':       '1369016285178101760',
  nails:                    '1490663889711530076',
};

async function apiFetch(endpoint) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    headers: { Authorization: `Bot ${getToken()}` },
  });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const wait = (body.retry_after || 1) * 1000;
    process.stderr.write(`Rate limited. Waiting ${wait}ms...\n`);
    await new Promise(r => setTimeout(r, wait));
    return apiFetch(endpoint);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Discord API ${res.status}: ${err.message || res.statusText} (${endpoint})`);
  }
  return res.json();
}

async function fetchMessages(channelId, { pages = 4, before = null } = {}) {
  let all = [], lastId = before;
  for (let i = 0; i < pages; i++) {
    let url = `/channels/${channelId}/messages?limit=100`;
    if (lastId) url += `&before=${lastId}`;
    const batch = await apiFetch(url);
    if (!batch.length) break;
    all = all.concat(batch);
    lastId = batch[batch.length - 1].id;
    process.stderr.write(`  page ${i + 1}: ${batch.length} messages (total: ${all.length})\n`);
    if (batch.length < 100) break;
  }
  return all;
}

function resolveChannel(nameOrId) {
  if (CHANNELS[nameOrId]) return CHANNELS[nameOrId];
  if (/^\d+$/.test(nameOrId)) return nameOrId;
  throw new Error(`Unknown channel: "${nameOrId}". Known: ${Object.keys(CHANNELS).join(', ')}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// Resolve a member by user ID (snowflake) or display/username search.
// Returns the full member object or throws if not found / ambiguous.
async function resolveMember(nameOrId) {
  if (/^\d+$/.test(nameOrId)) {
    return apiFetch(`/guilds/${GUILD_ID}/members/${nameOrId}`);
  }
  const results = await apiFetch(
    `/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(nameOrId)}&limit=10`
  );
  if (!results.length) throw new Error(`No member found matching "${nameOrId}".`);
  if (results.length === 1) return results[0];
  const names = results.map(m => m.user.global_name || m.user.username).join(', ');
  throw new Error(`Ambiguous: "${nameOrId}" matches ${results.length} members: ${names}. Use a more specific name or user ID.`);
}

// Parse a duration string like 10m, 2h, 1d into milliseconds.
function parseDuration(str) {
  const m = str.match(/^(\d+)(m|h|d)$/);
  if (!m) throw new Error(`Invalid duration "${str}". Use format: 10m, 2h, 1d`);
  const n = parseInt(m[1]);
  const mult = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return n * mult;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bot ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const wait = (data.retry_after || 1) * 1000;
    process.stderr.write(`Rate limited. Waiting ${wait}ms...\n`);
    await new Promise(r => setTimeout(r, wait));
    return apiPost(endpoint, body);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Discord API ${res.status}: ${err.message || res.statusText} (${endpoint})`);
  }
  return res.json();
}

async function apiPatch(endpoint, body) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Discord API ${res.status}: ${err.message || res.statusText} (${endpoint})`);
  }
  return res.json();
}

async function apiDelete(endpoint, body = undefined) {
  const opts = {
    method: 'DELETE',
    headers: { Authorization: `Bot ${getToken()}` },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, opts);
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Discord API ${res.status}: ${err.message || res.statusText} (${endpoint})`);
  }
  return res.json();
}

async function apiPut(endpoint, body = {}) {
  const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Discord API ${res.status}: ${err.message || res.statusText} (${endpoint})`);
  }
  return res.json();
}

module.exports = {
  GUILD_ID, CHANNELS,
  apiFetch, apiPost, apiPatch, apiDelete, apiPut,
  fetchMessages, resolveChannel, resolveMember, parseDuration, parseArgs,
};
