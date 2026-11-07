// SYSTEM AI: the Princess Posse Discord bot (rename it with BOT_NAME and in the Developer Portal).
//   * Discord: /posse commands, auto-posted guild news.
//   * HTTP:    POST /api/upload  (the PC uploader sends the addon's saved data)
//              GET  /api/inbox   (the uploader fetches posts made in Discord, as a Lua file)
//              GET  /            (health check)
// Both API calls need:  Authorization: Bearer <UPLOAD_SECRET>
// Optional .env file next to package.json (handy on panel hosts that only take files).
try {
  const envFile = require('path').join(__dirname, '..', '.env');
  for (const line of require('fs').readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}
const http = require('http');
const crypto = require('crypto');
const { Client, GatewayIntentBits, Events, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ART = require('./art');
const { parseSV } = require('./svparse');
const G = require('./guild');
const F = require('./format');
const store = require('./store');
const { commands } = require('./commands');

const env = process.env;
const TOKEN = env.DISCORD_TOKEN;
const SECRET = env.UPLOAD_SECRET || '';
const PORT = Number(env.PORT || env.SERVER_PORT || 3000);
const TZ = env.TIMEZONE || 'America/New_York';
const OFFICER_ROLE = env.OFFICER_ROLE_ID || '';
const MAX_UPLOAD = 8 * 1024 * 1024;

const state = store.load();
// Greeting new Discord members needs the "Server Members Intent" switch in the Developer Portal.
// If it is off, the bot still starts (without greetings) and says so in the log.
const WELCOME_ON = (env.WELCOME_NEW_MEMBERS || 'on').toLowerCase() !== 'off';
const makeClient = withMembers => new Client({ intents: withMembers ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] : [GatewayIntentBits.Guilds] });
let client = makeClient(WELCOME_ON);
const WELCOME = [...require('./welcome_lines.json'), ...require('./welcome_discord.json')];
let welcomeBag = [];
function welcomeLine(mention) {
  // Shuffle-bag: every line is used once before any repeats.
  if (!welcomeBag.length) { welcomeBag = WELCOME.map((_, k) => k); for (let k = welcomeBag.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [welcomeBag[k], welcomeBag[j]] = [welcomeBag[j], welcomeBag[k]]; } }
  return WELCOME[welcomeBag.pop()].replace(/\{name\}/g, mention).replace(/\{names\}/g, mention);
}

// ---------------------------------------------------------------- helpers
const snap = () => state.snapshot;
const noData = 'No guild data yet. The System is waiting for the PC uploader to send it (log in to WoW once with the uploader running).';
const ephemeral = { flags: MessageFlags.Ephemeral };

function feedChannel() {
  const id = state.feedChannelId || env.FEED_CHANNEL_ID;
  return id ? client.channels.cache.get(id) || null : null;
}
async function announce(embeds) {
  const ch = feedChannel(); if (!ch || !embeds.length) return;
  for (let i = 0; i < embeds.length; i += 10) {
    try { await ch.send({ embeds: embeds.slice(i, i + 10) }); } catch (e) { console.error('announce failed:', e.message); }
  }
}
function isOfficer(i) {
  if (i.memberPermissions && i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!(OFFICER_ROLE && i.member && i.member.roles && (i.member.roles.cache ? i.member.roles.cache.has(OFFICER_ROLE) : (i.member.roles || []).includes(OFFICER_ROLE)));
}
// "2026-11-14 20:00" in the configured time zone -> unix seconds
function parseWhen(text) {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})\s*$/.exec(text || '');
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).map(p => [p.type, p.value]));
  const asTz = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.floor((guess - (asTz - guess)) / 1000);
}
const openEvents = () => (snap() ? snap().records : []).filter(r => r.kind === 'EVENT' && (r.status || 'OPEN') === 'OPEN')
  .map(r => ({ r, when: G.eventTime(r) })).filter(x => !x.when || x.when > Date.now() / 1000 - 3 * 3600).sort((a, b) => (a.when || 0) - (b.when || 0));

