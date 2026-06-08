#!/bin/bash
# Postgres initialization script. Executed automatically by the postgres
# image on first start (only when the data directory is empty).
#
# Creates the `dify_plugin` database used by langgenius/dify-plugin-daemon.
# Without this, plugin_daemon fails to start because it expects the database
# to already exist (it does not auto-create it).

set -e

PLUGIN_DB="${DB_PLUGIN_DATABASE:-dify_plugin}"

echo "[postgres-init] Ensuring database '${PLUGIN_DB}' exists..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE "${PLUGIN_DB}"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${PLUGIN_DB}')\gexec
EOSQL

echo "[postgres-init] Done."
