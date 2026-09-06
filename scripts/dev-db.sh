#!/usr/bin/env bash
# Local Postgres 16 for MATCHED development.
#
# Environment notes that this script exists to encapsulate:
#   * There is no running Postgres service and no Docker daemon in this
#     environment, so the cluster is created from the server binaries directly.
#   * Postgres refuses to run as root, so initdb/pg_ctl are invoked through the
#     `postgres` system user with `su`.
#   * The data directory lives outside the repository (scratch space) so that a
#     cluster is never committed.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/matched-dev}"
PGPORT="${PGPORT:-5433}"
PGLOG="${PGLOG:-/var/lib/postgresql/matched-dev.log}"
DB_NAME="${DB_NAME:-matched}"
DB_USER="${DB_USER:-matched}"
DB_PASSWORD="${DB_PASSWORD:-matched}"

as_postgres() {
  su postgres -s /bin/bash -c "$1"
}

require_binaries() {
  if [ ! -x "$PGBIN/initdb" ]; then
    echo "Postgres server binaries not found at $PGBIN" >&2
    echo "Set PGBIN to the directory containing initdb/pg_ctl." >&2
    exit 1
  fi
}

ensure_owned() {
  mkdir -p "$(dirname "$PGDATA")"
  chown postgres:postgres "$(dirname "$PGDATA")" 2>/dev/null || true
  touch "$PGLOG"
  chown postgres:postgres "$PGLOG" 2>/dev/null || true
}

cmd_init() {
  require_binaries
  ensure_owned
  if [ -f "$PGDATA/PG_VERSION" ]; then
    echo "Cluster already initialised at $PGDATA"
    return 0
  fi
  echo "Initialising cluster at $PGDATA"
  as_postgres "$PGBIN/initdb -D '$PGDATA' -U postgres --auth-local=trust --auth-host=trust -E UTF8"
}

cmd_start() {
  cmd_init
  if as_postgres "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1; then
    echo "Postgres already running on port $PGPORT"
  else
    echo "Starting Postgres on port $PGPORT"
    as_postgres "$PGBIN/pg_ctl -D '$PGDATA' -l '$PGLOG' -o '-p $PGPORT -k /tmp' -w start"
  fi
  cmd_provision
  echo
  echo "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@127.0.0.1:$PGPORT/$DB_NAME?schema=public"
}

cmd_provision() {
  local psql="$PGBIN/psql -h /tmp -p $PGPORT -U postgres -d postgres -tAc"
  if [ "$(as_postgres "$psql \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"")" != "1" ]; then
    echo "Creating role $DB_USER"
    as_postgres "$psql \"CREATE ROLE $DB_USER LOGIN SUPERUSER PASSWORD '$DB_PASSWORD'\"" >/dev/null
  fi
  if [ "$(as_postgres "$psql \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"")" != "1" ]; then
    echo "Creating database $DB_NAME"
    as_postgres "$psql \"CREATE DATABASE $DB_NAME OWNER $DB_USER\"" >/dev/null
  fi
  # pg-boss keeps its queue tables in a dedicated schema.
  as_postgres "$PGBIN/psql -h /tmp -p $PGPORT -U postgres -d $DB_NAME -tAc \"CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION $DB_USER\"" >/dev/null
}

cmd_stop() {
  if as_postgres "$PGBIN/pg_ctl -D '$PGDATA' status" >/dev/null 2>&1; then
    as_postgres "$PGBIN/pg_ctl -D '$PGDATA' -m fast -w stop"
  else
    echo "Postgres is not running"
  fi
}

cmd_status() {
  as_postgres "$PGBIN/pg_ctl -D '$PGDATA' status" || true
}

cmd_psql() {
  as_postgres "$PGBIN/psql -h /tmp -p $PGPORT -U postgres -d $DB_NAME"
}

case "${1:-start}" in
  init) cmd_init ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  psql) cmd_psql ;;
  *)
    echo "usage: $0 {init|start|stop|restart|status|psql}" >&2
    exit 1
    ;;
esac
