#!/bin/bash
# Double-click to open Job Studio. Close this window to shut it down.
set -u
cd "$(dirname "$0")"

export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -f ./.studio-env ] && . ./.studio-env

if ! command -v bun >/dev/null 2>&1; then
  printf "\n\033[31mJob Studio isn't set up on this computer yet.\033[0m\n\nDouble-click \"install.command\" in this folder first.\n\n"
  read -r -p "Press return to close." _
  exit 1
fi

clear
printf "\n  \033[1mJob Studio\033[0m\n  Starting up. Your browser will open in a second.\n"
printf "  \033[2mKeep this window open while you use the app. Close it to stop.\033[0m\n"

cd studio
exec bun run server.ts
