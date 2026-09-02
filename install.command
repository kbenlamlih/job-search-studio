#!/bin/bash
# =====================================================================
# Job Studio - one-time setup for macOS.
# Double-click this file. It installs three things, signs you in to
# Claude, and then starts the app. Nothing here needs a password.
# =====================================================================

set -u
cd "$(dirname "$0")"
HERE="$(pwd)"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

say()  { printf "\n%s%s%s\n" "$BOLD" "$1" "$OFF"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$OFF" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$OFF" "$1"; }
die()  { printf "\n  %s✗ %s%s\n\n  Send this whole window to whoever set this up for you.\n\n" "$RED" "$1" "$OFF"; read -r -p "Press return to close." _; exit 1; }

clear
cat <<'BANNER'
   _  ___  ___    ___ _____ _   _ ___ ___ ___
  | |/ _ \| _ )  / __|_   _| | | |   \_ _/ _ \
  | | (_) | _ \  \__ \ | | | |_| | |) | | (_) |
  |_|\___/|___/  |___/ |_|  \___/|___/___\___/

  Your own job-search assistant. Setting it up now.
BANNER

printf "\n%sThis takes about 5 minutes. You can read a newspaper.%s\n" "$DIM" "$OFF"

# --- 0. Sanity: this Mac is new enough -------------------------------
MACOS_MAJOR=$(sw_vers -productVersion | cut -d. -f1)
if [ "$MACOS_MAJOR" -lt 11 ]; then
  die "This Mac runs macOS $(sw_vers -productVersion), and the tools Job Studio needs require macOS 11 or newer. Try it on a newer computer."
fi

# --- 1. Claude Code --------------------------------------------------
say "1 of 4  ·  Installing Claude"
export PATH="$HOME/.local/bin:$PATH"
if command -v claude >/dev/null 2>&1; then
  ok "Claude is already here ($(claude --version 2>/dev/null | head -1))"
else
  curl -fsSL https://claude.ai/install.sh | bash >/tmp/studio-claude.log 2>&1 \
    || die "Couldn't install Claude. Check you're online, then run this again. Details in /tmp/studio-claude.log"
  export PATH="$HOME/.local/bin:$PATH"
  command -v claude >/dev/null 2>&1 || die "Claude installed but isn't where we expected it. Details in /tmp/studio-claude.log"
  ok "Claude installed"
fi

# --- 2. Bun (runs the app and the job-board searches) ----------------
say "2 of 4  ·  Installing the app engine"
export PATH="$HOME/.bun/bin:$PATH"
if command -v bun >/dev/null 2>&1; then
  ok "Engine already here (Bun $(bun --version))"
else
  curl -fsSL https://bun.sh/install | bash >/tmp/studio-bun.log 2>&1 \
    || die "Couldn't install the app engine. Check you're online and run this again. Details in /tmp/studio-bun.log"
  export PATH="$HOME/.bun/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "Engine installed but isn't where we expected it. Details in /tmp/studio-bun.log"
  ok "Engine installed"
fi

# --- 3. Typst (turns your CV into a PDF) -----------------------------
say "3 of 4  ·  Installing the PDF builder"
if command -v typst >/dev/null 2>&1; then
  ok "PDF builder already here ($(typst --version))"
else
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64) TARGET="aarch64-apple-darwin" ;;
    x86_64) TARGET="x86_64-apple-darwin" ;;
    *) TARGET="" ;;
  esac
  INSTALLED=0
  if [ -n "$TARGET" ]; then
    mkdir -p "$HOME/.local/bin"
    TMP=$(mktemp -d)
    if curl -fsSL "https://github.com/typst/typst/releases/latest/download/typst-${TARGET}.tar.xz" -o "$TMP/typst.tar.xz" 2>/dev/null \
      && tar -xJf "$TMP/typst.tar.xz" -C "$TMP" 2>/dev/null; then
      FOUND=$(find "$TMP" -name typst -type f -perm -u+x | head -1)
      if [ -n "$FOUND" ]; then
        cp "$FOUND" "$HOME/.local/bin/typst" && chmod +x "$HOME/.local/bin/typst" && INSTALLED=1
      fi
    fi
    rm -rf "$TMP"
  fi
  if [ "$INSTALLED" = "0" ] && command -v brew >/dev/null 2>&1; then
    brew install typst >/tmp/studio-typst.log 2>&1 && INSTALLED=1
  fi
  if [ "$INSTALLED" = "1" ]; then
    ok "PDF builder installed"
  else
    warn "Couldn't install the PDF builder automatically."
    warn "Everything else works; your CV just won't turn into a PDF until it's there."
    warn "Job Studio has an 'Install it for me' button in Setup - try that once the app opens."
  fi
