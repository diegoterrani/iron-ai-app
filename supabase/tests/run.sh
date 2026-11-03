#!/usr/bin/env bash
# Roda migrações + testes de banco num Postgres descartável.
# Uso: DATABASE_URL=postgres://... supabase/tests/run.sh
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL de um banco DESCARTÁVEL}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DIR/tests/stub_supabase.sql"
# Migrações e testes rodam como "migrador" (sem superuser), como no Supabase.
export PGOPTIONS="-c role=migrador"
for m in "$DIR"/migrations/*.sql; do
  echo "migração: $(basename "$m")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$m"
done
for t in "$DIR"/tests/*_test.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$t"
done
