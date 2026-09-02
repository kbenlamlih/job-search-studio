# =====================================================================
# Job Studio - one-time setup for Windows.
#
# Started by install.bat (double-click that, not this file).
# Installs Claude, the app engine and the PDF builder into your own user
# folder - no administrator rights needed - then signs you in and starts up.
# =====================================================================

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Say  ($m) { Write-Host ""; Write-Host $m -ForegroundColor White -BackgroundColor DarkBlue }
function Ok   ($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Die  ($m) {
  Write-Host ""
  Write-Host "  [x] $m" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Send this whole window to whoever set this up for you."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:LOCALAPPDATA\JobStudio\bin;$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.local\bin"
}

function Have ($cmd) {
  Refresh-Path
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

Clear-Host
# Single-quoted here-string: the art contains characters PowerShell would otherwise
# treat as escapes or variables inside a double-quoted one.
Write-Host @'
   _  ___  ___    ___ _____ _   _ ___ ___ ___
  | |/ _ \| _ )  / __|_   _| | | |   \_ _/ _ \
  | | (_) | _ \  \__ \ | | | |_| | |) | | (_) |
  |_|\___/|___/  |___/ |_|  \___/|___/___\___/

  Your own job-search assistant. Setting it up now.
'@ -ForegroundColor Cyan
Write-Host "  This takes about 5 minutes. Nothing here needs an administrator." -ForegroundColor DarkGray

if ($PSVersionTable.PSVersion.Major -lt 5) { Die "This PC's PowerShell is too old. Job Studio needs Windows 10 or newer." }

$bin = "$env:LOCALAPPDATA\JobStudio\bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null

# --- 1. Claude -------------------------------------------------------
Say "1 of 4  -  Installing Claude"
if (Have 'claude') {
  Ok "Claude is already here"
} else {
  try {
    Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  } catch {
    Warn "The direct installer didn't work, trying npm instead."
    if (Have 'npm') { cmd /c "npm install -g @anthropic-ai/claude-code" 2>&1 | Out-Null }
  }
  if (Have 'claude') { Ok "Claude installed" } else { Die "Couldn't install Claude. Check you're online and run this again." }
}

# --- 2. Bun ----------------------------------------------------------
Say "2 of 4  -  Installing the app engine"
if (Have 'bun') {
  Ok "Engine already here"
} else {
  try {
    Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
  } catch {
    Warn "Direct download failed: $($_.Exception.Message)"
  }
  if (Have 'bun') { Ok "Engine installed" } else { Die "Couldn't install the app engine. Check you're online and run this again." }
}

# --- 3. Typst --------------------------------------------------------
Say "3 of 4  -  Installing the PDF builder"
if (Have 'typst') {
  Ok "PDF builder already here"
} else {
  $done = $false
  # Straight from the project's own releases - one file, no installer.
  try {
    $zip = Join-Path $env:TEMP "typst.zip"
    $out = Join-Path $env:TEMP "typst-unzip"
    $url = "https://github.com/typst/typst/releases/latest/download/typst-x86_64-pc-windows-msvc.zip"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $out -Force
    $exe = Get-ChildItem -Path $out -Filter typst.exe -Recurse | Select-Object -First 1
    if ($exe) {
      Copy-Item $exe.FullName (Join-Path $bin "typst.exe") -Force
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      if ($userPath -notlike "*$bin*") {
        [Environment]::SetEnvironmentVariable('Path', "$userPath;$bin", 'User')
      }
      $done = $true
    }
    Remove-Item $zip, $out -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    Warn "Direct download failed: $($_.Exception.Message)"
  }
  if (-not $done -and (Have 'winget')) {
    cmd /c "winget install --id Typst.Typst -e --accept-package-agreements --accept-source-agreements" 2>&1 | Out-Null
    $done = Have 'typst'
  }
  if ($done -or (Have 'typst')) {
    Ok "PDF builder installed"
  } else {
    Warn "Couldn't install the PDF builder automatically."
    Warn "Everything else works; your CV just won't turn into a PDF until it's there."
    Warn "Job Studio has an 'Install it for me' button under Setup - try that once the app opens."
  }
}

