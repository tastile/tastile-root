#!/usr/bin/env bash
# stack.sh — guarded entry point for all compose stack operations (root#183).
#
# Direct `docker compose` bypasses project/port/volume/image identity checks
# and allowlist enforcement. Route every stack operation through this script:
#
#   scripts/stack.sh <stack-id> <compose-command> [args...]
#   scripts/stack.sh list
#   scripts/stack.sh doctor <stack-id>        # preflight only, no compose call
#
# Stack ids and their canonical project/env/ports/images live in
# deploy/stacks.tsv. Preflight verifies, before every mutating command:
#   1. allowlist    TASTILE_STACK_ALLOW=<id,id,...> when set must contain <id>
#   2. identity     no container named <prefix>-* may carry a different compose
#                   project or working_dir; no container of our project may
#                   live in a different directory (the 2026-11-25 incident
#                   signature: `docker compose up` under the default project
#                   name recreated the tastile-acc containers)
#   3. ports        on `up`, every expected host port must be bound only by
#                   containers of this stack's project
#   4. volumes      every compose volume must not be mounted by foreign projects
#   5. images       on `up`, resolved image refs must satisfy the registry
#                   `images` column; stack-built images must exist locally
#                   unless the command builds/pulls them
#
# Overrides: `--force` bypasses preflight refusals but is always logged.
# Destructive operations (`down -v`/`--volumes`, `rm -v`/`--volumes`) on class
# prod-equiv/prod additionally require TASTILE_STACK_DESTRUCTIVE_OK=<stack-id>;
# --force does NOT bypass that gate.
#
# Extra env file: TASTILE_STACK_ENV_FILE=<path> appends a second --env-file
# (e.g. an Infisical-rendered file for the `prod` stack).
#
# Operation log (JSONL, gitignored): .tmp/stack/ops.jsonl
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="$ROOT/deploy/stacks.tsv"
LOG_DIR="$ROOT/.tmp/stack"
LOG_FILE="$LOG_DIR/ops.jsonl"

MUTATING_CMDS=" up down restart rm exec run "
READONLY_CMDS=" ps logs config images ls "
KNOWN_CMDS=" up down ps logs exec restart config build pull "

usage() { sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
die() { echo "stack.sh: ERROR: $*" >&2; exit 1; }
warn() { echo "stack.sh: WARN: $*" >&2; }

# --- registry ---------------------------------------------------------------

lookup_stack() {
  local id="$1" rows n
  rows="$(awk -F'\t' -v id="$id" '!/^#/ && NF>=10 && $1==id' "$REGISTRY")"
  n="$(printf '%s\n' "$rows" | grep -c . || true)"
  [ "$n" = "1" ] || die "stack id '$id' not found (or duplicated) in deploy/stacks.tsv — run 'scripts/stack.sh list'"
  printf '%s' "$rows"
}

list_stacks() {
  awk -F'\t' '!/^#/ && NF>=10 {printf "%-12s project=%-20s class=%-9s %s\n", $1, $3, $5, $10}' "$REGISTRY"
}

field() { printf '%s' "$1" | cut -f"$2"; }
split_csv() { printf '%s\n' "$1" | tr ',' '\n'; }

# --- logging -----------------------------------------------------------------

log_op() {
  mkdir -p "$LOG_DIR"
  printf '{"ts":"%s","stack":"%s","cmd":"%s","result":"%s","force":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "${4:-0}" >>"$LOG_FILE"
}

# --- docker helpers ------------------------------------------------------------

container_project() {
  docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$1" 2>/dev/null || true
}
container_workdir() {
  docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$1" 2>/dev/null || true
}

all_containers() { docker ps -a --format '{{.Names}}' | sort -u; }

# exact container names declared by the resolved compose config
# (container_name: entries). Empty output => caller falls back to prefix match.
compose_container_names() {
  "$@" config 2>/dev/null | awk '/container_name:/{print $2}' | sort -u
}

check_identity() {
  # $1=id $2=project $3=dir_abs $4=expected-container-names(one per line)
  # $5=prefix (fallback matcher). Returns 1 on mismatch.
  local project="$2" dir_abs="$3" names="$4" prefix="$5"
  local c cp cw problems=0
  if [ -n "$names" ]; then
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      cp="$(container_project "$c")"
      cw="$(container_workdir "$c")"
      # absent container is fine (fresh `up`); only existing containers with
      # a foreign project/workdir are a collision
      [ -z "$cp" ] && continue
      if [ "$cp" != "$project" ]; then
        echo "identity: container '$c' belongs to compose project '$cp' (workdir '${cw:-?}'), expected '$project'" >&2
        problems=1
      elif [ -n "$cw" ] && [ "$cw" != "$dir_abs" ]; then
        echo "identity: container '$c' project '$project' but working_dir '$cw' != '$dir_abs'" >&2
        problems=1
      fi
    done <<<"$names"
  else
    # fallback: prefix match (coarser; may catch sibling prefixes — prefer
    # fixing env so `compose config` resolves and names are exact)
    warn "identity: compose config yielded no container_name entries; falling back to prefix '$prefix-' match"
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      c="${c#/}"
      cp="$(container_project "$c")"
      cw="$(container_workdir "$c")"
      if [ "$cp" != "$project" ]; then
        echo "identity: container '$c' (prefix '$prefix-') belongs to compose project '${cp:-<none>}' (workdir '${cw:-?}'), expected '$project'" >&2
        problems=1
      elif [ -n "$cw" ] && [ "$cw" != "$dir_abs" ]; then
        echo "identity: container '$c' project '$project' but working_dir '$cw' != '$dir_abs'" >&2
        problems=1
      fi
    done < <(all_containers | grep -E "^${prefix}-(db|api|worker|web|caddy|cloudflared)(-[0-9]+)?$" || true)
  fi

  local pc
  while IFS= read -r pc; do
    [ -n "$pc" ] || continue
    cw="$(container_workdir "$pc")"
    if [ -n "$cw" ] && [ "$cw" != "$dir_abs" ]; then
      echo "identity: container '$pc' carries project '$project' but working_dir '$cw' != '$dir_abs'" >&2
      problems=1
    fi
  done < <(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.Names}}')
  return $problems
}

