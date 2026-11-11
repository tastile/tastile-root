#!/bin/bash
# Bootstrap the local Better Auth database for web verification.
# Idempotent: creates `tastile_auth` if absent and applies the schema in this directory.
# Uses the running `tastile-verify-db` container (started by compose); host psql is not required.
# Usage: bash bootstrap-web-auth.sh
set -euo pipefail

PG_CONTAINER="${TASTILE_PG_CONTAINER:-tastile-verify-db}"
PG_USER="${TASTILE_PG_USER:-tastile}"
PG_AUTH_DB="${TASTILE_PG_AUTH_DB:-tastile_auth}"
PG_DB_ADMIN="${TASTILE_PG_DB_ADMIN:-postgres}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> creating ${PG_AUTH_DB} (idempotent)"
docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB_ADMIN}" \
  -tc "SELECT 1 FROM pg_database WHERE datname = '${PG_AUTH_DB}'" | grep -q 1 \
  || docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB_ADMIN}" \
      -c "CREATE DATABASE ${PG_AUTH_DB} OWNER ${PG_USER}"

echo "==> applying better-auth schema to ${PG_AUTH_DB}"
docker exec -i "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_AUTH_DB}" \
  -v ON_ERROR_STOP=1 \
  -f - < "${here}/better-auth-schema.sql"

echo "==> tables in ${PG_AUTH_DB}"
docker exec "${PG_CONTAINER}" psql -U "${PG_USER}" -d "${PG_AUTH_DB}" \
  -c '\dt'

echo "==> done"