fi

# --- 4. The job search framework and its job-board tools -------------
say "4 of 4  ·  Setting up the job boards"
if [ ! -d "$HERE/workspace/.claude" ]; then
  # The framework is Mads Lorentzen's ai-job-search (MIT). It lives in its own
  # checkout so your personal details never sit in Job Studio's own repository.
  printf "  Downloading the job search framework...\n"
  if command -v git >/dev/null 2>&1; then
    git clone --quiet https://github.com/MadsLorentzen/ai-job-search.git "$HERE/workspace" >/tmp/studio-clone.log 2>&1 \
      && ( cd "$HERE/workspace" && git remote rename origin upstream )
  else
    mkdir -p "$HERE/workspace"
    curl -fsSL https://github.com/MadsLorentzen/ai-job-search/archive/refs/heads/master.tar.gz 2>/tmp/studio-clone.log \
      | tar xz -C "$HERE/workspace" --strip-components=1 2>>/tmp/studio-clone.log
  fi
  [ -d "$HERE/workspace/.claude" ] || die "Couldn't download the job search framework. Check you're online and run this again. Details in /tmp/studio-clone.log"
  ok "Framework downloaded"
fi
( cd "$HERE/studio" && bun install --silent >/tmp/studio-deps.log 2>&1 ) || die "Couldn't set up the app. Details in /tmp/studio-deps.log"
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search linkedin-search freehire-search; do
  DIR="$HERE/workspace/.agents/skills/$tool/cli"
  [ -d "$DIR" ] || continue
  ( cd "$DIR" && bun install --silent >>/tmp/studio-deps.log 2>&1 ) && printf "  %s✓%s %s\n" "$GREEN" "$OFF" "$tool" || warn "$tool needs another go later (Setup → Download them now)"
done

# --- 5. Sign in ------------------------------------------------------
say "Almost there  ·  Signing you in to Claude"
if claude -p "hi" --output-format json >/dev/null 2>&1; then
  ok "Already signed in"
else
  cat <<'MSG'

  A browser window will open in a moment. Log in with the same account
  your Claude subscription is on, then come back to this window.

MSG
  read -r -p "  Press return when you're ready. " _
  claude /login || true
  if claude -p "hi" --output-format json >/dev/null 2>&1; then
    ok "Signed in"
  else
    warn "Still not signed in."
    cat <<'FALLBACK'

  Try it by hand - it only takes a moment:

    1. Open the Terminal app (press Cmd+Space, type "Terminal", press return)
    2. Type this one word and press return:   claude
    3. Follow the login prompts in the browser window that opens
    4. When you see a chat prompt, type /exit and press return

  Then double-click "Start Job Studio.command" again. The app's Setup page
  has a "Test the Claude connection" button that tells you if it worked.

FALLBACK
    read -r -p "  Press return to carry on anyway. " _
  fi
fi

# --- 6. Remember where the tools are for the launcher ---------------
cat > "$HERE/.studio-env" <<ENVFILE
# Written by install.command so the launcher finds the tools.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
ENVFILE

say "Done."
cat <<'DONE'

  Job Studio is ready.

  From now on, open it by double-clicking:

      Start Job Studio.command

  Starting it now...

DONE
sleep 2
exec "$HERE/Start Job Studio.command"
