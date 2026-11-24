#!/usr/bin/env bash
# First-boot provisioning for the prod stack DB (NF04-R02).
# Runs once by the postgres image's docker-entrypoint-initdb.d mechanism.
# Creates the Core database/role and the Better Auth database/role as separate
# credentials, per ADR-0025 (Better Auth DB/role isolated from Core).
# Idempotent guards are unnecessary: initdb scripts run only on an empty
# data directory. Never reuse the Muse operational credentials.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-SQL
	CREATE ROLE ${TASTILE_CORE_DB_USER} LOGIN PASSWORD '${TASTILE_CORE_DB_PASSWORD}';
	CREATE DATABASE ${TASTILE_CORE_DB} OWNER ${TASTILE_CORE_DB_USER};
	CREATE ROLE ${TASTILE_AUTH_DB_USER} LOGIN PASSWORD '${TASTILE_AUTH_DB_PASSWORD}';
	CREATE DATABASE ${TASTILE_AUTH_DB} OWNER ${TASTILE_AUTH_DB_USER};
SQL
