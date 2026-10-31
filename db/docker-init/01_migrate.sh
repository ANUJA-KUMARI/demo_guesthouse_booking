#!/bin/sh
# 01_migrate.sh - runs ONCE, the first time the Postgres container starts
# with an EMPTY data volume (that's how the official postgres image treats
# files in /docker-entrypoint-initdb.d). It builds the whole database:
#   extension -> migrations 001..010 (in name order) -> app password -> (optional) seed
# To run it again from scratch:  docker compose down -v   (-v deletes the data!)
set -e
PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

$PSQL -c "CREATE EXTENSION IF NOT EXISTS btree_gist"

for f in $(ls /migrations/*.sql | sort); do
  echo ">> migration $f"
  $PSQL -f "$f"
done

# 006 creates guesthouse_app with the placeholder password 'change_me'.
# Replace it with the real one from docker-compose / .env.
$PSQL -c "ALTER ROLE guesthouse_app PASSWORD '$APP_DB_PASSWORD'"

if [ "$LOAD_SEED" = "true" ] && [ -f /seed/009_seed.sql ]; then
  echo ">> seed (5000+ rows)"
  $PSQL -f /seed/009_seed.sql
fi
echo ">> database ready"