# --- 4. The framework and the job boards -----------------------------
Say "4 of 4  -  Setting up the job boards"
if (-not (Test-Path (Join-Path $here "workspace\.claude"))) {
  # The framework is Mads Lorentzen's ai-job-search (MIT). It lives in its own
  # checkout so your personal details never sit in Job Studio's own repository.
  Write-Host "  Downloading the job search framework..."
  $wsPath = Join-Path $here "workspace"
  if (Have 'git') {
    cmd /c "git clone --quiet https://github.com/MadsLorentzen/ai-job-search.git `"$wsPath`"" 2>&1 | Out-Null
    if (Test-Path (Join-Path $wsPath ".git")) {
      Push-Location $wsPath; cmd /c "git remote rename origin upstream" 2>&1 | Out-Null; Pop-Location
    }
  } else {
    try {
      New-Item -ItemType Directory -Force -Path $wsPath | Out-Null
      $tgz = Join-Path $env:TEMP "ai-job-search.tar.gz"
      Invoke-WebRequest -Uri "https://github.com/MadsLorentzen/ai-job-search/archive/refs/heads/master.tar.gz" -OutFile $tgz -UseBasicParsing
      # tar ships with Windows 10 and later.
      cmd /c "tar xzf `"$tgz`" -C `"$wsPath`" --strip-components=1" 2>&1 | Out-Null
      Remove-Item $tgz -ErrorAction SilentlyContinue
    } catch {
      Warn "Download failed: $($_.Exception.Message)"
    }
  }
  if (-not (Test-Path (Join-Path $wsPath ".claude"))) {
    Die "Couldn't download the job search framework. Check you're online and run this again."
  }
  Ok "Framework downloaded"
}
Push-Location (Join-Path $here "studio")
cmd /c "bun install --silent" 2>&1 | Out-Null
Pop-Location
foreach ($tool in @('jobbank-search','jobdanmark-search','jobindex-search','jobnet-search','linkedin-search','freehire-search')) {
  $dir = Join-Path $here "workspace\.agents\skills\$tool\cli"
  if (Test-Path $dir) {
    Push-Location $dir
    cmd /c "bun install --silent" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Ok $tool } else { Warn "$tool needs another go later (Setup - Download them now)" }
    Pop-Location
  }
}

# --- 5. Sign in ------------------------------------------------------
Say "Almost there  -  Signing you in to Claude"
$signedIn = $false
try {
  cmd /c "claude -p hi --output-format json" 2>&1 | Out-Null
  $signedIn = ($LASTEXITCODE -eq 0)
} catch { $signedIn = $false }

if ($signedIn) {
  Ok "Already signed in"
} else {
  Write-Host ""
  Write-Host "  A browser window will open in a moment. Log in with the same"
  Write-Host "  account your Claude subscription is on, then come back here."
  Write-Host ""
  Read-Host "  Press Enter when you're ready"
  cmd /c "claude /login"
  cmd /c "claude -p hi --output-format json" 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Ok "Signed in"
  } else {
    Warn "Still not signed in."
    Write-Host @"

  Try it by hand - it only takes a moment:

    1. Press the Windows key, type "powershell", press Enter
    2. Type this one word and press Enter:   claude
    3. Follow the login prompts in the browser window that opens
    4. When you see a chat prompt, type /exit and press Enter

  Then double-click "Start Job Studio.bat" again. The app's Setup page has a
  "Test the Claude connection" button that tells you if it worked.

"@
    Read-Host "  Press Enter to carry on anyway"
  }
}

Say "Done."
Write-Host @"

  Job Studio is ready.

  From now on, open it by double-clicking:

      Start Job Studio.bat

  Starting it now...

"@
Start-Sleep -Seconds 2
& (Join-Path $here "Start Job Studio.bat")
