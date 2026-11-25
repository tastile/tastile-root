#!/usr/bin/env bash
# disk-hygiene.sh — host disk resource guard for the Tastile workspace.
#
# Prevents recurrence of disk exhaustion (root#170). All destructive
# subcommands are dry-run by default; pass --apply to delete.
#
# Protected paths are NEVER touched: .tmp/prod-pin, .tmp/acceptance,
# .tmp/prod-equivalent, and anything outside the explicit scan roots.
#
# Usage:
#   disk-hygiene.sh report [--root DIR]
#   disk-hygiene.sh check [--path DIR] [--min-free-gb N] [--warn-only]
#   disk-hygiene.sh fingerprints [--root DIR] [--min-age-hours N] [--apply] [--force]
#   disk-hygiene.sh tmp [--root DIR] [--older-than DAYS] [--apply]
#
# Exit codes: 0 ok / dry-run, 1 failure, 2 blocked (insufficient space or
# unsafe conditions). Matches scripts/check-workspace.ps1 semantics.

set -euo pipefail

PROG="$(basename "$0")"

# .tmp entries that must never be auto-deleted (release evidence, pins).
TMP_PROTECTED="prod-pin acceptance prod-equivalent"

usage() {
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

die() { echo "$PROG: error: $*" >&2; exit 1; }
blocked() { echo "$PROG: blocked: $*" >&2; exit 2; }

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Human-readable size for KiB input (macOS + Linux du -k compatible).
hsize() {
    awk -v k="$1" 'BEGIN {
        split("KiB MiB GiB TiB", u, " ");
        v = k; i = 1;
        while (v >= 1024 && i < 4) { v /= 1024; i++ }
        printf "%.1f%s", v, u[i]
    }'
}

# Free KiB on the filesystem containing PATH (df -Pk, POSIX).
free_kib() {
    local p="${1:-.}"
    df -Pk "$p" 2>/dev/null | awk 'NR==2 {print $4}'
}

cmd_report() {
    local root="$(cd "$(dirname "$0")/.." && pwd)"
    while [ $# -gt 0 ]; do
        case "$1" in
            --root) root="$2"; shift 2 ;;
            *) die "unknown option: $1" ;;
        esac
    done
    echo "== filesystems =="
    df -h "$root" / 2>/dev/null | awk 'NR==1 || !seen[$1]++' | sed 's/^/  /'
    echo "== workspace hotspots ($root) =="
    local d
    for d in \
        "$root/.tmp" \
        "$root/acceptance/.tmp" \
        "$root"/*/target \
        "$root"/*/node_modules \
        "$root"/*/.next \
        "$root"/*/DerivedData \
        "$root"/tastile-core/crates-v1/target; do
        [ -e "$d" ] || continue
        printf '  %s\t%s\n' "$(du -sk "$d" 2>/dev/null | cut -f1)" "$d"
    done | sort -rn | while IFS=$'\t' read -r kb path; do
        printf '  %8s  %s\n' "$(hsize "$kb")" "$path"
    done
}

cmd_check() {
    local path="." min_gb="${TASTILE_MIN_FREE_GB:-15}" warn_only=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --path) path="$2"; shift 2 ;;
            --min-free-gb) min_gb="$2"; shift 2 ;;
            --warn-only) warn_only=1; shift ;;
            *) die "unknown option: $1" ;;
        esac
    done
    local fkib
    fkib="$(free_kib "$path")" || blocked "cannot stat $path"
    [ -n "$fkib" ] || blocked "cannot determine free space for $path"
    local fgib avail_kib need_kib
    avail_kib=$((fkib * 1024))
    need_kib=$((min_gb * 1024 * 1024))
    fgib=$(awk -v k="$fkib" 'BEGIN{printf "%.1f", k/1024/1024}')
    echo "$PROG: $path free=${fgib}GiB required>=${min_gb}GiB"
    if [ "$avail_kib" -lt "$need_kib" ]; then
        if [ "$warn_only" -eq 1 ]; then
            echo "$PROG: WARNING: below threshold" >&2
            return 0
        fi
        blocked "insufficient free space on $(df -P "$path" | awk 'NR==2{print $6}'): ${fgib}GiB < ${min_gb}GiB. Run '$PROG' report / fingerprints / tmp, or free space manually."
    fi
}

