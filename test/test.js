// Offline tests: parse the real saved file, build the snapshot, diff, embeds, inbox, commands.
process.env.DATA_DIR = require('path').join(__dirname, 'tmpdata');
const fs = require('fs'); const assert = require('assert');
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const bot = require('../src/index');
const G = require('../src/guild'); const F = require('../src/format');
const sv = fs.readFileSync(require('path').join(__dirname, '..', 'sample_sv.lua'), 'utf8');

// 1. first upload = baseline, no announcements
const r1 = bot.ingest(sv);
assert(r1.first && r1.profiles === 15, 'baseline ' + JSON.stringify(r1));
// 2. a new post + a new join + a new achievement show up as news on the next upload
const now = Math.floor(Date.now() / 1000);
let sv2 = sv.replace('["requests"] = {', `["requests"] = {\n["X:1:1"] = {["id"]="X:1:1",["owner"]="Zul'grim",["title"]="Need a tank",["details"]="RFC",["status"]="OPEN",["created"]=${now},},`);
sv2 = sv2.replace('["memberLog"] = {', `["memberLog"] = {\n{["kind"]="JOIN",["name"]="Newbie Crawler",["t"]=${now},},`);
sv2 = sv2.replace('["earned"] = {', `["earned"] = {\n["die1"]=${now},`);
sv2 = sv2.replace('PrincessPosseDB = {', `PrincessPosseDB = {\n["discordDone"] = {["dTEST"]=${now},},\n["discord"] = {["me"]="Príncess Doughnut",["guild"]="Princess Posse",["roster"]={{["name"]="Príncess Doughnut",["level"]=12,["class"]="DRUID",["online"]=true,["rank"]="GM"},{["name"]="Old Timer",["level"]=60,["class"]="WARRIOR",["online"]=false,["seenDays"]=30,["rank"]="Member"},},},`);
bot.state.inbox.push({ id: 'dTEST', kind: 'REQUEST', title: 'x' }, { id: 'dKEEP', kind: 'EVENT', title: 'Raid "night"', details: 'bring\\pots', when: now + 3600, by: 'Kaz' });
const st = bot.state; const before = JSON.stringify(st.seen).length;
const snapBefore = st.snapshot;
const G2 = G.diff(G.snapshotFrom(require('../src/svparse').parseSV(sv2).PrincessPosseDB), JSON.parse(JSON.stringify(st.seen)), { now });
assert(G2.records.length === 1 && G2.records[0].title === 'Need a tank', 'new record ' + G2.records.length);
assert(G2.joins.length === 1 && G2.joins[0].name === 'Newbie Crawler', 'new join');
assert(G2.achievements.length === 1 && G2.achievements[0].a.id === 'die1', 'new ach ' + G2.achievements.map(x => x.a.id));
const r2 = bot.ingest(sv2);
assert(!r2.first && r2.posts === 1 && r2.joins === 1 && r2.achievements === 1, 'second ' + JSON.stringify(r2));
// imported inbox entries leave the queue; others stay; Lua is escaped
assert(st.inbox.length === 1 && st.inbox[0].id === 'dKEEP', 'inbox ack');
const lua = bot.inboxLua();
assert(lua.includes('title="Raid \\"night\\""') && lua.includes('details="bring\\\\pots"') && lua.includes(`when=${now + 3600}`), lua);
// 3. embeds build without throwing
const s = st.snapshot;
F.rosterEmbed(s, false); F.profileEmbed(Object.values(s.profiles)[0]); F.achEmbed(G2.achievements[0]); F.joinEmbed(G2.joins[0]); F.recordEmbed(G2.records[0], { u1: { role: 'Tank', name: 'A' } });
// 4. helpers
assert(G.findName(Object.keys(s.profiles), 'misty') === 'Misty Willow', 'fuzzy');
assert(G.crafters(s, 'zzzz').length === 0);
const lb = G.leaderboard(s); assert(lb.length >= 1);
const t = bot.parseWhen('2026-11-14 20:00'); assert(t > 0, 'when');
assert(bot.parseWhen('tomorrow') === null);
// 5. commands: fake interactions
const replies = [];
const fake = (sub, opts = {}, extra = {}) => ({ commandName: 'posse', channelId: 'c1', guild: null, user: { id: 'u1', username: 'kaz' }, member: { displayName: 'Kaz', roles: { cache: new Map() } },
  memberPermissions: { has: () => !!extra.admin }, replied: false,
  options: { getSubcommand: () => sub, getString: k => opts[k] ?? null, getBoolean: k => opts[k] ?? null },
  reply: m => { replies.push([sub, m]); return Promise.resolve(); } });
(async () => {
  for (const [sub, o, x] of [['status'], ['roster', { online: false }], ['profile', { name: 'misty' }], ['profile', { name: 'nobodyhere' }], ['crafters', { item: 'a' }], ['board'], ['events'],
    ['post', { type: 'REQUEST', title: 'Need heals', details: 'SM' }], ['event', { title: 'Raid', when: '2026-11-14 20:00' }], ['event', { title: 'Bad', when: 'friday' }],
    ['roles', {}], ['iam', { name: 'kairo' }], ['signup', { event: 'nope' }], ['leaderboard'], ['achievements'], ['achievements', { name: 'Doughnut' }], ['officer', { view: 'inactive' }], ['officer', { view: 'bans' }, { admin: true }], ['setfeed', {}, { admin: true }], ['setwelcome', {}, { admin: true }]]) {
    await bot.handle(fake(sub, o, x || {}));
  }
  const by = Object.fromEntries(replies.map(r => [r[0], r[1]]));
  assert(replies.find(r => r[0] === 'officer' && /Officers only/.test(r[1].content)), 'officer gate');
  assert(st.inbox.some(e => e.title === 'Need heals'), 'post queued');
  assert(replies.find(r => r[0] === 'event' && /Use a date/.test(r[1].content || '')), 'bad date rejected');
  assert(st.feedChannelId === 'c1', 'setfeed');
  assert(st.welcomeChannelId === 'c1' && replies.find(r => r[0] === 'setwelcome' && /<@u1>/.test(r[1].embeds[0].data.description) && r[1].files.length === 1), 'setwelcome');
  assert(st.links && st.links.u1 === 'Kairo Manubia', 'iam link');
  assert(replies.find(r => r[0] === 'iam' && /Healer/.test(r[1].content)), 'iam role');
  const rk = G.roleFor({ class: 'WARRIOR', talents: [{ name: 'Protection', points: 5 }] }); assert(rk.role === 'Tank');
  assert(G.roleFor({ class: 'PALADIN', talents: [] }).role === 'Flex'); assert(G.roleFor({ class: 'ROGUE' }).role === 'DPS');
  assert(G.roleFor({ class: 'PRIEST', roles: ['Tank'], talents: [{ name: 'Holy', points: 9 }] }).role === 'Tank', 'picked wins');
  console.log('replies:', replies.length, 'inbox:', st.inbox.length);
  console.log('bot tests PASS');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
