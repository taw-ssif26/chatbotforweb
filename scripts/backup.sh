#!/bin/sh
# Manual backup: DATABASE_URL=... ./scripts/backup.sh   (needs Docker; Neon runs Postgres 17)
set -e
docker run --rm -e DATABASE_URL postgres:17-alpine sh -c 'pg_dump "$DATABASE_URL" --no-owner' | gzip > "backup-$(date +%F).sql.gz"
echo "saved backup-$(date +%F).sql.gz"
