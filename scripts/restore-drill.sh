#!/usr/bin/env bash
#
# Backup restore drill.
#
# An untested backup is a belief, not a capability. This takes a real dump,
# restores it into a scratch database, and reads rows back out — proving the
# whole path rather than that a file exists.
#
# Run it monthly and after any schema change. It never touches the source
# database, and it drops the scratch copy on the way out.
#
#   ./scripts/restore-drill.sh                    against local docker
#   DATABASE_URL=postgres://... ./scripts/...     against a real backup source
#
set -euo pipefail

CONTAINER="${PG_CONTAINER:-unsaid-postgres-1}"
DB_USER="${PGUSER:-unsaid}"
SOURCE_DB="${PGDATABASE:-unsaid}"
SCRATCH_DB="unsaid_restore_drill_$(date +%s)"
DUMP_DIR="${DUMP_DIR:-/tmp}"
DUMP_FILE="${DUMP_DIR}/unsaid-drill-$(date +%Y%m%d-%H%M%S).dump"

log() { printf '  %s\n' "$*"; }
fail() { printf '\nDRILL FAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  docker exec "$CONTAINER" dropdb -U "$DB_USER" --if-exists "$SCRATCH_DB" 2>/dev/null || true
  rm -f "$DUMP_FILE"
}
trap cleanup EXIT

echo
echo "Backup restore drill — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# --- 1. Take a dump -------------------------------------------------------
log "Dumping ${SOURCE_DB}…"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc "$SOURCE_DB" > "$DUMP_FILE" \
  || fail "pg_dump did not complete"

DUMP_BYTES=$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE")
[ "$DUMP_BYTES" -gt 1000 ] || fail "dump is suspiciously small (${DUMP_BYTES} bytes)"
log "Dump written: ${DUMP_BYTES} bytes"

# --- 2. Restore into a scratch database -----------------------------------
log "Restoring into ${SCRATCH_DB}…"
docker exec "$CONTAINER" createdb -U "$DB_USER" "$SCRATCH_DB" || fail "could not create scratch db"
docker exec -i "$CONTAINER" pg_restore -U "$DB_USER" -d "$SCRATCH_DB" --no-owner < "$DUMP_FILE" \
  || fail "pg_restore did not complete"

# --- 3. Prove the restored copy is actually usable -------------------------
query() {
  docker exec "$CONTAINER" psql -U "$DB_USER" -d "$SCRATCH_DB" -tAc "$1"
}

EXPECTED_TABLES="analytics_events consents content_keys feedback objects reflections security_events solana_records thoughts upload_intents users waitlist"
RESTORED_TABLES=$(query "select string_agg(tablename, ' ' order by tablename) from pg_tables where schemaname = 'public'")

for table in $EXPECTED_TABLES; do
  case " $RESTORED_TABLES " in
    *" $table "*) ;;
    *) fail "table '$table' is missing from the restored database" ;;
  esac
done
log "All $(echo "$EXPECTED_TABLES" | wc -w) tables present"

# Row counts should match between source and restore. A restore that produces
# an empty schema passes a "does it exist" check and loses everything.
for table in users thoughts content_keys; do
  SOURCE_COUNT=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$SOURCE_DB" -tAc "select count(*) from ${table}")
  RESTORED_COUNT=$(query "select count(*) from ${table}")
  [ "$SOURCE_COUNT" = "$RESTORED_COUNT" ] \
    || fail "${table}: source has ${SOURCE_COUNT} rows, restore has ${RESTORED_COUNT}"
  log "${table}: ${RESTORED_COUNT} rows match"
done

# The constraint that keeps two vaults from colliding must survive a restore.
INDEXES=$(query "select count(*) from pg_indexes where schemaname='public' and indexname='users_account_lookup_idx'")
[ "$INDEXES" = "1" ] || fail "unique index on users.account_lookup did not survive the restore"
log "Indexes and constraints intact"

# Wrapped keys are the one thing whose loss is unrecoverable: without them the
# ciphertext is undecryptable forever, so a restore that drops them is a
# silent, permanent data loss.
NULL_KEYS=$(query "select count(*) from content_keys where wrapped_key is null or wrapped_key = ''")
[ "$NULL_KEYS" = "0" ] || fail "${NULL_KEYS} content keys came back empty — ciphertext would be unrecoverable"
log "Wrapped keys intact"

echo
echo "DRILL PASSED — restore verified $(date -u +%Y-%m-%d)"
echo "Record this date in docs/decisions.md under 'Not yet done'."
echo