# prints "<host-port> <container>" for every published port held by a
# container NOT in project $1
foreign_ports() {
  local project="$1" cid cname cproj bindings port
  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    cproj="$(container_project "$cid")"
    [ "$cproj" = "$project" ] && continue
    cname="$(docker inspect -f '{{.Name}}' "$cid" | sed 's|^/||')"
    bindings="$(docker inspect -f '{{range $p,$b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$cid" 2>/dev/null || true)"
    for port in $(printf '%s' "$bindings" | tr ' ' '\n' | grep -oE '[0-9]+$' | sort -un); do
      [ -n "$port" ] && printf '%s %s\n' "$port" "$cname"
    done
  done < <(docker ps -q)
}

check_ports() {
  # $1 = csv expected ports, $2 = project
  local ports_csv="$1" project="$2" p holder
  [ -n "$ports_csv" ] && [ "$ports_csv" != "-" ] || return 0
  local foreign
  foreign="$(foreign_ports "$project")"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    holder="$(printf '%s\n' "$foreign" | awk -v p="$p" '$1==p {print $2; exit}')"
    if [ -n "$holder" ]; then
      echo "ports: host port $p is published by foreign container '$holder' (not project '$project')" >&2
      return 1
    fi
  done < <(split_csv "$ports_csv")
  return 0
}

check_volumes() {
  # $1 = project ; rest = compose argv. Uses `compose config --volumes`.
  local project="$1"; shift
  local vol c cp
  while IFS= read -r vol; do
    [ -n "$vol" ] || continue
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      cp="$(container_project "$c")"
      if [ -n "$cp" ] && [ "$cp" != "$project" ]; then
        echo "volumes: volume '$vol' is mounted by foreign container '$c' (project '$cp')" >&2
        return 1
      fi
    done < <(docker ps -a --filter "volume=$vol" --format '{{.Names}}' 2>/dev/null || true)
  done < <("$@" config --volumes 2>/dev/null | sort -u)
  return 0
}