// Discord roles, colored like the game: Tank / Healer / DPS (the group-finder colors and symbols)
// and one role per class in its class color. AUTO_ROLES=on (default) creates them in your server
// the first time; you can rename, recolor or move them afterwards and the bot keeps using them.
// Role icons (the little symbol next to names) need a server with Boost level 2; otherwise only the color shows.
const ROLE_STYLE = {
  Tank:   { color: 0x3B82F6, emoji: '🛡️' },   // blue shield
  Healer: { color: 0x22C55E, emoji: '💚' },   // green (the picture icon is a green cross)
  DPS:    { color: 0xEF4444, emoji: '⚔️' },   // red swords
};
const CLASS_STYLE = {
  WARRIOR: { name: 'Warrior', color: 0xC69B6D, emoji: '⚔️' }, PALADIN: { name: 'Paladin', color: 0xF48CBA, emoji: '🔨' },
  HUNTER: { name: 'Hunter', color: 0xAAD372, emoji: '🏹' }, ROGUE: { name: 'Rogue', color: 0xFFF468, emoji: '🗡️' },
  PRIEST: { name: 'Priest', color: 0xFFFFFF, emoji: '✨' }, SHAMAN: { name: 'Shaman', color: 0x0070DD, emoji: '⚡' },
  MAGE: { name: 'Mage', color: 0x3FC7EB, emoji: '❄️' }, WARLOCK: { name: 'Warlock', color: 0x8788EE, emoji: '💀' },
  DRUID: { name: 'Druid', color: 0xFF7C0A, emoji: '🐾' }, DEATHKNIGHT: { name: 'Death Knight', color: 0xC41E3A, emoji: '☠️' },
  MONK: { name: 'Monk', color: 0x00FF98, emoji: '☯️' }, DEMONHUNTER: { name: 'Demon Hunter', color: 0xA330C9, emoji: '🦇' },
  EVOKER: { name: 'Evoker', color: 0x33937F, emoji: '🐉' },
};
const AUTO_ROLES = (env.AUTO_ROLES || 'on').toLowerCase() !== 'off';
const CLASS_ROLES = (env.CLASS_ROLES || 'on').toLowerCase() !== 'off';
function roleIds() {
  const r = state.roleIds || {};
  return { Tank: env.ROLE_TANK_ID || r.Tank, Healer: env.ROLE_HEALER_ID || r.Healer, DPS: env.ROLE_DPS_ID || r.DPS };
}
function serverGuild() { const gid = env.DISCORD_SERVER_ID; return gid ? client.guilds.cache.get(gid) : client.guilds.cache.first(); }
async function ensureRole(guild, key, name, style) {
  state.roleIds = state.roleIds || {};
  let role = state.roleIds[key] && guild.roles.cache.get(state.roleIds[key]);
  if (!role) role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (!role) {
    role = await guild.roles.create({ name, color: style.color, hoist: key in ROLE_STYLE, mentionable: key in ROLE_STYLE, reason: 'Princess Posse roles' });
  }
  // Role icons (the symbol next to names) need Boost level 2. Tank/Healer/DPS get the colored pictures.
  if (guild.features && guild.features.includes('ROLE_ICONS') && !role.icon && !role.unicodeEmoji) {
    try { if (key in ROLE_STYLE) await role.setIcon(ART.roleIcon(key)); else await role.setUnicodeEmoji(style.emoji); }
    catch { await Promise.resolve().then(() => role.setUnicodeEmoji(style.emoji)).catch(() => {}); }
  }
  state.roleIds[key] = role.id;
  return role;
}
async function ensureAllRoles() {
  const guild = serverGuild(); if (!guild || !AUTO_ROLES) return;
  try {
    await guild.roles.fetch();
    for (const [k, st] of Object.entries(ROLE_STYLE)) if (!env[`ROLE_${k.toUpperCase()}_ID`]) await ensureRole(guild, k, k, st);
    if (CLASS_ROLES) for (const [k, st] of Object.entries(CLASS_STYLE)) await ensureRole(guild, 'class:' + k, st.name, st);
    store.save();
    console.log('Roles ready (Tank / Healer / DPS' + (CLASS_ROLES ? ' + classes' : '') + ').');
  } catch (e) { console.error('Could not create roles (give the bot "Manage Roles"):', e.message); }
}
function linkedInfo(userId) {
  const name = state.links && state.links[userId]; const s = snap();
  if (!name || !s) return null;
  const p = s.profiles[name]; const r = s.roster.find(x => x.name === name);
  return { role: (p && p.roleInfo) || (r && r.roleInfo) || null, cls: String((p && p.class) || (r && r.class) || '').toUpperCase().replace(/\s/g, '') };
}
function roleOfLinked(userId) { const x = linkedInfo(userId); return x && x.role; }
async function syncMemberRole(guild, userId) {
  const x = linkedInfo(userId); if (!guild || !x) return null;
  const ids = roleIds(); const info = x.role;
  const want = new Set();
  if (info) { if (ids[info.role]) want.add(ids[info.role]); for (const a of info.also || []) if (ids[a]) want.add(ids[a]); }
  const classIds = CLASS_ROLES ? Object.keys(CLASS_STYLE).map(k => state.roleIds && state.roleIds['class:' + k]).filter(Boolean) : [];
  const myClass = CLASS_ROLES && state.roleIds && state.roleIds['class:' + x.cls];
  if (myClass) want.add(myClass);
  const managed = new Set([...Object.values(ids).filter(Boolean), ...classIds]);
  if (!managed.size) return info && info.role;
  try {
    const member = await guild.members.fetch(userId);
    for (const id of managed) {
      const has = member.roles.cache.has(id);
      if (want.has(id) && !has) await member.roles.add(id, 'Princess Posse role from class/talents');
      if (!want.has(id) && has) await member.roles.remove(id, 'Princess Posse role changed');
    }
    return info ? info.role : null;
  } catch (e) { console.error('role sync failed:', e.message); return null; }
}
async function syncAllRoles() {
  if (!state.links) return;
  const guild = serverGuild();
  for (const userId of Object.keys(state.links)) await syncMemberRole(guild, userId);
}

