process.env.DATA_DIR = require('path').join(__dirname, 'tmpdata2'); process.env.UPLOAD_SECRET = 'x'.repeat(24);
require('fs').rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const bot = require('../src/index'); const fs = require('fs'); const assert = require('assert');
bot.server.listen(0, async () => {
  const port = bot.server.address().port; const base = `http://127.0.0.1:${port}`;
  const h = { Authorization: 'Bearer ' + 'x'.repeat(24) };
  let r = await fetch(base + '/'); assert(r.ok);
  r = await fetch(base + '/api/upload', { method: 'POST', body: 'nope' }); assert(r.status === 401, 'needs auth');
  r = await fetch(base + '/api/upload', { method: 'POST', headers: { ...h, Authorization: 'Bearer wrong' }, body: 'x' }); assert(r.status === 401);
  r = await fetch(base + '/api/upload', { method: 'POST', headers: h, body: fs.readFileSync(__dirname + '/../sample_sv.lua') }); const j = await r.json(); assert(r.ok && j.profiles === 15, JSON.stringify(j));
  r = await fetch(base + '/api/upload', { method: 'POST', headers: h, body: 'garbage {' }); assert(r.status === 400);
  r = await fetch(base + '/api/inbox', { headers: h }); const t = await r.text(); assert(t.includes('PrincessPosse_DiscordInbox = {'), t);
  await new Promise(r => setTimeout(r, 400)); assert(fs.existsSync(process.env.DATA_DIR + '/state.json'), 'saved');
  console.log('http PASS'); process.exit(0);
});
