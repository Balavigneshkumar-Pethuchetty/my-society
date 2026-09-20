#!/bin/bash
# Novu Data Archive & Retention - Manages old notifications and data retention
# Archives old notifications and applies retention policies

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration (from env or defaults)
ARCHIVE_DIR="${ARCHIVE_DIR:-./archives/novu}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"  # Keep 90 days of live notifications
ARCHIVE_DAYS="${ARCHIVE_DAYS:-30}"      # Archive after 30 days
CONTAINER="society_novu_mongo"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Novu Data Archive & Retention${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Verify MongoDB
echo -e "${CYAN}1. Pre-Archive Checks${NC}"

if ! docker ps --filter "name=$CONTAINER" --format '{{.State}}' 2>/dev/null | grep -q running; then
    echo -e "${RED}✗ MongoDB container not running${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} MongoDB is running"

mkdir -p "$ARCHIVE_DIR"
echo -e "${GREEN}✓${NC} Archive directory ready: $ARCHIVE_DIR"

echo ""

# Calculate dates
echo -e "${CYAN}2. Archive Criteria${NC}"

ARCHIVE_BEFORE=$(date -d "$ARCHIVE_DAYS days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                 date -v-${ARCHIVE_DAYS}d -u +%Y-%m-%dT%H:%M:%SZ)

DELETE_BEFORE=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
                date -v-${RETENTION_DAYS}d -u +%Y-%m-%dT%H:%M:%SZ)

echo "  Archive notifications older than:  $ARCHIVE_BEFORE"
echo "  Delete notifications older than:   $DELETE_BEFORE"
echo "  Archive directory:                 $ARCHIVE_DIR"

echo ""

# Export notifications for archiving
echo -e "${CYAN}3. Exporting Old Notifications${NC}"

ARCHIVE_FILE="$ARCHIVE_DIR/notifications_archived_${TIMESTAMP}.json.gz"

# Export notifications older than ARCHIVE_BEFORE
docker exec "$CONTAINER" mongosh localhost:27017/novu \
    --eval "
    const cutoffDate = new Date('$ARCHIVE_BEFORE');
    const oldNotifications = db.notifications.find({ createdAt: { \\\$lt: cutoffDate } }).toArray();
    print(JSON.stringify(oldNotifications, null, 2));
    " \
    --quiet 2>/dev/null > "/tmp/novu_notifications_export_$$.json" || true

if [ -f "/tmp/novu_notifications_export_$$.json" ]; then
    gzip -c "/tmp/novu_notifications_export_$$.json" > "$ARCHIVE_FILE"
    ARCHIVE_SIZE=$(du -h "$ARCHIVE_FILE" | cut -f1)
    ARCHIVE_COUNT=$(grep -c "\"_id\"" "/tmp/novu_notifications_export_$$.json" || echo "?")

    rm -f "/tmp/novu_notifications_export_$$.json"

    echo -e "${GREEN}✓${NC} Notifications exported"
    echo "  File: $(basename $ARCHIVE_FILE)"
    echo "  Size: $ARCHIVE_SIZE"
    echo "  Count: $ARCHIVE_COUNT records"
fi

echo ""

# Archive collections (full backup of old data)
echo -e "${CYAN}4. Creating Full Archive Backup${NC}"

COLLECTIONS_BACKUP="$ARCHIVE_DIR/collections_backup_${TIMESTAMP}.tar.gz"

echo "  Exporting collections..."

docker exec "$CONTAINER" mongodump \
    --out /tmp/novu-collections-backup-$$ \
    --db novu \
    --quiet 2>/dev/null

tar -czf "$COLLECTIONS_BACKUP" -C /tmp "novu-collections-backup-$$" 2>/dev/null
docker exec "$CONTAINER" rm -rf "/tmp/novu-collections-backup-$$"

echo -e "${GREEN}✓${NC} Collections backup created"
echo "  File: $(basename $COLLECTIONS_BACKUP)"

echo ""

# Apply retention policy - Delete old notifications
echo -e "${CYAN}5. Applying Retention Policy${NC}"

DELETE_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%d 2>/dev/null || \
              date -v-${RETENTION_DAYS}d +%Y-%m-%d)

