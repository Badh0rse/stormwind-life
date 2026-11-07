// Pictures, anniversary badges, colored role emojis, event buttons and /posse help.
process.env.DATA_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/ppx-');
const assert = require('assert'); const fs = require('fs');
const bot = require('../src/index.js'); const ART = require('../src/art'); const G = require('../src/guild');
const client = bot.getClient();
(async () => {
  // art
  assert.strictEqual(ART.WELCOME.length, 24);
  const seen = new Set(); for (let k = 0; k < 24; k++) seen.add(ART.welcomeArt()); assert.strictEqual(seen.size, 24, 'shuffle bag');
  for (let m = 1; m <= 12; m++) assert.ok(fs.existsSync(ART.tenure(m).file), 'badge ' + m);
  assert.ok(fs.existsSync(ART.tenure(24).file) && /2 Years/.test(ART.tenure(24).name));
  assert.strictEqual(ART.monthsBetween(new Date('2026-01-31'), new Date('2026-02-28')), 0);
  assert.strictEqual(ART.monthsBetween(new Date('2026-01-15'), new Date('2026-02-15')), 1);
  assert.ok(ART.isMilestone(1) && ART.isMilestone(12) && !ART.isMilestone(13) && ART.isMilestone(24));
  for (const r of ['Tank','Healer','DPS']) assert.ok(fs.existsSync(ART.roleIcon(r)));
  // welcome
  const w = bot.welcomeMsg('u9'); assert.ok(w.files[0].attachment && /attachment:\/\/welcome/.test(w.embeds[0].data.image.url) && /<@u9>/.test(w.embeds[0].data.description));
  // emojis
  const made = [];
  client.application = { emojis: { fetch: async () => ({ find: () => null }), create: async o => { made.push(o.name); return { id: 'e' + made.length }; } } };
  await bot.ensureEmojis(client);
  assert.deepStrictEqual(made, ['pp_tank', 'pp_healer', 'pp_dps']); assert.strictEqual(G.ROLE_ICON.Healer, '<:pp_healer:e2>');
  // events with buttons
  const now = Math.floor(Date.now() / 1000);
  bot.state.snapshot = { roster: [], profiles: {}, records: [{ id: 'ev1', kind: 'EVENT', title: 'Raid night', details: `@${now + 86400}@Bring snacks`, owner: 'Bob-Forever', created: now }], memberLog: [], activity: [] };
  const em = bot.eventMsg(bot.state.snapshot.records[0]);
  const btns = em.components[0].components.map(b => b.data);
  assert.strictEqual(btns.length, 5); assert.strictEqual(btns[1].emoji.id, 'e2'); assert.strictEqual(btns[0].style, 1);
  let updated;
  const click = (u, role) => bot.onButton({ customId: `su:ev1:${role}`, user: { id: u, username: u }, member: { displayName: u.toUpperCase() }, update: async m => { updated = m; }, reply: async m => { updated = m; } });
  await click('a', 'Tank'); await click('b', 'Healer'); await click('c', 'DPS'); await click('c', 'Remove');
  const f = updated.embeds[0].data.fields; assert.ok(/Tanks \(1\)/.test(f[0].name) && f[0].value === 'A' && /pp_healer/.test(f[1].name) && /DPS \(0\)/.test(f[2].name));
  // tenure: baseline first, then only new milestones
  const sent = []; const ch = { send: async m => sent.push(m) };
  const day = 86400000; const members = new Map();
  const mem = (id, daysAgo) => members.set(id, { id, user: { bot: false }, displayName: 'P' + id, joinedAt: new Date(Date.now() - daysAgo * day), joinedTimestamp: Date.now() - daysAgo * day });
  mem('m1', 20); mem('m2', 400);
  const guild = { id: 'g', roles: { cache: new Map(), fetch: async () => {} }, channels: { cache: new Map([['c', ch]]) }, systemChannelId: 'c', members: { fetch: async () => members } };
  client.guilds.cache.set('g', guild);
  await bot.checkTenure(); assert.strictEqual(sent.length, 0, 'baseline is silent');
  mem('m1', 32); await bot.checkTenure();
  assert.strictEqual(sent.length, 1); assert.ok(/One Month Survived/.test(sent[0].embeds[0].data.title) && sent[0].files[0].name === 'badge.jpg');
  await bot.checkTenure(); assert.strictEqual(sent.length, 1, 'no repeat');
  // help
  let help; await bot.handle({ options: { getSubcommand: () => 'help' }, reply: async m => { help = m; } });
  assert.ok(help.embeds[0].data.fields.length >= 5);
  console.log('extras test ok');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
