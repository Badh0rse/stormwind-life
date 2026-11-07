// Discord embeds in Princess Posse colors. The System AI narrates, as in game.
const { EmbedBuilder } = require('discord.js');
const G = require('./guild');

const BOT_NAME = process.env.BOT_NAME || 'SYSTEM AI';
const PINK = 0xFF2E9A, YELLOW = 0xFFD60A, CYAN = 0x44DBFF, GREEN = 0x4CFF7A;
const TIER_COLOR = { b: 0xD08C4F, s: 0xC9CFD6, g: 0xFFD60A, l: 0xFF8A3D, c: 0x5EE3FF };
const CLASS_ICON = { WARRIOR: '⚔️', PALADIN: '🔨', HUNTER: '🏹', ROGUE: '🗡️', PRIEST: '✨', SHAMAN: '⚡', MAGE: '❄️', WARLOCK: '💀', DRUID: '🐾', DEATHKNIGHT: '☠️', MONK: '☯️', DEMONHUNTER: '🦇', EVOKER: '🐉' };
const CLASS_COLOR = { WARRIOR: 0xC69B6D, PALADIN: 0xF48CBA, HUNTER: 0xAAD372, ROGUE: 0xFFF468, PRIEST: 0xFFFFFF, SHAMAN: 0x0070DD, MAGE: 0x3FC7EB, WARLOCK: 0x8788EE, DRUID: 0xFF7C0A, DEATHKNIGHT: 0xC41E3A, MONK: 0x00FF98, DEMONHUNTER: 0xA330C9, EVOKER: 0x33937F };
const KIND = { REQUEST: ['HELP WANTED', PINK], GROUP: ['GROUP FORMING', CYAN], EVENT: ['EVENT', YELLOW] };
const SLOTS = { 1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Ring', 12: 'Ring', 13: 'Trinket', 14: 'Trinket', 15: 'Back', 16: 'Main hand', 17: 'Off hand', 18: 'Ranged', 19: 'Tabard' };

const QUIPS = [
  'The System has logged this. The System logs everything.',
  'Your feet have been notified.',
  'Sponsors are watching. Smile.',
  'This message will self-destruct. It will not.',
  'The System is proud of you. That is a lie.',
];
const quip = () => QUIPS[Math.floor(Math.random() * QUIPS.length)];
const ago = t => t ? `<t:${Math.floor(t)}:R>` : 'a while ago';
const s = G.short;

function base(title, color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: `${BOT_NAME} · Princess Posse` });
}

function recordEmbed(r, signups) {
  const [label, color] = KIND[r.kind] || ['POST', PINK];
  const e = base(`${label}: ${r.title}`, color);
  const details = r.kind === 'EVENT' ? G.eventDetails(r) : (r.details || '');
  const when = r.kind === 'EVENT' ? G.eventTime(r) : null;
  const lines = [];
  if (details) lines.push(details);
  if (when) lines.push(`**When:** <t:${when}:F> (<t:${when}:R>)`);
  lines.push(`**Posted by:** ${s(r.owner)} · ${ago(r.created)}`);
  if (r.status && r.status !== 'OPEN') lines.push(`**Status:** ${r.status}`);
  e.setDescription(lines.join('\n'));
  if (signups) {
    const c = { Tank: [], Healer: [], DPS: [], Maybe: [] };
    for (const v of Object.values(signups)) if (c[v.role]) c[v.role].push(v.name);
    for (const role of ['Tank', 'Healer', 'DPS', 'Maybe']) {
      const icon = role === 'Maybe' ? '❔' : G.ROLE_ICON[role];
      const names = c[role].slice(0, 15).join('\n') + (c[role].length > 15 ? `\n+${c[role].length - 15} more` : '');
      e.addFields({ name: `${icon} ${role === 'Maybe' ? 'Maybe' : role + (role === 'DPS' ? '' : 's')} (${c[role].length})`, value: names || '—', inline: true });
    }
  }
  return e;
}

function joinEmbed(m) {
  const verb = m.kind === 'JOIN' ? 'joined the guild!' : m.kind === 'KICK' ? 'was removed from the guild.' : 'left the guild.';
  const e = base(`${s(m.name)} ${verb}`, m.kind === 'JOIN' ? GREEN : 0x777777);
  return e.setDescription(m.quip ? `*"${m.quip}"*` : (m.kind === 'JOIN' ? '*Welcome, crawler. Wipe your feet.*' : '*The System will not miss them. The System misses no one.*'));
}

function achEmbed(x) {
  const a = x.a; const tier = G.ACH.tiers[a.tier] || ['', 0];
  const voice = a.theme ? (G.ACH.narrator[a.theme] || 'The System') : 'The System';
  return base(`🏆 ${s(x.who)} earned ${a.name}`, TIER_COLOR[a.tier] || YELLOW)
    .setDescription(`${a.desc}\n\n*"${a.quip}"*\n— ${voice}`)
    .addFields({ name: 'Tier', value: `${tier[0]} · ${tier[1]} pts`, inline: true });
}

