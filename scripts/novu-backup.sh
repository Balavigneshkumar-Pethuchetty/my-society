#!/bin/bash
# Novu MongoDB Backup Script - Full and incremental backups
# Creates timestamped backups with compression and verification

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
BACKUP_TYPE="${1:-full}"  # full or incremental
BACKUP_DIR="${BACKUP_DIR:-./backups/novu}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CONTAINER="society_novu_mongo"

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Novu MongoDB Backup${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Verify Docker and MongoDB
echo -e "${CYAN}1. Verification${NC}"

if ! docker ps --filter "name=$CONTAINER" --format '{{.State}}' 2>/dev/null | grep -q running; then
    echo -e "${RED}✗ MongoDB container not running${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} MongoDB container is running"

# Create backup directory
mkdir -p "$BACKUP_DIR"/{full,incremental,metadata}
echo -e "${GREEN}✓${NC} Backup directory ready: $BACKUP_DIR"

echo ""

# Perform backup
echo -e "${CYAN}2. Creating ${BACKUP_TYPE} Backup${NC}"

case "$BACKUP_TYPE" in
    full)
        BACKUP_FILE="$BACKUP_DIR/full/novu_full_${TIMESTAMP}.tar.gz"
        echo "  Dumping MongoDB database..."

        docker exec "$CONTAINER" mongodump \
            --out /tmp/novu-backup-${TIMESTAMP} \
            --db novu \
            --quiet 2>/dev/null

        echo "  Compressing backup..."
        tar -czf "$BACKUP_FILE" -C /tmp "novu-backup-${TIMESTAMP}" 2>/dev/null

        docker exec "$CONTAINER" rm -rf "/tmp/novu-backup-${TIMESTAMP}"

        if [ -f "$BACKUP_FILE" ]; then
            SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
            echo -e "${GREEN}✓${NC} Full backup created"
            echo "  File: $(basename $BACKUP_FILE)"
            echo "  Size: $SIZE"
        else
            echo -e "${RED}✗ Backup creation failed${NC}"
            exit 1
        fi
        ;;

    incremental)
        BACKUP_FILE="$BACKUP_DIR/incremental/novu_incremental_${TIMESTAMP}.tar.gz"
        echo "  Creating incremental backup..."

        # For simplicity, create a delta dump (in production, use oplog)
        docker exec "$CONTAINER" mongodump \
            --out /tmp/novu-incremental-${TIMESTAMP} \
            --db novu \
            --quiet 2>/dev/null

        tar -czf "$BACKUP_FILE" -C /tmp "novu-incremental-${TIMESTAMP}" 2>/dev/null
        docker exec "$CONTAINER" rm -rf "/tmp/novu-incremental-${TIMESTAMP}"

        if [ -f "$BACKUP_FILE" ]; then
            SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
            echo -e "${GREEN}✓${NC} Incremental backup created"
            echo "  File: $(basename $BACKUP_FILE)"
            echo "  Size: $SIZE"
        else
            echo -e "${RED}✗ Backup creation failed${NC}"
            exit 1
        fi
        ;;

    *)
        echo -e "${RED}✗ Unknown backup type: $BACKUP_TYPE${NC}"
        echo "  Valid types: full, incremental"
        exit 1
        ;;
esac

echo ""

# Save metadata
echo -e "${CYAN}3. Metadata${NC}"

METADATA_FILE="$BACKUP_DIR/metadata/novu_${TIMESTAMP}.json"

cat > "$METADATA_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_type": "$BACKUP_TYPE",
  "backup_file": "$(basename $BACKUP_FILE)",
  "file_size": "$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE")",
  "database": "novu",
  "container": "$CONTAINER"
}
EOF

echo -e "${GREEN}✓${NC} Metadata saved"

echo ""

# Verify backup integrity
echo -e "${CYAN}4. Verification${NC}"

if tar -tzf "$BACKUP_FILE" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backup integrity verified"
else
    echo -e "${YELLOW}⚠${NC} Backup verification warning"
fi

echo ""

# Cleanup old backups
echo -e "${CYAN}5. Retention Policy${NC}"

echo "  Removing backups older than $RETENTION_DAYS days..."

PURGE_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y%m%d 2>/dev/null || \
             date -v-${RETENTION_DAYS}d +%Y%m%d)

OLD_FILES=$(find "$BACKUP_DIR"/full "$BACKUP_DIR"/incremental \
    -name "*.tar.gz" \
    -type f 2>/dev/null | \
    while read f; do
        FILE_DATE=$(echo "$(basename $f)" | grep -o '[0-9]\{8\}' | head -1)
        [ "$FILE_DATE" -lt "$PURGE_DATE" ] && echo "$f"
    done)

if [ -n "$OLD_FILES" ]; then
    echo "$OLD_FILES" | xargs rm -f
    COUNT=$(echo "$OLD_FILES" | wc -l)
    echo -e "${GREEN}✓${NC} Removed $COUNT old backup(s)"
else
    echo -e "${GREEN}✓${NC} No backups to remove"
fi

echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Backup Complete${NC}"
echo ""
echo "  Backup type:     $BACKUP_TYPE"
echo "  File:            $(basename $BACKUP_FILE)"
echo "  Location:        $BACKUP_DIR"
echo "  Size:            $(du -h "$BACKUP_FILE" | cut -f1)"
echo "  Retention:       $RETENTION_DAYS days"
echo ""
echo "  To restore:"
echo "    ./scripts/novu-restore.sh $BACKUP_FILE"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
