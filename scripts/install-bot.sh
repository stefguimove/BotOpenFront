#!/usr/bin/env bash
#
# Installs everything needed to run a bot training game locally.
#
#   bash scripts/install-bot.sh            # install dependencies
#   bash scripts/install-bot.sh --check    # verify only, install nothing
#   bash scripts/install-bot.sh --smoke    # install, then run a 20-tick game
#   bash scripts/install-bot.sh --python   # also create a .venv for future tooling
#
# The v1 trainer is pure TypeScript (no Python), so the venv is optional and
# only provisioned when asked for. Everything the training needs is: Node,
# the npm dependencies, and the map files under resources/maps/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CI_MODE=0
CHECK_ONLY=0
SMOKE=0
WITH_PYTHON=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --ci) CI_MODE=1 ;;
    --check|--check-only) CHECK_ONLY=1 ;;
    --smoke) SMOKE=1 ;;
    --python) WITH_PYTHON=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32mok\033[0m %s\n' "$*"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$*"; }
die() { printf '  \033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

# ── Node ─────────────────────────────────────────────────────────────────────
say "Node.js"

ENGINE_RANGE="$(node -e 'process.stdout.write(require("./package.json").engines.node)' 2>/dev/null || true)"
if [ -z "$ENGINE_RANGE" ]; then
  die "cannot read engines.node from package.json"
fi

if ! command -v node >/dev/null 2>&1; then
  die "node is not installed (wanted $ENGINE_RANGE). Install it from https://nodejs.org, or with nvm/fnm, then re-run."
fi

NODE_VERSION="$(node -p 'process.versions.node')"
NPM_VERSION="$(npm --version 2>/dev/null || echo unknown)"

# The range is a semver range (" >=24.15.0 <25"). Compare the major version,
# which is what npm's engine check enforces in practice.
REQUIRED_MAJOR="$(printf '%s' "$ENGINE_RANGE" | grep -oE '[0-9]+' | head -1)"
CURRENT_MAJOR="${NODE_VERSION%%.*}"

node_is_supported() {
  [ -n "$REQUIRED_MAJOR" ] || return 0
  # "<25" style upper bounds are the only ones this repo uses.
  local upper
  upper="$(printf '%s' "$ENGINE_RANGE" | grep -oE '< *[0-9]+' | grep -oE '[0-9]+' | head -1 || true)"
  if [ "$CURRENT_MAJOR" -lt "$REQUIRED_MAJOR" ]; then return 1; fi
  if [ -n "$upper" ] && [ "$CURRENT_MAJOR" -ge "$upper" ]; then return 1; fi
  return 0
}

if node_is_supported; then
  ok "node $NODE_VERSION (npm $NPM_VERSION) satisfies $ENGINE_RANGE"
else
  warn "node $NODE_VERSION does not satisfy $ENGINE_RANGE"
  if command -v fnm >/dev/null 2>&1; then
    say "Trying fnm"
    fnm install "$REQUIRED_MAJOR" >/dev/null 2>&1 || true
    if fnm exec --using="$REQUIRED_MAJOR" node -v >/dev/null 2>&1; then
      ok "fnm can provide node $REQUIRED_MAJOR (re-run inside: fnm use $REQUIRED_MAJOR)"
    fi
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    say "Trying nvm"
    # shellcheck disable=SC1091
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm install "$REQUIRED_MAJOR" >/dev/null 2>&1 || true
    if nvm use "$REQUIRED_MAJOR" >/dev/null 2>&1; then
      ok "nvm switched to node $(node -p 'process.versions.node')"
      NODE_VERSION="$(node -p 'process.versions.node')"
      NPM_VERSION="$(npm --version)"
    fi
  fi

  if ! node_is_supported; then
    if [ "$FORCE" -eq 0 ] && [ "$CHECK_ONLY" -eq 0 ]; then
      warn "continuing with node $NODE_VERSION: the repo's .npmrc sets engine-strict,"
      warn "so the install below passes --engine-strict=false. The bot itself is"
      warn "pure TypeScript and runs on node 22; use --force to silence this."
    fi
  fi
fi

# ── npm dependencies ─────────────────────────────────────────────────────────
say "npm dependencies"

if [ ! -f package-lock.json ]; then
  die "package-lock.json is missing; cannot do a reproducible install"
fi

NPM_ENGINE_FLAG=""
if ! node_is_supported; then
  NPM_ENGINE_FLAG="--engine-strict=false"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  if [ -d node_modules/@openfront/engine ]; then
    ok "node_modules present"
  else
    warn "node_modules missing (run without --check)"
  fi
else
  # Repo convention (CLAUDE.md): never `npm install`; the lockfile is the
  # source of truth. `--ignore-scripts` matches `npm run inst`.
  echo "  npm ci --ignore-scripts $NPM_ENGINE_FLAG"
  # shellcheck disable=SC2086
  npm ci --ignore-scripts --no-audit --no-fund $NPM_ENGINE_FLAG
  ok "dependencies installed"
fi

# ── toolchain ────────────────────────────────────────────────────────────────
say "Toolchain"

for bin in tsx vitest tsc oxlint; do
  if [ -x "node_modules/.bin/$bin" ]; then
    ok "$bin"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    warn "$bin missing"
  else
    die "$bin missing after install"
  fi
done

if [ -d node_modules/@openfront/engine ] &&
  [ -d node_modules/@openfront/engine-api ] &&
  [ -d node_modules/@openfront/shared ]; then
  ok "workspace packages linked"
else
  warn "workspace packages not linked (run npm ci)"
fi

# ── map data ─────────────────────────────────────────────────────────────────
say "Map data (TheBox)"

MISSING_MAPS=0
for file in map.bin map4x.bin map16x.bin manifest.json; do
  if [ -f "resources/maps/thebox/$file" ]; then
    ok "resources/maps/thebox/$file"
  else
    warn "resources/maps/thebox/$file missing"
    MISSING_MAPS=1
  fi
done
if [ "$MISSING_MAPS" -eq 1 ]; then
  die "the bot cannot build a game without the TheBox map files"
fi

# ── optional Python venv ─────────────────────────────────────────────────────
if [ "$WITH_PYTHON" -eq 1 ]; then
  say "Python venv (optional)"
  if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 not found; skipping the venv (v1 training does not need it)"
  else
    if [ ! -d .venv ]; then
      python3 -m venv .venv
      ok "created .venv"
    else
      ok ".venv already exists"
    fi
    # shellcheck disable=SC1091
    . .venv/bin/activate
    python -m pip install --quiet --upgrade pip
    if [ -f bot/requirements.txt ]; then
      python -m pip install --quiet -r bot/requirements.txt
      ok "installed bot/requirements.txt"
    else
      ok "no bot/requirements.txt: the v1 trainer is TypeScript, venv left empty"
    fi
    deactivate
  fi
fi

# ── smoke test ───────────────────────────────────────────────────────────────
if [ "$SMOKE" -eq 1 ] && [ "$CHECK_ONLY" -eq 0 ]; then
  say "Smoke test (20 ticks on TheBox compact)"
  npx tsx bot/cli/bench.ts --config compact --ticks 20 --quiet
  ok "a local game ran end to end"
fi

say "Ready"
cat <<'EOF'
  Train:
    npm run bot:train -- --config compact --iterations 10 --episodes 2
  Watch one game:
    npm run bot:play  -- --config compact --ticks 1800 --save-replay
    npm run replay:api
    npm run start:client   # http://localhost:9000/#replay-viewer=<gameID>
  Tests:
    npx vitest run tests/bot --project node
EOF