// Colored Tank / Healer / DPS symbols. They are uploaded as the bot's own emojis (no server boost or
// permission needed), so the blue shield, green cross and red swords show everywhere the bot writes.
const BUTTON_EMOJI = { Tank: { name: '🛡️' }, Healer: { name: '💚' }, DPS: { name: '⚔️' }, Maybe: { name: '❔' } };
async function ensureEmojis(c) {
  try {
    const have = await c.application.emojis.fetch();
    for (const role of ['Tank', 'Healer', 'DPS']) {
      const name = `pp_${role.toLowerCase()}`;
      const e = have.find(x => x.name === name) || await c.application.emojis.create({ attachment: ART.roleIcon(role), name });
      G.ROLE_ICON[role] = `<:${name}:${e.id}>`;
      BUTTON_EMOJI[role] = { id: e.id, name };
    }
    console.log('Role symbols ready.');
  } catch (e) { console.error('Could not upload role symbols (using plain emoji):', e.message); }
}
// An event card with signup buttons under it.
function eventMsg(r) {
  const list = state.signups[r.id] || {};
  const btn = (role, style, label) => new ButtonBuilder().setCustomId(`su:${r.id}:${role}`).setLabel(label).setStyle(style).setEmoji(BUTTON_EMOJI[role] || { name: '✖️' });
  const row = new ActionRowBuilder().addComponents(
    btn('Tank', ButtonStyle.Primary, 'Tank'), btn('Healer', ButtonStyle.Success, 'Healer'), btn('DPS', ButtonStyle.Danger, 'DPS'),
    btn('Maybe', ButtonStyle.Secondary, 'Maybe'),
    new ButtonBuilder().setCustomId(`su:${r.id}:Remove`).setLabel('Leave').setStyle(ButtonStyle.Secondary));
  return { embeds: [F.recordEmbed(r, list)], components: [row] };
}
async function onButton(i) {
  const [, id, role] = i.customId.split(':');
  const ev = openEvents().find(x => x.r.id === id);
  if (!ev) return i.reply({ content: 'That event is over or was cancelled. The System has moved on.', ...ephemeral });
  const list = state.signups[id] = state.signups[id] || {};
  if (role === 'Remove') delete list[i.user.id]; else list[i.user.id] = { role, name: i.member && i.member.displayName || i.user.username };
  store.save();
  return i.update(eventMsg(ev.r));
}
// The welcome card: a random picture + a random System AI line.
function welcomeMsg(userId) {
  const file = ART.welcomeArt(); const name = 'welcome' + require('path').extname(file);
  return {
    content: `<@${userId}>`,
    embeds: [F.base('🎀 NEW CRAWLER DETECTED', F.PINK).setDescription(welcomeLine(`<@${userId}>`)).setImage(`attachment://${name}`)],
    files: [{ attachment: file, name }],
    allowedMentions: { users: [userId] },
  };
}
function tenureMsg(member, months) {
  const t = ART.tenure(months);
  return {
    content: `<@${member.id}>`,
    embeds: [F.base(`🏆 ${member.displayName} earned ${t.name}`, t.color).setDescription(`*"${t.quip}"*\n— The System`)
      .addFields({ name: 'Member since', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true }).setImage('attachment://badge.jpg')],
    files: [{ attachment: t.file, name: 'badge.jpg' }],
    allowedMentions: { users: [member.id] },
  };
}
// Checks every few hours who reached a monthly anniversary. The first run only records where
// everyone is, so turning the bot on never floods the channel.
const TENURE_ON = (env.TENURE_BADGES || 'on').toLowerCase() !== 'off';
async function checkTenure() {
  const guild = serverGuild(); if (!guild || !TENURE_ON) return;
  const ch = feedChannel() || (state.welcomeChannelId && guild.channels.cache.get(state.welcomeChannelId)) || (guild.systemChannelId && guild.channels.cache.get(guild.systemChannelId));
  let members;
  try { members = await guild.members.fetch(); } catch (e) { return; } // needs Server Members Intent
  state.tenure = state.tenure || {};
  const first = !state.tenureBaseline;
  for (const m of members.values()) {
    if (m.user.bot || !m.joinedAt) continue;
    const months = ART.monthsBetween(m.joinedAt);
    const prev = state.tenure[m.id];
    if (first || prev == null) { state.tenure[m.id] = months; continue; }
    if (months > prev) {
      state.tenure[m.id] = months;
      if (ch && ART.isMilestone(months)) await ch.send(tenureMsg(m, months)).catch(e => console.error('badge failed:', e.message));
    }
  }
  state.tenureBaseline = true; store.save();
}