check_images() {
  # $1 = csv expectations ; stdin = resolved image refs (one per line)
  # $2 = may_build (1|0)
  local expect="$1" may_build="$2" images e repo tag ref ok img
  images="$(cat)"
  [ -n "$expect" ] && [ "$expect" != "-" ] || expect=""
  while IFS= read -r e; do
    [ -n "$e" ] || continue
    repo="${e%%:*}"; tag=""
    case "$e" in *:*) tag="${e##*:}";; esac
    ok=0
    while IFS= read -r ref; do
      [ -n "$ref" ] || continue
      case "$ref" in
        "$repo"|"$repo:"*) ;;
        *) continue;;
      esac
      if [ -z "$tag" ] || [ "$ref" = "$e" ]; then ok=1; break; fi
    done <<<"$images"
    if [ "$ok" != "1" ]; then
      echo "images: expected image ref '$e' not present in resolved compose config" >&2
      return 1
    fi
  done < <(split_csv "$expect")

  while IFS= read -r img; do
    case "$img" in tastile-*) ;; *) continue;; esac
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      if [ "$may_build" = "1" ]; then
        echo "images: '$img' absent locally; command will build/pull" >&2
      else
        echo "images: '$img' absent locally and command does not build (use 'stack.sh $ID build' or pass --build)" >&2
        return 1
      fi
    fi
  done <<<"$images"
  return 0
}

preflight() {
  # $1=id $2=project $3=dir_abs $4=prefix $5=ports $6=images_csv $7=cmd $8=force
  local id="$1" project="$2" dir_abs="$3" prefix="$4" ports="$5" \
        images_csv="$6" cmd="$7" force="$8" problems=0

  # 0. compose config must resolve for mutating commands (missing env /
  #    bad interpolation). Read-only commands degrade to a warning so `ps`/
  #    `logs` still work while diagnosing env problems.
  local config_ok=1
  if ! "${COMPOSE_ARGV[@]}" config >/dev/null 2>&1; then
    config_ok=0
    if [[ "$READONLY_CMDS" == *" $cmd "* ]]; then
      warn "compose config does not resolve for '$id' (missing env?); continuing read-only with degraded checks"
    else
      echo "config: 'docker compose config' failed to resolve for stack '$id' (missing env file or vars?)" >&2
      problems=1
    fi
  fi

  # 1. allowlist
  if [ -n "${TASTILE_STACK_ALLOW:-}" ]; then
    case ",$TASTILE_STACK_ALLOW," in
      *",$id,"*) ;;
      *) echo "allowlist: stack '$id' not in TASTILE_STACK_ALLOW='$TASTILE_STACK_ALLOW'" >&2; problems=1;;
    esac
  fi

  # 2. identity — always checked; read-only commands warn instead of refuse
  local names=""
  [ "$config_ok" = "1" ] && names="$(compose_container_names "${COMPOSE_ARGV[@]}")"
  if check_identity "$id" "$project" "$dir_abs" "$names" "$prefix"; then
    :
  elif [[ "$READONLY_CMDS" == *" $cmd "* ]]; then
    warn "identity drift detected for '$id' (continuing: '$cmd' is read-only)"
  else
    problems=1
  fi

  if [[ "$MUTATING_CMDS" == *" $cmd "* && "$config_ok" = "1" ]]; then
    if [ "$cmd" = "up" ]; then
      check_ports "$ports" "$project" || problems=1
      local may_build=0
      case " ${PASSTHROUGH[*]:-} " in *" --build "*|*" --build "*) may_build=1;; esac
      [ "$cmd" = "pull" ] && may_build=1
      "${COMPOSE_ARGV[@]}" config --images 2>/dev/null | check_images "$images_csv" "$may_build" || problems=1
    fi
    check_volumes "$project" "${COMPOSE_ARGV[@]}" || problems=1
  fi

  if [ "$problems" != "0" ]; then
    if [ "$force" = "1" ]; then
      warn "preflight failures overridden by --force (logged)"
      return 0
    fi
    return 1
  fi
  return 0
}

# --- main ---------------------------------------------------------------------

