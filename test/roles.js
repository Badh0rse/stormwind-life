// Fake Discord server: checks the bot creates colored roles and gives a linked member the right ones.
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/pproles-');
process.env.NO_LOGIN = '1';
const assert = require('assert');
const fs = require('fs'), path = require('path');
const bot = require('../src/index.js');
const client = bot.getClient();
let n = 0; const roles = new Map();
const mk = o => ({ id: 'r' + (++n), ...o, setUnicodeEmoji: async e => { o.icon = e; roles.get('r' + n); } });
const memberRoles = new Set();
const guild = {
  id: 'g1', features: ['ROLE_ICONS'],
  roles: { cache: roles, fetch: async () => roles, create: async o => { const r = mk(o); r.setUnicodeEmoji = async e => { r.unicodeEmoji = e; }; r.setIcon = async f => { r.icon = f; }; roles.set(r.id, r); return r; } },
  members: { fetch: async () => ({ roles: { cache: { has: id => memberRoles.has(id) }, add: async id => memberRoles.add(id), remove: async id => memberRoles.delete(id) } }) },
};
roles.find = fn => [...roles.values()].find(fn);
client.guilds.cache.set('g1', guild);
(async () => {
  await bot.ensureAllRoles();
  const names = [...roles.values()].map(r => r.name);
  assert.deepStrictEqual(names.slice(0, 3), ['Tank', 'Healer', 'DPS']);
  assert.strictEqual(names.length, 16);
  const byName = Object.fromEntries([...roles.values()].map(r => [r.name, r]));
  assert.strictEqual(byName.Tank.color, 0x3B82F6); assert.ok(/role_tank\.png$/.test(byName.Tank.icon));
  assert.strictEqual(byName.Paladin.color, 0xF48CBA); assert.strictEqual(byName.Paladin.unicodeEmoji, '🔨');
  // Running again must not duplicate.
  await bot.ensureAllRoles(); assert.strictEqual(roles.size, 16);
  // Link a member to a protection paladin.
  bot.state.snapshot = { roster: [], profiles: { 'Bob-Forever': { name: 'Bob-Forever', class: 'PALADIN', roleInfo: { role: 'Tank', how: 'Protection talents' } } }, records: [] };
  bot.state.links = { u1: 'Bob-Forever' };
  await bot.syncAllRoles();
  assert.ok(memberRoles.has(byName.Tank.id) && memberRoles.has(byName.Paladin.id) && memberRoles.size === 2);
  // Respec to holy: tank role swaps to healer.
  bot.state.snapshot.profiles['Bob-Forever'].roleInfo = { role: 'Healer', how: 'Holy talents' };
  await bot.syncAllRoles();
  assert.ok(memberRoles.has(byName.Healer.id) && !memberRoles.has(byName.Tank.id) && memberRoles.size === 2);
  console.log('roles test ok:', names.join(', '));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