// ---------------------------------------------------------------- upload handling
function ingest(text) {
  const parsed = parseSV(text);
  const db = parsed.PrincessPosseDB;
  if (!db || typeof db !== 'object') throw new Error('not a Princess Posse saved file');
  const s = G.snapshotFrom(db);
  // Posts made in Discord that the game has now imported can leave the queue.
  const done = db.discordDone || {};
  state.inbox = state.inbox.filter(e => !done[e.id]);
  const news = G.diff(s, state.seen);
  state.snapshot = s; state.syncedAt = Math.floor(Date.now() / 1000);
  const first = !state.baseline; state.baseline = true;
  store.save();
  if (!first) {
    const embeds = [
      ...news.records.filter(r => r.kind !== 'EVENT').map(r => F.recordEmbed(r, state.signups[r.id])),
      ...news.joins.map(F.joinEmbed),
      ...news.achievements.slice(-15).map(F.achEmbed),
    ];
    announce(embeds);
    const ch = feedChannel();
    if (ch) for (const r of news.records.filter(r => r.kind === 'EVENT')) ch.send(eventMsg(r)).catch(e => console.error('announce failed:', e.message));
  }
  syncAllRoles().catch(() => {});
  const counted = first ? { posts: 0, joins: 0, achievements: 0 } : { posts: news.records.length, joins: news.joins.length, achievements: news.achievements.length };
  return { first, ...counted, roster: s.roster.length, profiles: Object.keys(s.profiles).length };
}

