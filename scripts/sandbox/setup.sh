#!/bin/sh
# Sandbox setup for the tools in this folder (not part of the app). Usage: sh setup.sh [tools_dir] [repo_dir]
# Installs the node packages the readers and the test harness need, and links them for the repo's source files.
TOOLS="${1:-/home/claude/t}"; REPO="${2:-/home/claude/repo}"
mkdir -p "$TOOLS" && cd "$TOOLS" && npm i fflate jsdom esbuild >/dev/null 2>&1
ln -sfn "$TOOLS/node_modules" "$REPO/node_modules"
pip install python-pptx openpyxl pillow cairosvg --break-system-packages >/dev/null 2>&1
echo "tools in $TOOLS, linked into $REPO; soffice: $(command -v soffice || echo missing)"