# --- fingerprints -----------------------------------------------------------
# Cargo never GCs target/<profile>/build/<pkg>-<metadata>/ dirs; stale
# metadata hashes accumulate. Keep the newest dir per package prefix and
# anything touched within --min-age-hours; delete the rest on --apply.

cargo_active() {
    # True when a cargo/rustc/build-script process looks alive.
    pgrep -f 'cargo|rustc' >/dev/null 2>&1 && return 0
    pgrep -f 'build-script-build' >/dev/null 2>&1 && return 0
    return 1
}

cmd_fingerprints() {
    local root="$(cd "$(dirname "$0")/.." && pwd)"
    local min_age=24 apply=0 force=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --root) root="$2"; shift 2 ;;
            --min-age-hours) min_age="$2"; shift 2 ;;
            --apply) apply=1; shift ;;
            --force) force=1; shift ;;
            *) die "unknown option: $1" ;;
        esac
    done
    [ -d "$root" ] || die "root not found: $root"

    if cargo_active && [ "$force" -eq 0 ]; then
        blocked "cargo/rustc appears to be running; re-run with --force to override"
    fi

    # Collect build dirs: .../target/<...>/build
    local build_dirs
    build_dirs="$(find "$root" -type d -name build -path '*/target/*' -prune 2>/dev/null)" \
        || die "find failed under $root"
    [ -n "$build_dirs" ] || { echo "$PROG: no cargo build dirs under $root"; return 0; }

    local now stale_total=0 stale_count=0 kept=0
    now="$(date +%s)"
    local -a doomed=()

    # Cargo build-script output dirs come in two layouts:
    #   legacy: target/<profile>/build/<pkg>-<16hex>/
    #   current: target/<profile>/build/<pkg>/<16hex>/
    # Either way the leaf is a 16-lowercase-hex dir; the group key is the
    # package identity (parent dir for the nested layout, stripped name
    # for the flat layout). We keep the newest leaf per key.
    local leaf_re='^[0-9a-f]{16}$'
    local flat_re='-[0-9a-f]{16}$'

    while IFS= read -r bdir; do
        [ -d "$bdir" ] || continue
        local listing keys key mt path kb age_h newest_mt
        listing="$(
            # Nested layout: <pkg>/<16hex>
            find "$bdir" -mindepth 2 -maxdepth 2 -type d 2>/dev/null \
                | while IFS= read -r e; do
                    b="$(basename "$e")"
                    [[ "$b" =~ $leaf_re ]] || continue
                    printf '%s\t%s\t%s\n' \
                        "$(stat -f %m "$e" 2>/dev/null || stat -c %Y "$e" 2>/dev/null || echo 0)" \
                        "$(dirname "$e")" \
                        "$e"
                  done
            # Flat layout: <pkg>-<16hex>
            find "$bdir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
                | while IFS= read -r e; do
                    b="$(basename "$e")"
                    [[ "$b" =~ $flat_re ]] || continue
                    printf '%s\t%s\t%s\n' \
                        "$(stat -f %m "$e" 2>/dev/null || stat -c %Y "$e" 2>/dev/null || echo 0)" \
                        "$bdir/$(printf '%s' "$b" | sed -E 's/-[0-9a-f]{16}$//')" \
                        "$e"
                  done
        )"
        [ -n "$listing" ] || continue
        keys="$(printf '%s\n' "$listing" | cut -f2 | sort -u)"
        while IFS= read -r key; do
            [ -n "$key" ] || continue
            newest_mt=0
            while IFS=$'\t' read -r mt _k path; do
                [ "$_k" = "$key" ] || continue
                [ "$mt" -gt "$newest_mt" ] && newest_mt=$mt
            done <<< "$listing"
            while IFS=$'\t' read -r mt _k path; do
                [ "$_k" = "$key" ] || continue
                [ "$mt" = "$newest_mt" ] && { kept=$((kept + 1)); continue; }
                age_h=$(( (now - mt) / 3600 ))
                if [ "$age_h" -lt "$min_age" ]; then
                    kept=$((kept + 1))
                    continue
                fi
                kb="$(du -sk "$path" 2>/dev/null | cut -f1)"
                stale_total=$((stale_total + ${kb:-0}))
                stale_count=$((stale_count + 1))
                doomed+=("$path")
                printf '  stale %s  age=%sh  size=%s\n' "$path" "$age_h" "$(hsize "${kb:-0}")"
            done <<< "$listing"
        done <<< "$keys"
    done <<< "$build_dirs"

    echo "$PROG: fingerprints: ${stale_count} stale dirs, $(hsize "$stale_total") reclaimable (kept ${kept} recent)"
    if [ "$apply" -eq 1 ] && [ "${#doomed[@]}" -gt 0 ]; then
        printf '%s\n' "${doomed[@]}" | while IFS= read -r p; do rm -rf -- "$p"; done
        echo "$PROG: deleted ${#doomed[@]} stale fingerprint dirs"
    elif [ "${#doomed[@]}" -gt 0 ]; then
        echo "dry-run: re-run with --apply to delete"
    fi
}