function luaString(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ') + '"'; }
function inboxLua() {
  const rows = state.inbox.map(e => `  {id=${luaString(e.id)},kind=${luaString(e.kind)},title=${luaString(e.title)},details=${luaString(e.details || '')},by=${luaString(e.by || '')}${e.when ? `,when=${Math.floor(e.when)}` : ''}},`);
  return '-- Written by the Princess Posse Discord uploader. Do not edit by hand.\nPrincessPosse_DiscordInbox = {\n' + rows.join('\n') + (rows.length ? '\n' : '') + '}\n';
}

function authed(req) {
  const h = req.headers.authorization || '';
  const got = Buffer.from(h.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(SECRET);
  return SECRET.length >= 16 && got.length === want.length && crypto.timingSafeEqual(got, want);
}
const server = http.createServer((req, res) => {
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/') return send(200, { ok: true, bot: client.user ? client.user.tag : null, syncedAt: state.syncedAt });
  if (!req.url.startsWith('/api/')) return send(404, { error: 'not found' });
  if (!authed(req)) return send(401, { error: 'bad or missing secret' });
  if (req.method === 'GET' && req.url === '/api/inbox') return send(200, inboxLua(), 'text/plain; charset=utf-8');
  if (req.method === 'POST' && req.url === '/api/upload') {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { send(200, { ok: true, ...ingest(Buffer.concat(chunks).toString('utf8')) }); }
      catch (e) { console.error('upload failed:', e.message); send(400, { error: e.message }); }
    });
    return;
  }
  send(404, { error: 'not found' });
});

