// Pictures for greetings, membership anniversaries and the Tank/Healer/DPS symbols.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'art');
const files = prefix => fs.readdirSync(DIR).filter(f => f.startsWith(prefix)).sort();
const WELCOME = files('welcome_');

// Shuffle-bag so the same picture does not come up twice in a row.
let bag = [];
function welcomeArt() {
  if (!bag.length) { bag = WELCOME.slice(); for (let k = bag.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [bag[k], bag[j]] = [bag[j], bag[k]]; } }
  return path.join(DIR, bag.pop());
}

// Membership anniversaries: every month for the first year, then every year (big badge).
const TENURE = {
  1: ['One Month Survived', 'The System is mildly surprised. Mildly.'],
  2: ['Two Months In', 'Your feet have been assigned a caseworker.'],
  3: ['Three Months', 'A whole season. The sponsors sent a fruit basket.'],
  4: ['Four Months', 'You are now furniture. Comfortable furniture.'],
  5: ['Five Months', 'Still here. The exit remains decorative.'],
  6: ['Half a Year', 'Six months. The System has stopped counting your toes.'],
  7: ['Seven Months', 'Lucky number. Luck not included.'],
  8: ['Eight Months', 'Your chair has your shape now. Beautiful.'],
  9: ['Nine Months', 'The viewers have named a fan club after you.'],
  10: ['Ten Months', 'Double digits. The System is almost proud.'],
  11: ['Eleven Months', 'One more. Do not blink. Do not leave.'],
  12: ['One Full Year', 'The System has commissioned a statue of your feet. In gold.'],
};
const TIER = m => m >= 12 ? 0xFF2E9A : m >= 10 ? 0xFF8A3D : m >= 7 ? 0xFFD60A : m >= 4 ? 0xC9CFD6 : 0xD08C4F;
function tenure(months) {
  if (months <= 12) { const [name, quip] = TENURE[months]; return { name, quip, color: TIER(months), file: path.join(DIR, `tenure_${String(months).padStart(2, '0')}.jpg`) }; }
  const y = Math.floor(months / 12);
  return { name: `${y} Years`, quip: `${y} years. The statue of your feet now has a gift shop.`, color: TIER(12), file: path.join(DIR, 'tenure_12.jpg') };
}
// Whole calendar months between two dates.
function monthsBetween(from, to = new Date()) {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m--;
  return Math.max(0, m);
}
const isMilestone = m => m >= 1 && (m <= 12 || m % 12 === 0);

const roleIcon = role => path.join(DIR, `role_${role.toLowerCase()}.png`);

module.exports = { welcomeArt, tenure, monthsBetween, isMilestone, roleIcon, WELCOME, DIR };
