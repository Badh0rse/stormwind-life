// Turns the addon's saved data (PrincessPosseDB) into the guild snapshot the bot uses, and
// works out what is new since the last upload. Pure functions: easy to test.
const ACH = require('./achievements.json');
const ACH_BY_ID = Object.fromEntries(ACH.list.map(a => [a.id, a]));

const vals = o => (o && typeof o === 'object') ? Object.values(o) : [];
const short = n => String(n || '').split('-')[0];

function snapshotFrom(db) {
  const d = db.discord || {};
  const profiles = {};
  for (const [name, p] of Object.entries(db.profiles || {})) {
    if (!p || typeof p !== 'object') continue;
    const recipes = {};
    for (const [prof, ids] of Object.entries(p.recipes || {})) {
      recipes[prof] = (Array.isArray(ids) ? ids : vals(ids)).map(id => (d.spells && d.spells[id]) || `Recipe #${id}`);
    }
    const gear = {};
    for (const [slot, link] of Object.entries(p.items || {})) {
      const id = Number((String(link).match(/item:(\d+)/) || [])[1]);
      if (id) gear[slot] = { id, name: (d.items && d.items[id]) || null };
    }
    profiles[name] = {
      name, class: p.class, race: p.race, level: p.level, spec: p.spec,
      ilvl: p.ilvlCalc || p.ilvl || null, roles: vals(p.roles), bio: p.bio || null,
      professions: vals(p.professions).map(x => ({ name: x.name, rank: x.rank, max: x.max })),
      recipes, gear, main: p.main || null, updated: p.updated || p.received || 0,
      talents: vals(p.talents).map(t => ({ name: t.name, points: t.points || 0 })),
    };
    Object.assign(profiles[name], { roleInfo: roleFor({ ...profiles[name], roles: vals(p.roles) }) });
  }
  const recs = (t, kind) => vals(t).filter(o => o && o.id).map(o => ({ ...o, kind }));
  const ach = db.ach || {};
  const out = {
    guild: d.guild || null,
    me: d.me || null,
    version: d.version || null,
    rosterAt: d.rosterAt || 0,
    roster: vals(d.roster).map(r => r ? ({ ...r }) : r).filter(Boolean),
    levels: db.levels || {},
    profiles,
    records: [...recs(db.requests, 'REQUEST'), ...recs(db.groups, 'GROUP'), ...recs(db.events, 'EVENT')],
    rsvps: db.rsvps || {},
    memberLog: vals(db.memberLog),
    activity: vals(db.activity),
    myAch: ach.earned || {},
    othersAch: ach.others || {},
    totals: ach.totals || {},
    trials: db.trials || {},
    bans: db.blacklist || {},
  };
  // Every roster row gets a role: from the shared profile when there is one, else from class.
  for (const r of out.roster) r.roleInfo = (profiles[r.name] && profiles[r.name].roleInfo) || roleFor({ class: r.class });
  return out;
}

// Event details are stored as "@<unix time>@details".
function eventTime(rec) { const m = /^@(\d+)@/.exec(rec.details || ''); return m ? Number(m[1]) : null; }
function eventDetails(rec) { return String(rec.details || '').replace(/^@\d+@/, ''); }

// What is new compared with what was already announced. Mutates `seen` to remember.
function diff(snap, seen, opts = {}) {
  const out = { records: [], joins: [], achievements: [] };
  const now = opts.now || Math.floor(Date.now() / 1000);
  // Only things that happened since the previous upload count as news (minus a little slack),
  // so turning the bridge on later never floods the channel with old stuff.
  const since = (seen.lastSync || 0) - 600;
  for (const r of snap.records) {
    if (seen.records[r.id]) continue;
    seen.records[r.id] = r.status || 'OPEN';
    if ((r.status || 'OPEN') === 'OPEN' && (r.created || now) >= since && (now - (r.created || now)) < 7 * 86400) out.records.push(r);
  }
  let maxT = seen.joinsT || 0;
  for (const m of snap.memberLog) {
    if ((m.t || 0) > (seen.joinsT || 0)) {
      const act = snap.activity.find(a => Math.abs((a.t || 0) - m.t) < 5 && a.text && a.text.includes(short(m.name)));
      if (m.t >= since) out.joins.push({ ...m, quip: act && act.quip });
      if (m.t > maxT) maxT = m.t;
    }
  }
  seen.joinsT = maxT;
  const addAch = (who, id, t) => {
    const key = `${who}|${id}`;
    if (seen.ach[key]) return;
    seen.ach[key] = t || 1;
    const a = ACH_BY_ID[id];
    if (a && (t || now) >= since && (now - (t || now)) < 3 * 86400) out.achievements.push({ who, a, t });
  };
  if (snap.me) for (const [id, t] of Object.entries(snap.myAch)) addAch(snap.me, id, t);
  for (const [who, list] of Object.entries(snap.othersAch)) for (const [id, t] of Object.entries(list || {})) addAch(who, id, t);
  seen.lastSync = now;
  out.joins.sort((a, b) => a.t - b.t);
  out.achievements.sort((a, b) => (a.t || 0) - (b.t || 0));
  return out;
}