// ---------------------------------------------------------------- commands
async function handle(i) {
  const sub = i.options.getSubcommand();
  const s = snap();
  if (sub === 'status') {
    return i.reply({ embeds: [F.base(`${F.BOT_NAME} status`, F.CYAN).setDescription([
      `**Last sync from the game:** ${state.syncedAt ? F.ago(state.syncedAt) : 'never'}`,
      `**Guild:** ${s && s.guild || '?'} · **Addon:** ${s && s.version || '?'}`,
      `**Posts waiting to go into the game:** ${state.inbox.length}`,
      `**News channel:** ${feedChannel() ? `<#${feedChannel().id}>` : 'not set (use /posse setfeed)'}`,
      `*${F.quip()}*`].join('\n'))] });
  }
  if (sub === 'help') {
    return i.reply({ embeds: [F.base(`🎀 ${F.BOT_NAME} · what I can do`, F.PINK)
      .setDescription(`Everything lives under \`/posse\`. *${F.quip()}*`)
      .addFields(
        { name: '👥 The guild', value: '`roster` who is in (and online)\n`roles` tanks, healers, DPS\n`profile` gear, talents, professions\n`crafters` who can make it' },
        { name: `${G.ROLE_ICON.Tank} You`, value: '`iam` link your main: you get your\nTank / Healer / DPS + class role' },
        { name: '📋 Boards & events', value: '`board` Help Wanted & groups\n`post` add to the board\n`events` upcoming, with signup buttons\n`event` plan one · `signup` join one' },
        { name: '🏆 Bragging', value: '`leaderboard` achievement points\n`achievements` recent unlocks' },
        { name: '🛠️ Admins', value: '`setfeed` news channel · `setwelcome` greetings\n`officer` inactive, trials, bans · `status` last sync' },
        { name: '🎉 Automatic', value: 'Greets new members with a picture, posts guild news, and gives monthly anniversary badges (1-11 months, then a big one each year).' })
      .setThumbnail(client.user ? client.user.displayAvatarURL() : null)], ...ephemeral });
  }
  if (sub === 'setfeed') {
    if (!i.memberPermissions || !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: 'Only server admins can choose the news channel.', ...ephemeral });
    state.feedChannelId = i.channelId; store.save();
    return i.reply({ content: `Guild news will be posted here. *${F.quip()}*` });
  }
  if (sub === 'setwelcome') {
    if (!i.memberPermissions || !i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return i.reply({ content: 'Only server admins can choose the welcome channel.', ...ephemeral });
    state.welcomeChannelId = i.channelId; store.save();
    const sample = welcomeMsg(i.user.id);
    return i.reply({ ...sample, content: 'New members will be greeted here, each with a random picture and line. Sample:', allowedMentions: { parse: [] } });
  }
  if (sub === 'post' || sub === 'event') {
    const title = i.options.getString('title').trim();
    const details = (i.options.getString('details') || '').trim();
    let when = null;
    if (sub === 'event') {
      when = parseWhen(i.options.getString('when'));
      if (!when) return i.reply({ content: 'Use a date like `2026-11-14 20:00`.', ...ephemeral });
    }
    const kind = sub === 'event' ? 'EVENT' : i.options.getString('type');
    const entry = { id: `d${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`, kind, title, details, when, by: i.member && i.member.displayName || i.user.username, at: Date.now() };
    state.inbox.push(entry); store.save();
    const preview = F.recordEmbed({ kind, title: `${title} (${entry.by} on Discord)`, details: when ? `@${when}@${details}` : details, owner: entry.by, created: Math.floor(Date.now() / 1000) });
    return i.reply({ content: 'Queued. It goes onto the in-game boards for everyone after the next sync (someone with the uploader logs in or types /reload).', embeds: [preview] });
  }
  if (!s) return i.reply({ content: noData, ...ephemeral });
  if (sub === 'roster') return i.reply({ embeds: [F.rosterEmbed(s, !!i.options.getBoolean('online'))] });
  if (sub === 'roles') return i.reply({ embeds: [F.rolesEmbed(s, !!i.options.getBoolean('online'))] });
  if (sub === 'iam') {
    const all = [...new Set([...Object.keys(s.profiles), ...s.roster.map(r => r.name)])];
    const name = G.findName(all, i.options.getString('name'));
    if (!name) return i.reply({ content: 'No crawler by that name in the guild data yet.', ...ephemeral });
    state.links = state.links || {}; state.links[i.user.id] = name; store.save();
    const info = roleOfLinked(i.user.id);
    const given = await syncMemberRole(i.guild, i.user.id);
    return i.reply({ content: `Linked you to **${G.short(name)}**: ${info ? `${G.ROLE_ICON[info.role]} ${info.role} (from ${info.how})` : 'role unknown'}.${given ? ' Your Discord role is set.' : ''} It updates by itself when your talents change.`, ...ephemeral });
  }
  if (sub === 'profile') {
    const name = G.findName(Object.keys(s.profiles), i.options.getString('name'));
    if (!name) {
      const r = G.findName(s.roster.map(x => x.name), i.options.getString('name'));
      const row = r && s.roster.find(x => x.name === r);
      if (row) return i.reply({ embeds: [F.base(`${G.short(row.name)} · Level ${row.level} ${row.class || ''}`, F.PINK).setDescription(`${row.rank || ''}\nNo armory profile shared yet. They need the addon (and to log in once).`)] });
      return i.reply({ content: 'No crawler by that name. The System checked twice.', ...ephemeral });
    }
    return i.reply({ embeds: [F.profileEmbed(s.profiles[name], s.roster.find(x => x.name === name))] });
  }
  if (sub === 'crafters') {
    const q = i.options.getString('item');
    const hits = G.crafters(s, q);
    if (!hits.length) return i.reply({ content: `Nobody who shares recipes can make "${q}" yet.`, ...ephemeral });
    const byWho = {};
    for (const h of hits) (byWho[h.who] = byWho[h.who] || []).push(`${h.recipe} (${h.prof})`);
    const lines = Object.entries(byWho).slice(0, 15).map(([w, l]) => `**${G.short(w)}**: ${l.slice(0, 4).join(', ')}${l.length > 4 ? ` +${l.length - 4} more` : ''}`);
    return i.reply({ embeds: [F.base(`Made by the guild: "${q}"`, F.YELLOW).setDescription(lines.join('\n'))] });
  }
  if (sub === 'board') {
    const open = s.records.filter(r => r.kind !== 'EVENT' && (r.status || 'OPEN') === 'OPEN').sort((a, b) => (b.created || 0) - (a.created || 0));
    const queued = state.inbox.filter(e => e.kind !== 'EVENT');
    if (!open.length && !queued.length) return i.reply({ content: 'The board is empty. Suspiciously self-sufficient guild.' });
    const lines = open.slice(0, 15).map(r => `${r.kind === 'GROUP' ? '👥' : '🆘'} **${r.title}** · ${G.short(r.owner)} · ${F.ago(r.created)}${r.details ? `\n  ${r.details.slice(0, 120)}` : ''}`);
    for (const q of queued) lines.push(`⏳ **${q.title}** · ${q.by} (waiting to sync)`);
    return i.reply({ embeds: [F.base('Help Wanted & Groups', F.PINK).setDescription(lines.join('\n'))] });
  }
  if (sub === 'events') {
    const ev = openEvents();
    if (!ev.length) return i.reply({ content: 'No events planned. Make one with `/posse event`.' });
    await i.reply(eventMsg(ev[0].r));
    for (const x of ev.slice(1, 5)) await i.followUp(eventMsg(x.r));
    return;
  }
  if (sub === 'signup') {
    const id = i.options.getString('event'); let role = i.options.getString('role');
    if (!role) { const info = roleOfLinked(i.user.id); if (!info || info.role === 'Flex') return i.reply({ content: 'Pick a role, or link your character first with `/posse iam`.', ...ephemeral }); role = info.role; }
    const ev = openEvents().find(x => x.r.id === id);
    if (!ev) return i.reply({ content: 'Pick an event from the list.', ...ephemeral });
    const list = state.signups[id] = state.signups[id] || {};
    if (role === 'Remove') delete list[i.user.id]; else list[i.user.id] = { role, name: i.member && i.member.displayName || i.user.username };
    store.save();
    return i.reply({ content: role === 'Remove' ? 'Signup removed. The System has noted your cowardice.' : `Signed up as ${G.ROLE_ICON[role] || ''} **${role}**.`, ...eventMsg(ev.r) });
  }
  if (sub === 'leaderboard') {
    const rows = G.leaderboard(s).slice(0, 15);
    const medal = ['🥇', '🥈', '🥉'];
    return i.reply({ embeds: [F.base('Achievement leaderboard', F.YELLOW).setDescription(rows.map((r, k) => `${medal[k] || `**${k + 1}.**`} ${G.short(r.who)}${r.title ? `, ${r.title}` : ''} · **${r.pts}** pts (${r.n})`).join('\n') || 'Nobody has achieved anything. Classic.')] });
  }
  if (sub === 'achievements') {
    const filter = i.options.getString('name');
    const all = [];
    if (s.me) for (const [id, t] of Object.entries(s.myAch)) all.push({ who: s.me, id, t });
    for (const [who, l] of Object.entries(s.othersAch)) for (const [id, t] of Object.entries(l || {})) all.push({ who, id, t });
    let rows = all.filter(x => G.ACH_BY_ID[x.id]);
    if (filter) { const n = G.findName([...new Set(rows.map(r => r.who))], filter); rows = rows.filter(r => r.who === n); }
    rows.sort((a, b) => (b.t || 0) - (a.t || 0));
    if (!rows.length) return i.reply({ content: 'No achievements found. The System is disappointed but not surprised.', ...ephemeral });
    return i.reply({ embeds: [F.base(filter ? `Achievements: ${filter}` : 'Recent guild achievements', F.YELLOW)
      .setDescription(rows.slice(0, 15).map(x => { const a = G.ACH_BY_ID[x.id]; return `🏆 **${G.short(x.who)}**: ${a.name} · ${F.ago(x.t)}\n  *"${a.quip}"*`; }).join('\n'))] });
  }
  if (sub === 'officer') {
    if (!isOfficer(i)) return i.reply({ content: 'Officers only. The System has reported you to the officers. (It has not.)', ...ephemeral });
    const view = i.options.getString('view');
    let lines = [];
    if (view === 'inactive') lines = s.roster.filter(r => !r.online && r.seenDays != null && r.seenDays >= 14).sort((a, b) => b.seenDays - a.seenDays).slice(0, 30).map(r => `**${G.short(r.name)}** · ${r.level} · ${r.rank || ''} · ${Math.round(r.seenDays)} days`);
    if (view === 'trials') lines = Object.entries(s.trials).map(([n, t]) => `**${G.short(n)}** · sponsor ${G.short(t.sponsor)} · ends <t:${t.ends}:R>`);
    if (view === 'bans') lines = Object.entries(s.bans).map(([n, t]) => `**${G.short(n)}** · banned ${F.ago(typeof t === 'number' ? t : null)}`);
    return i.reply({ embeds: [F.base({ inactive: 'Inactive 14+ days', trials: 'Trial members', bans: 'Ban list' }[view], 0x888888).setDescription(lines.join('\n') || 'Nothing here.')], ...ephemeral });
  }
}

