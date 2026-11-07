// Tiny JSON store. Everything the bot keeps fits in one file in DATA_DIR.
// If the host has no persistent disk, the next upload from the PC rebuilds the guild data;
// only Discord-only things (signups, queued posts not yet picked up) would be lost.
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'state.json');

const empty = () => ({
  snapshot: null,      // latest guild data from the PC uploader
  syncedAt: 0,         // when it arrived (unix seconds)
  seen: { records: {}, joinsT: 0, ach: {} }, // what has already been announced
  inbox: [],           // posts made in Discord, waiting for the uploader
  signups: {},         // eventId -> { discordUserId: { role, name } }
  baseline: false,     // first upload sets the baseline without announcing old news
});

let state = empty();
function load() {
  try { state = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { state = empty(); }
  return state;
}
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.error('save failed', e.message); }
  }, 200);
}
module.exports = { load, save, get: () => state, reset: () => { state = empty(); } };