# --- tmp --------------------------------------------------------------------
# Report (and optionally delete) .tmp entries older than --older-than days.
# Protected basenames are always skipped.

cmd_tmp() {
    local root="$(cd "$(dirname "$0")/.." && pwd)"
    local older=30 apply=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --root) root="$2"; shift 2 ;;
            --older-than) older="$2"; shift 2 ;;
            --apply) apply=1; shift ;;
            *) die "unknown option: $1" ;;
        esac
    done

    local cutoff=$(( $(date +%s) - older * 86400 ))
    local total_kb=0 count=0
    local -a victims=()

    # .tmp dirs directly under root and one level into sibling checkouts
    # is overkill; workspace contract keeps .tmp at repo roots.
    local tmpdir
    for tmpdir in "$root/.tmp" "$root"/*/.tmp; do
        [ -d "$tmpdir" ] || continue
        local entry mt base kb
        while IFS= read -r entry; do
            base="$(basename "$entry")"
            local prot=0 p
            for p in $TMP_PROTECTED; do [ "$base" = "$p" ] && prot=1; done
            [ "$prot" -eq 1 ] && continue
            mt="$(stat -f %m "$entry" 2>/dev/null || stat -c %Y "$entry" 2>/dev/null)" || mt=0
            [ "$mt" -gt 0 ] 2>/dev/null || continue
            [ "$mt" -lt "$cutoff" ] || continue
            kb="$(du -sk "$entry" 2>/dev/null | cut -f1)"
            total_kb=$((total_kb + ${kb:-0}))
            count=$((count + 1))
            victims+=("$entry")
            printf '  old %s  mtime=%s  size=%s\n' "$entry" "$(date -r "$mt" '+%Y-%m-%d' 2>/dev/null || date -d "@$mt" '+%Y-%m-%d')" "$(hsize "${kb:-0}")"
        done <<EOF
$(find "$tmpdir" -mindepth 1 -maxdepth 1 2>/dev/null)
EOF
    done

    echo "$PROG: tmp: ${count} entries older than ${older}d, $(hsize "$total_kb") (protected: $TMP_PROTECTED)"
    if [ "$apply" -eq 1 ] && [ "${count}" -gt 0 ]; then
        printf '%s\n' "${victims[@]}" | while IFS= read -r p; do rm -rf -- "$p"; done
        echo "$PROG: deleted ${count} stale .tmp entries"
    elif [ "$count" -gt 0 ]; then
        echo "dry-run: re-run with --apply to delete"
    fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
    report) cmd_report "$@" ;;
    check) cmd_check "$@" ;;
    fingerprints) cmd_fingerprints "$@" ;;
    tmp) cmd_tmp "$@" ;;
    -h|--help|"") usage ;;
    *) die "unknown command: $cmd (try --help)" ;;
esac