async function autocomplete(i) {
  const s = snap(); const f = i.options.getFocused(true); const q = String(f.value || '').toLowerCase();
  let choices = [];
  if (f.name === 'name' && s) choices = [...new Set([...Object.keys(s.profiles), ...s.roster.map(r => r.name)])].map(n => ({ name: G.short(n), value: G.short(n) }));
  if (f.name === 'event') choices = openEvents().map(x => ({ name: `${x.r.title}${x.when ? ' · ' + new Date(x.when * 1000).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}`.slice(0, 100), value: x.r.id }));
  await i.respond(choices.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25)).catch(() => {});
}

function wire(client) {
client.on(Events.GuildMemberAdd, async member => {
  if (member.user.bot) return;
  const id = state.welcomeChannelId || env.WELCOME_CHANNEL_ID || (member.guild.systemChannelId);
  const ch = id && member.guild.channels.cache.get(id);
  if (!ch) return;
  state.tenure = state.tenure || {}; state.tenure[member.id] = 0; store.save();
  try { await ch.send(welcomeMsg(member.id)); } catch (e) { console.error('welcome failed:', e.message); }
});
client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isAutocomplete()) return autocomplete(i);
    if (i.isButton() && i.customId.startsWith('su:')) return await onButton(i);
    if (i.isChatInputCommand() && i.commandName === 'posse') return await handle(i);
  } catch (e) {
    console.error('command failed:', e);
    const msg = { content: 'Something broke. The System blames you. (Check the bot logs.)', ...ephemeral };
    if (i.replied || i.deferred) i.followUp(msg).catch(() => {}); else if (i.reply) i.reply(msg).catch(() => {});
  }
});
client.once(Events.ClientReady, async c => {
  console.log(`${F.BOT_NAME} online as ${c.user.tag}`);
  // Register /posse. With DISCORD_SERVER_ID it appears instantly in that server; without, globally (can take up to an hour).
  try {
    if (env.DISCORD_SERVER_ID) await c.application.commands.set(commands, env.DISCORD_SERVER_ID);
    else await c.application.commands.set(commands);
    console.log('Slash commands registered.');
  } catch (e) { console.error('Could not register commands:', e.message); }
  await ensureEmojis(c);
  await ensureAllRoles();
  syncAllRoles().catch(() => {});
  checkTenure().catch(e => console.error('tenure check failed:', e.message));
  setInterval(() => checkTenure().catch(() => {}), 6 * 3600 * 1000).unref();
});
}
wire(client);

module.exports = { checkTenure, ensureEmojis, eventMsg, welcomeMsg, tenureMsg, onButton, ensureAllRoles, syncAllRoles, ROLE_STYLE, CLASS_STYLE, ingest, inboxLua, parseWhen, handle, state, server, getClient: () => client, welcomeLine };

if (require.main === module) {
  if (!TOKEN) { console.error('DISCORD_TOKEN is missing.'); process.exit(1); }
  if (SECRET.length < 16) { console.error('UPLOAD_SECRET must be at least 16 characters.'); process.exit(1); }
  server.listen(PORT, () => console.log(`HTTP on :${PORT}`));
  client.login(TOKEN).catch(e => {
    if (WELCOME_ON && /disallowed intents/i.test(e.message)) {
      console.error('Greetings are off: turn on "Server Members Intent" (Developer Portal > Bot) to greet new members. Starting without it.');
      client.destroy(); client = makeClient(false); wire(client); client.login(TOKEN);
    } else { console.error('Login failed:', e.message); process.exit(1); }
  });
}
