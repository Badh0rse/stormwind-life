# SYSTEM AI: the Princess Posse Discord bot

Use the Princess Posse guild addon from Discord: look up crawlers, see the boards and events,
post Help Wanted and events, sign up, and get guild news (new posts, joins, achievements with
System AI lines) posted automatically.

```
WoW (addon) --saves--> PC uploader --HTTPS--> bot (cloud, always online) <--> Discord
WoW (addon) <--/reload-- DiscordInbox.lua <--- PC uploader <--- posts made in Discord
```

WoW addons cannot go online, so a small uploader runs on the PC that plays. The bot stays online
all the time; it shows the guild as of the last time someone with the uploader played.

## Commands (all under /posse)
| Command | What it does |
| --- | --- |
| `help` | A menu of everything the bot can do |
| `roster [online]` | Guild members, level, class, rank, role, who is online |
| `roles [online]` | The guild split into Tanks / Healers / DPS (from class + talents; a role picked in the addon wins) |
| `iam <character>` | Link your Discord to your character; signups then default to your role, and the bot can give you a Tank/Healer/DPS Discord role |
| `profile <name>` | Gear, item level, talents, professions, roles |
| `crafters <item>` | Who in the guild can make it |
| `board` | Open Help Wanted posts and groups |
| `events` | Upcoming events with Tank / Healer / DPS / Maybe / Leave buttons (one click to sign up) |
| `post` / `event` | Post to the in-game boards (arrives in game after the next sync) |
| `signup <event> <role>` | Tank / Healer / DPS / Maybe (kept in Discord) |
| `leaderboard`, `achievements [name]` | Achievement points and recent achievements |
| `officer <inactive/trials/bans>` | Officers only (admins or OFFICER_ROLE_ID) |
| `status`, `setfeed`, `setwelcome` | Last sync time; choose the news channel and the welcome channel (admins) |

New Discord members get a welcome card: one of 24 pictures plus one of 280 System AI lines (plenty about feet). No repeats until everything has been used.

Membership badges: every month for the first year (1-11 months, bronze → silver → gold → legendary) and a big
badge each year, posted in the news channel with a picture. The first check only records where everyone is, so
existing members are not all announced at once. Needs the Server Members Intent. Turn off with `TENURE_BADGES=off`.

Tank / Healer / DPS symbols: a blue shield, green cross and red swords. The bot uploads them as its own emojis
on startup (no boost needed) and uses them in every card and on the signup buttons. On Boost level 2 servers they
also become the role icons next to names.

## 1. Create the bot in Discord (5 minutes)
1. Go to https://discord.com/developers/applications and click **New Application**. Name it "SYSTEM AI" (any name works; rename it there any time).
2. Open **Bot** on the left, click **Reset Token**, and copy the token. This is `DISCORD_TOKEN`.
3. Still on **Bot**: turn on **Server Members Intent** (needed to greet new members).
4. Open **OAuth2 > URL Generator**: tick **bot** and **applications.commands**; under bot permissions tick
   **Send Messages**, **Embed Links**, **View Channels** and **Manage Roles** (only needed for auto Tank/Healer/DPS roles).
   Open the link it makes and add the bot to your server.
5. In Discord, turn on **Settings > Advanced > Developer Mode**, then right-click your server icon >
   **Copy Server ID**. This is `DISCORD_SERVER_ID`.

## 2. Put the bot online
Any host that runs Node 20 or Docker works (Railway, Render, Fly.io, a VPS...).
1. Upload this folder (or push it to a private GitHub repo and connect it).
2. Start command: `npm start` (or use the included Dockerfile).
3. Set the variables from `.env.example`. At minimum `DISCORD_TOKEN` and `UPLOAD_SECRET`.
   To rename the bot: change the app name/avatar in the Developer Portal and set `BOT_NAME` to match.
4. If the host offers a persistent volume, mount it at `/data`. Without one, signups and
   not-yet-synced Discord posts are lost on redeploys; guild data comes back on the next upload.
5. Make sure the host gives the bot a public HTTPS address. Opening it in a browser should show `{"ok":true,...}`.
6. In Discord, go to the channel for guild news and type `/posse setfeed`, and in your welcome channel type `/posse setwelcome`.
7. Roles: on first start the bot creates **Tank** (blue 🛡️), **Healer** (green ➕), **DPS** (red ⚔️) and one role per
   class in its in-game class color (Warrior tan, Paladin pink, Hunter green, Rogue yellow, Priest white, Shaman blue,
   Mage light blue, Warlock purple, Druid orange...). In Server Settings > Roles, drag the bot's own role **above** them.
   Members get their role and class color after `/posse iam <character>`; it follows talent changes. Symbols next to
   names need a Boost level 2 server. Turn off with `AUTO_ROLES=off` / `CLASS_ROLES=off`.

## 3. Run the uploader on the gaming PC
1. In game: Princess Posse > Settings > **Discord bot: ON**.
2. Copy the `uploader` folder anywhere (e.g. Desktop) and double-click **Start-Uploader.bat**.
3. First run asks for the bot address and the same `UPLOAD_SECRET`. Leave the window open while you play.
4. Optional: put a shortcut to `Start-Uploader.bat` in `shell:startup` so it starts with Windows.

Data is sent when WoW saves: on logout or `/reload`. Posts made in Discord go into the game on the
next `/reload` after the uploader fetched them, and then appear for the whole guild.

## Privacy
Only what the addon already shares inside the guild is sent: roster (name, level, class, rank, zone,
public note), shared profiles, boards, events, member joins/leaves and achievements. Officer notes are never sent.
