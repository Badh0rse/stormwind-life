# SYSTEM AI uploader for Princess Posse (runs on the PC that plays WoW Forever).
#  * Sends the addon's saved data to your bot whenever WoW saves it (logout or /reload).
#  * Fetches posts and events made in Discord and writes them where the addon picks them up
#    on the next /reload.
# Needs nothing extra: Windows PowerShell is built in. Settings live in uploader.config.json.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgFile = Join-Path $here 'uploader.config.json'

function Save-Config($c) { $c | ConvertTo-Json | Set-Content -Path $cfgFile -Encoding UTF8 }
if (Test-Path $cfgFile) { $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json }
else {
  Write-Host "First run: a few questions (saved in uploader.config.json)." -ForegroundColor Magenta
  $cfg = [pscustomobject]@{
    BotUrl = (Read-Host "Bot address (e.g. https://princess-posse-bot.up.railway.app)").TrimEnd('/')
    Secret = (Read-Host "Upload secret (the UPLOAD_SECRET you set on the bot)")
    WowPath = 'C:\Program Files (x86)\World of Warcraft\_forever_'
  }
  $p = Read-Host "WoW Forever folder [$($cfg.WowPath)]"
  if ($p) { $cfg.WowPath = $p.TrimEnd('\') }
  Save-Config $cfg
}

$headers = @{ Authorization = "Bearer $($cfg.Secret)" }
$inboxFile = [IO.Path]::Combine($cfg.WowPath, 'Interface', 'AddOns', 'PrincessPosse', 'DiscordInbox.lua')
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Find-SavedFile {
  Get-ChildItem -Path ([IO.Path]::Combine($cfg.WowPath, 'WTF', 'Account')) -Filter 'PrincessPosse.lua' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -like '*SavedVariables' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
function Send-Data($file) {
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  $r = Invoke-RestMethod -Uri "$($cfg.BotUrl)/api/upload" -Method Post -Headers $headers -Body $bytes -ContentType 'text/plain; charset=utf-8' -TimeoutSec 60
  Write-Host ("[{0:HH:mm}] Sent guild data: {1} roster, {2} profiles, {3} new posts, {4} joins, {5} achievements" -f (Get-Date), $r.roster, $r.profiles, $r.posts, $r.joins, $r.achievements) -ForegroundColor Green
}
function Get-Inbox {
  $text = Invoke-RestMethod -Uri "$($cfg.BotUrl)/api/inbox" -Headers $headers -TimeoutSec 30
  $old = if (Test-Path $inboxFile) { [IO.File]::ReadAllText($inboxFile) } else { '' }
  if ($text -ne $old -and (Test-Path (Split-Path $inboxFile))) {
    [IO.File]::WriteAllText($inboxFile, $text, $utf8)
    Write-Host ("[{0:HH:mm}] Discord posts updated. They go into the game on your next /reload." -f (Get-Date)) -ForegroundColor Yellow
  }
}

Write-Host "SYSTEM AI uploader running. Leave this window open (minimize it). Ctrl+C to stop." -ForegroundColor Magenta
$lastSent = [datetime]::MinValue; $lastInbox = [datetime]::MinValue
while ($true) {
  try {
    $f = Find-SavedFile
    if ($f -and $f.LastWriteTime -gt $lastSent) {
      Start-Sleep -Seconds 2            # let WoW finish writing
      Send-Data $f; $lastSent = $f.LastWriteTime
      Get-Inbox; $lastInbox = Get-Date
    } elseif (((Get-Date) - $lastInbox).TotalSeconds -ge 60) {
      Get-Inbox; $lastInbox = Get-Date
    }
  } catch { Write-Host ("[{0:HH:mm}] {1}" -f (Get-Date), $_.Exception.Message) -ForegroundColor Red }
  Start-Sleep -Seconds 10
}
