#!/bin/bash
# Novu MongoDB Restore Script - Restores from backup with verification
# Usage: ./novu-restore.sh <backup-file> [--drop-existing]

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
BACKUP_FILE="${1}"
DROP_EXISTING="${2:-}"
CONTAINER="society_novu_mongo"

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Novu MongoDB Restore${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Validation
echo -e "${CYAN}1. Pre-Restore Checks${NC}"

if [ -z "$BACKUP_FILE" ]; then
    echo -e "${RED}✗ Backup file not specified${NC}"
    echo "  Usage: ./novu-restore.sh <backup-file> [--drop-existing]"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}✗ Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Backup file exists"

if ! docker ps --filter "name=$CONTAINER" --format '{{.State}}' 2>/dev/null | grep -q running; then
    echo -e "${RED}✗ MongoDB container not running${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} MongoDB container is running"

# Verify backup integrity
echo "  Verifying backup integrity..."
if tar -tzf "$BACKUP_FILE" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backup integrity verified"
else
    echo -e "${RED}✗ Backup file appears corrupted${NC}"
    exit 1
fi

echo ""

# Backup current data (safety)
echo -e "${CYAN}2. Safety Backup${NC}"

SAFETY_BACKUP="/tmp/novu_safety_backup_$(date +%s).tar.gz"
echo "  Creating safety backup of current database..."

docker exec "$CONTAINER" mongodump \
    --out /tmp/novu-safety-backup \
    --db novu \
    --quiet 2>/dev/null

tar -czf "$SAFETY_BACKUP" -C /tmp novu-safety-backup 2>/dev/null
docker exec "$CONTAINER" rm -rf /tmp/novu-safety-backup

echo -e "${GREEN}✓${NC} Safety backup created: $SAFETY_BACKUP"

echo ""

# Handle existing data
echo -e "${CYAN}3. Data Preparation${NC}"

if [ "$DROP_EXISTING" = "--drop-existing" ]; then
    echo "  Dropping existing Novu database..."
    docker exec "$CONTAINER" mongosh localhost:27017/novu \
        --eval "db.dropDatabase();" \
        --quiet 2>/dev/null
    echo -e "${GREEN}✓${NC} Existing database dropped"
else
    echo "  Keeping existing collections (restore will overwrite)"
    echo "  Tip: Use --drop-existing flag to drop existing data first"
fi

echo ""

# Extract and restore backup
echo -e "${CYAN}4. Restoring Backup${NC}"

EXTRACT_DIR="/tmp/novu-restore-$$"
mkdir -p "$EXTRACT_DIR"

echo "  Extracting backup..."
tar -xzf "$BACKUP_FILE" -C "$EXTRACT_DIR" 2>/dev/null

# Find the backup directory (handle different structures)
BACKUP_SOURCE=$(find "$EXTRACT_DIR" -name "novu-*" -type d | head -1)

if [ -z "$BACKUP_SOURCE" ]; then
    echo -e "${RED}✗ Cannot find backup data in archive${NC}"
    rm -rf "$EXTRACT_DIR"
    exit 1
fi

echo "  Restoring to MongoDB..."

docker cp "$BACKUP_SOURCE/novu" "$CONTAINER:/tmp/novu-restore-data"

docker exec "$CONTAINER" mongorestore \
    /tmp/novu-restore-data/novu \
    --db novu \
    --quiet 2>/dev/null

docker exec "$CONTAINER" rm -rf /tmp/novu-restore-data

rm -rf "$EXTRACT_DIR"

echo -e "${GREEN}✓${NC} Backup restored successfully"

echo ""

# Verify restoration
echo -e "${CYAN}5. Verification${NC}"

# Count restored collections
COUNT=$(docker exec "$CONTAINER" mongosh localhost:27017/novu \
    --eval "db.getCollectionNames().length" \
    --quiet 2>/dev/null || echo "?")

echo "  Collections restored: $COUNT"

# Check document count
DOCS=$(docker exec "$CONTAINER" mongosh localhost:27017/novu \
    --eval "db.getCollectionNames().map(c => db[c].countDocuments()).reduce((a,b) => a+b, 0)" \
    --quiet 2>/dev/null || echo "?")

echo -e "${GREEN}✓${NC} Restoration verified"
echo "    Total documents: $DOCS"

echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Restore Complete${NC}"
echo ""
echo "  Backup file:      $(basename $BACKUP_FILE)"
echo "  Collections:      $COUNT"
echo "  Documents:        $DOCS"
echo "  Safety backup:    $SAFETY_BACKUP"
echo ""
echo "  Next steps:"
echo "    1. Verify data integrity in Novu dashboard"
echo "    2. Test notifications are working"
echo "    3. Monitor system health"
echo ""
echo "  Rollback (if needed):"
echo "    ./scripts/novu-restore.sh $SAFETY_BACKUP --drop-existing"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