// Role from class + talents. A role the player picked in the addon always wins; otherwise the
// talent tree with the most points decides; with no talents yet, pure damage classes are DPS and
// hybrids show as "Flex" until they spend points.
const TREE_ROLE = {
  WARRIOR: { Arms: 'DPS', Fury: 'DPS', Protection: 'Tank' },
  PALADIN: { Holy: 'Healer', Protection: 'Tank', Retribution: 'DPS' },
  PRIEST: { Discipline: 'Healer', Holy: 'Healer', Shadow: 'DPS' },
  SHAMAN: { Elemental: 'DPS', Enhancement: 'DPS', Restoration: 'Healer' },
  DRUID: { Balance: 'DPS', 'Feral Combat': 'Tank', Feral: 'Tank', Guardian: 'Tank', Restoration: 'Healer' },
  DEATHKNIGHT: { Blood: 'Tank', Frost: 'DPS', Unholy: 'DPS' },
  MONK: { Brewmaster: 'Tank', Mistweaver: 'Healer', Windwalker: 'DPS' },
  EVOKER: { Preservation: 'Healer', Devastation: 'DPS', Augmentation: 'DPS' },
  DEMONHUNTER: { Vengeance: 'Tank', Havoc: 'DPS' },
};
const PURE_DPS = new Set(['HUNTER', 'ROGUE', 'MAGE', 'WARLOCK']);
const ROLE_NAMES = { TANK: 'Tank', HEALER: 'Healer', HEAL: 'Healer', HEALS: 'Healer', DPS: 'DPS', DAMAGE: 'DPS' };
function roleFor(p) {
  if (!p) return { role: 'Flex', how: 'unknown' };
  const picked = (p.roles || []).map(r => ROLE_NAMES[String(r).toUpperCase()]).filter(Boolean);
  if (picked.length) return { role: picked[0], also: picked.slice(1), how: 'picked in addon' };
  const cls = String(p.class || '').toUpperCase().replace(/\s/g, '');
  const trees = (p.talents || []).filter(t => t && t.points > 0).sort((a, b) => b.points - a.points);
  if (trees.length && TREE_ROLE[cls] && TREE_ROLE[cls][trees[0].name]) {
    const role = TREE_ROLE[cls][trees[0].name];
    return { role, how: `${trees[0].name} talents`, note: cls === 'DRUID' && role === 'Tank' ? 'Feral: tank or cat DPS' : undefined };
  }
  if (PURE_DPS.has(cls)) return { role: 'DPS', how: 'class' };
  return { role: 'Flex', how: trees.length ? 'talents' : 'no talents yet' };
}
const ROLE_ICON = { Tank: '🛡️', Healer: '💚', DPS: '⚔️', Flex: '❔' };

// Fuzzy name lookup: "zul" finds "Zul'grim-Forever".
function findName(names, q) {
  const n = String(q || '').toLowerCase().replace(/[^a-z0-9À-ɏ]/g, '');
  if (!n) return null;
  const norm = s => short(s).toLowerCase().replace(/[^a-z0-9À-ɏ]/g, '');
  return names.find(x => norm(x) === n) || names.find(x => norm(x).startsWith(n)) || names.find(x => norm(x).includes(n)) || null;
}

function crafters(snap, q) {
  const needle = String(q || '').toLowerCase();
  const hits = [];
  for (const p of Object.values(snap.profiles)) {
    for (const [prof, list] of Object.entries(p.recipes)) {
      for (const r of list) if (r.toLowerCase().includes(needle)) hits.push({ who: p.name, prof, recipe: r });
    }
  }
  return hits;
}

function leaderboard(snap) {
  const rows = Object.entries(snap.totals).map(([who, t]) => ({ who, pts: t.pts || 0, n: t.n || 0, weekPts: t.weekPts || 0, title: t.title }));
  // Make sure the uploader's own character is on the board too.
  if (snap.me && !rows.find(r => r.who === snap.me)) {
    let pts = 0, n = 0;
    for (const id of Object.keys(snap.myAch)) { const a = ACH_BY_ID[id]; if (a) { pts += ACH.tiers[a.tier][1]; n++; } }
    rows.push({ who: snap.me, pts, n, weekPts: 0 });
  }
  return rows.sort((a, b) => b.pts - a.pts);
}

module.exports = { roleFor, ROLE_ICON, snapshotFrom, diff, findName, crafters, leaderboard, eventTime, eventDetails, short, ACH, ACH_BY_ID };
