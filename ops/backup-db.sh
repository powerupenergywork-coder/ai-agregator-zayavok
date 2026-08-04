#!/bin/sh
# Nightly backup of the production database and the uploaded photos.
#
# pg_dump runs inside the postgres container, so nothing has to be installed
# on the host and the dump always matches the server version. Custom format
# (-Fc) rather than plain SQL: it is compressed already and pg_restore can
# pull out a single table from it, which is what you actually want at 3am
# when one table got wiped rather than the whole database.
#
# The size check matters more than it looks. A dump that fails midway still
# leaves a file behind, and a backup directory full of truncated files looks
# exactly like a backup directory full of good ones until the day you need
# one. Anything implausibly small is treated as a failure and kept with a
# .BAD suffix so the next run can't quietly rotate the evidence away.
set -e

DIR=/home/artur/backups
LOG=$DIR/backup.log
KEEP_DB_DAYS=30
KEEP_UPLOADS_DAYS=14
MIN_DUMP_BYTES=20000

mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$DIR/db-$STAMP.dump"

echo "=== $(date -Is) backup ===" >> "$LOG"

# --- database ---
if docker exec aggregator_postgres_1 pg_dump -U app -Fc ai_zayavki > "$DUMP" 2>>"$LOG"; then
  SIZE=$(wc -c < "$DUMP")
  if [ "$SIZE" -lt "$MIN_DUMP_BYTES" ]; then
    mv "$DUMP" "$DUMP.BAD"
    echo "ОШИБКА: дамп подозрительно мал ($SIZE байт), сохранён как $DUMP.BAD" >> "$LOG"
  else
    echo "база: $DUMP ($SIZE байт)" >> "$LOG"
  fi
else
  rm -f "$DUMP"
  echo "ОШИБКА: pg_dump не отработал" >> "$LOG"
fi

# --- uploaded photos ---
# They live in a named volume, so they are read out through a throwaway
# container rather than from a host path.
TAR="$DIR/uploads-$STAMP.tar.gz"
if docker run --rm -v aggregator_uploads_data:/data alpine \
     tar czf - -C /data . > "$TAR" 2>>"$LOG"; then
  echo "фото: $TAR ($(wc -c < "$TAR") байт)" >> "$LOG"
else
  rm -f "$TAR"
  echo "ОШИБКА: не удалось упаковать фото" >> "$LOG"
fi

# --- rotation ---
find "$DIR" -name 'db-*.dump' -mtime +$KEEP_DB_DAYS -delete
find "$DIR" -name 'uploads-*.tar.gz' -mtime +$KEEP_UPLOADS_DAYS -delete

echo "хранится копий: $(ls -1 "$DIR"/db-*.dump 2>/dev/null | wc -l)" >> "$LOG"