function profileEmbed(p, rosterRow) {
  const e = base(`${CLASS_ICON[p.class] || ''} ${s(p.name)} · ${p.level ? 'Level ' + p.level : ''} ${p.race || ''} ${cap(p.class)}`.trim(), CLASS_COLOR[p.class] || PINK);
  const lines = [];
  if (p.roleInfo) lines.push(`**Role:** ${G.ROLE_ICON[p.roleInfo.role]} ${p.roleInfo.role}${p.roleInfo.also && p.roleInfo.also.length ? ' (also ' + p.roleInfo.also.join(', ') + ')' : ''} · *from ${p.roleInfo.how}*${p.roleInfo.note ? ` · ${p.roleInfo.note}` : ''}`);
  if (p.ilvl) lines.push(`**Item level:** ${p.ilvl}`);
  if (p.spec) lines.push(`**Talents:** ${p.spec}`);
  if (p.roles && p.roles.length) lines.push(`**Roles:** ${p.roles.join(', ')}`);
  if (rosterRow) lines.push(`**Rank:** ${rosterRow.rank || '?'} · ${rosterRow.online ? '🟢 online' : rosterRow.seenDays != null ? `last seen ${Math.round(rosterRow.seenDays)} d ago` : 'offline'}`);
  if (p.main) lines.push(`**Alt of:** ${s(p.main)}`);
  if (p.bio) lines.push(`> ${String(p.bio).slice(0, 200)}`);
  e.setDescription(lines.join('\n') || 'No details shared yet.');
  if (p.professions.length) e.addFields({ name: 'Professions', value: p.professions.map(x => `${x.name} ${x.rank}/${x.max}`).join('\n').slice(0, 1000), inline: true });
  const gear = Object.entries(p.gear).filter(([k]) => SLOTS[k] && k !== '4' && k !== '19').map(([k, g]) => `${SLOTS[k]}: ${g.name || 'item #' + g.id}`);
  if (gear.length) e.addFields({ name: 'Gear', value: gear.join('\n').slice(0, 1000), inline: true });
  e.addFields({ name: 'Updated', value: ago(p.updated), inline: true });
  return e;
}
const cap = c => c ? c.charAt(0) + c.slice(1).toLowerCase().replace('knight', ' Knight').replace('hunter', ' Hunter') : '';

function rosterEmbed(snap, onlineOnly) {
  let rows = snap.roster.length ? snap.roster : Object.entries(snap.levels).map(([name, level]) => ({ name, level }));
  if (onlineOnly) rows = rows.filter(r => r.online);
  rows = rows.slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.level || 0) - (a.level || 0));
  const online = snap.roster.filter(r => r.online).length;
  const lines = rows.slice(0, 40).map(r => `${r.online ? '🟢' : '⚫'} ${r.roleInfo ? G.ROLE_ICON[r.roleInfo.role] : ''} **${s(r.name)}** · ${r.level || '?'} ${CLASS_ICON[String(r.class || '').toUpperCase()] || ''} ${cap(r.class)}${r.rank ? ' · ' + r.rank : ''}${r.online && r.zone ? ' · ' + r.zone : ''}`);
  if (rows.length > 40) lines.push(`…and ${rows.length - 40} more`);
  const count = role => rows.filter(r => r.roleInfo && r.roleInfo.role === role).length;
  return base(`${snap.guild || 'Guild'} roster · ${online} online of ${snap.roster.length || rows.length}`, PINK)
    .setDescription(`${G.ROLE_ICON.Tank} ${count('Tank')} tanks · ${G.ROLE_ICON.Healer} ${count('Healer')} healers · ${G.ROLE_ICON.DPS} ${count('DPS')} DPS · ${G.ROLE_ICON.Flex} ${count('Flex')} flex\n\n` + (lines.join('\n') || 'Nobody here. Suspicious.'))
    .addFields({ name: 'As of', value: ago(snap.rosterAt), inline: true });
}

function rolesEmbed(snap, onlineOnly) {
  let rows = snap.roster.length ? snap.roster : Object.values(snap.profiles).map(p => ({ name: p.name, level: p.level, class: p.class, roleInfo: p.roleInfo }));
  if (onlineOnly) rows = rows.filter(r => r.online);
  const e = base(`${snap.guild || 'Guild'} by role${onlineOnly ? ' (online now)' : ''}`, PINK);
  for (const role of ['Tank', 'Healer', 'DPS', 'Flex']) {
    const list = rows.filter(r => r.roleInfo && r.roleInfo.role === role).sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.level || 0) - (a.level || 0));
    const txt = list.slice(0, 25).map(r => `${r.online ? '🟢' : '⚫'} ${s(r.name)} (${r.level || '?'} ${cap(r.class)})`).join('\n') + (list.length > 25 ? `\n…+${list.length - 25}` : '');
    e.addFields({ name: `${G.ROLE_ICON[role]} ${role === 'Flex' ? 'Flex / not sure yet' : role + (role === 'DPS' ? '' : 's')} (${list.length})`, value: txt || '—', inline: true });
  }
  return e.setDescription('Worked out from class and talents. A role picked in the addon always wins.');
}

module.exports = { rolesEmbed, BOT_NAME, recordEmbed, joinEmbed, achEmbed, profileEmbed, rosterEmbed, base, quip, ago, PINK, YELLOW, CYAN, GREEN };