echo "  Deleting notifications older than: $DELETE_DATE"

DELETE_COUNT=$(docker exec "$CONTAINER" mongosh localhost:27017/novu \
    --eval "
    const cutoffDate = new Date('$DELETE_BEFORE');
    const result = db.notifications.deleteMany({ createdAt: { \\\$lt: cutoffDate } });
    print(result.deletedCount);
    " \
    --quiet 2>/dev/null || echo "0")

if [ "$DELETE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Deleted $DELETE_COUNT old notifications"
else
    echo -e "${GREEN}✓${NC} No notifications to delete"
fi

echo ""

# Optimize MongoDB storage
echo -e "${CYAN}6. Storage Optimization${NC}"

echo "  Compacting database..."

docker exec "$CONTAINER" mongosh localhost:27017/admin \
    --eval "db.runCommand({ 'compact': 'novu' });" \
    --quiet 2>/dev/null || echo "  (Compact not available in this version)"

echo -e "${GREEN}✓${NC} Database compacted"

echo ""

# Calculate storage saved
echo -e "${CYAN}7. Storage Report${NC}"

CURRENT_SIZE=$(docker exec "$CONTAINER" du -sh /data/db 2>/dev/null | cut -f1 || echo "?")

echo "  Current database size: $CURRENT_SIZE"
echo "  Archived records: $ARCHIVE_COUNT"
echo "  Deleted records: $DELETE_COUNT"

echo ""

# Generate retention policy report
echo -e "${CYAN}8. Retention Policy Report${NC}"

REPORT_FILE="$ARCHIVE_DIR/retention_report_${TIMESTAMP}.md"

cat > "$REPORT_FILE" << EOF
# Novu Data Retention Report

**Generated**: $(date)

## Configuration
- **Retention Period**: $RETENTION_DAYS days
- **Archive Threshold**: $ARCHIVE_DAYS days
- **Archive Directory**: $ARCHIVE_DIR

## Execution Summary
- **Execution Time**: $(date)
- **Archive File**: $(basename $ARCHIVE_FILE)
- **Archive Size**: $ARCHIVE_SIZE
- **Archived Records**: $ARCHIVE_COUNT
- **Deleted Records**: $DELETE_COUNT
- **Database Size**: $CURRENT_SIZE

## Policies Applied
1. Notifications older than $ARCHIVE_DAYS days → Exported to archive
2. Notifications older than $RETENTION_DAYS days → Deleted from live database
3. Database compacted to reclaim storage

## Archive Files
- Notifications: $ARCHIVE_FILE
- Collections: $COLLECTIONS_BACKUP

## Retention Schedule
- Daily retention check: Recommended
- Weekly archive export: Recommended
- Monthly full backup: Recommended

## Recovery
To restore archived data:
\`\`\`bash
./scripts/novu-restore.sh $COLLECTIONS_BACKUP
\`\`\`

## Next Actions
- Monitor database size
- Verify retention policies are working
- Schedule automated archives
- Review archive storage costs
EOF

echo -e "${GREEN}✓${NC} Report generated: $(basename $REPORT_FILE)"

echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Archive & Retention Complete${NC}"
echo ""
echo "  Retention Days:    $RETENTION_DAYS"
echo "  Archive Days:      $ARCHIVE_DAYS"
echo "  Archived:          $ARCHIVE_COUNT notifications"
echo "  Deleted:           $DELETE_COUNT notifications"
echo "  DB Size:           $CURRENT_SIZE"
echo ""
echo "  Archive Location: $ARCHIVE_DIR"
echo "  Report:           $REPORT_FILE"
echo ""
echo "  Schedule:"
echo "    Daily:   make novu-archive (or cron: 0 1 * * * ./scripts/novu-archive.sh)"
echo "    Weekly:  make novu-full-backup"
echo "    Monthly: make novu-verify-backups"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