main() {
  local stack_id="" cmd="" force=0
  local -a passthrough=()
  COMPOSE_ARGV=()
  PASSTHROUGH=()

  # leading global options only; everything after <stack> <cmd> is passed
  # through to compose verbatim (so `--force` inside e.g. `exec` args is safe)
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=1; shift;;
      list) list_stacks; exit 0;;
      -h|--help) usage 0;;
      *) break;;
    esac
  done
  stack_id="${1:-}"; cmd="${2:-}"
  if [ $# -ge 3 ]; then passthrough=("${@:3}"); fi

  [ -n "$stack_id" ] || usage 1
  [ -n "$cmd" ] || die "missing compose command (up|down|ps|logs|exec|restart|config|build|pull|...)"

  local row id dir rel_env project env_file klass prefix ports images cfiles
  row="$(lookup_stack "$stack_id")"
  id="$(field "$row" 1)";        dir="$(field "$row" 2)";      project="$(field "$row" 3)"
  rel_env="$(field "$row" 4)";   klass="$(field "$row" 5)";    prefix="$(field "$row" 6)"
  ports="$(field "$row" 7)";     images="$(field "$row" 8)";   cfiles="$(field "$row" 9)"

  local dir_abs="$ROOT/$dir"
  [ -d "$dir_abs" ] || die "stack dir '$dir_abs' does not exist"

  # env files: registry env_file, then optional TASTILE_STACK_ENV_FILE
  local -a env_args=()
  if [ "$rel_env" != "-" ] && [ -n "$rel_env" ]; then
    [ -f "$ROOT/$rel_env" ] || die "env file '$ROOT/$rel_env' for stack '$id' not found (gitignored; recreate per docs)"
    env_args+=(--env-file "$ROOT/$rel_env")
  elif [ -f "$dir_abs/.env" ]; then
    warn "no env_file in registry for '$id' but $dir_abs/.env exists; compose will auto-load it — pin one in stacks.tsv if intentional"
  fi
  if [ -n "${TASTILE_STACK_ENV_FILE:-}" ]; then
    [ -f "$TASTILE_STACK_ENV_FILE" ] || die "TASTILE_STACK_ENV_FILE '$TASTILE_STACK_ENV_FILE' not found"
    env_args+=(--env-file "$TASTILE_STACK_ENV_FILE")
  fi

  # compose files
  local -a compose_args=() f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    [ -f "$dir_abs/$f" ] || die "compose file '$dir_abs/$f' not found"
    compose_args+=(-f "$dir_abs/$f")
  done < <(split_csv "$cfiles")

  COMPOSE_ARGV=(docker compose ${env_args[@]+"${env_args[@]}"} -p "$project" ${compose_args[@]+"${compose_args[@]}"})
  PASSTHROUGH=(${passthrough[@]+"${passthrough[@]}"})

  # doctor: preflight only, never invokes compose. Evaluated as `up` so all
  # bring-up checks (ports/images/volumes/identity) are exercised.
  if [ "$cmd" = "doctor" ]; then
    if preflight "$id" "$project" "$dir_abs" "$prefix" "$ports" "$images" "up" "$force"; then
      echo "doctor: stack '$id' preflight PASS (project=$project dir=$dir_abs)"
      log_op "$id" "doctor" "pass" "$force"
      exit 0
    fi
    echo "doctor: stack '$id' preflight FAIL" >&2
    log_op "$id" "doctor" "fail" "$force"
    exit 1
  fi

  # destructive gate (prod-equiv / prod): volume removal only
  local destructive=0 a
  case " $cmd " in
    *" down "*|*" rm "*)
      for a in ${passthrough[@]+"${passthrough[@]}"}; do
        case "$a" in -v|--volumes|--volumes=*) destructive=1;; esac
      done;;
  esac
  if [ "$destructive" = "1" ] && { [ "$klass" = "prod" ] || [ "$klass" = "prod-equiv" ]; }; then
    if [ "${TASTILE_STACK_DESTRUCTIVE_OK:-}" != "$id" ]; then
      die "destructive op on class '$klass' stack '$id' requires TASTILE_STACK_DESTRUCTIVE_OK=$id (got '${TASTILE_STACK_DESTRUCTIVE_OK:-<unset>}')"
    fi
    warn "destructive operation on '$klass' stack '$id' explicitly confirmed via TASTILE_STACK_DESTRUCTIVE_OK"
    log_op "$id" "$cmd ${passthrough[*]:-}" "destructive-confirmed" "$force"
  fi

  # preflight on known commands
  case " $KNOWN_CMDS $READONLY_CMDS $MUTATING_CMDS " in
    *" $cmd "*)
      if preflight "$id" "$project" "$dir_abs" "$prefix" "$ports" "$images" "$cmd" "$force"; then
        log_op "$id" "$cmd ${passthrough[*]:-}" "preflight-pass" "$force"
      else
        log_op "$id" "$cmd ${passthrough[*]:-}" "preflight-refuse" "$force"
        die "preflight refused '$id $cmd' — fix the reported mismatch or re-run with --force (override is logged)"
      fi;;
    *) warn "command '$cmd' is not in the known set; passing through unmodified";;
  esac

  (cd "$dir_abs" && "${COMPOSE_ARGV[@]}" "$cmd" ${passthrough[@]+"${passthrough[@]}"})
  local rc=$?
  log_op "$id" "$cmd ${passthrough[*]:-}" "exit-$rc" "$force"
  return $rc
}

main "$@"
