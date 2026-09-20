# Novu Data Management & Backup Strategy

**Complete backup, restore, archive, and retention procedures for Novu MongoDB**

---

## Overview

Comprehensive data protection strategy including:
- **Full & Incremental Backups** - Daily and weekly
- **Automated Archives** - Separate old data for compliance
- **Retention Policies** - Automatic cleanup of old data
- **Disaster Recovery** - Fast restore procedures
- **Compliance** - GDPR-compliant data handling

---

## Architecture

```
Live Data (90 days)
    ↓
Archive (30+ days)
    ↓
Long-term Storage (backup)
    ↓
Deletion (compliance)
```

---

## Backup Strategy

### Full Backups
- **Frequency**: Weekly (Sunday at 1 AM)
- **Retention**: 6 months
- **Type**: Complete MongoDB dump
- **Compression**: gzip
- **Verification**: SHA256 checksum

### Incremental Backups
- **Frequency**: Daily (midnight)
- **Retention**: 30 days
- **Type**: Changes since last full backup
- **Size**: ~10-20% of full backup

### Make Targets

```bash
# Manual backups
make novu-backup-full              # Create full backup now
make novu-backup-incremental       # Create incremental backup

# Scheduled backups
make novu-backup-schedule          # Setup automated backups
make novu-backup-status            # Check backup health

# Restore
make novu-restore                  # Restore latest backup
make novu-restore-from <file>      # Restore specific backup

# Listing & management
make novu-backups-list             # List all backups
make novu-backups-verify           # Verify all backups
make novu-backups-cleanup          # Remove old backups
```

---

## Backup Procedures

### Creating a Full Backup

```bash
# Manual full backup
./scripts/novu-backup.sh full

# Output:
# ✓ Full backup created
# File: novu_full_20260920_143022.tar.gz
# Size: 245MB

# Location: ./backups/novu/full/
```

### Creating an Incremental Backup

```bash
# Incremental (changes only)
./scripts/novu-backup.sh incremental

# Output:
# ✓ Incremental backup created
# File: novu_incremental_20260920_143022.tar.gz
# Size: 12MB
```

### Automated Scheduled Backups

```bash
# Add to system crontab or use Make scheduling
make novu-backup-schedule

# This sets up:
# - Daily incremental backups at midnight
# - Weekly full backups on Sunday at 1 AM
# - Automatic retention cleanup

# Verify scheduling
make novu-backup-schedule-status
```

### Backup File Structure

```
backups/novu/
├── full/
│   ├── novu_full_20260915_010000.tar.gz
│   ├── novu_full_20260908_010000.tar.gz
│   └── ... (older backups)
├── incremental/
│   ├── novu_incremental_20260920_000000.tar.gz
│   ├── novu_incremental_20260919_000000.tar.gz
│   └── ... (older backups)
└── metadata/
    ├── novu_20260920_143022.json
    ├── novu_20260919_143022.json
    └── ... (backup metadata)
```

---

## Restore Procedures

### Quick Restore (Latest Backup)

```bash
make novu-restore

# Prompts to confirm, then:
# 1. Creates safety backup
# 2. Extracts backup file
# 3. Restores to MongoDB
# 4. Verifies restoration
```

### Restore from Specific File

```bash
./scripts/novu-restore.sh ./backups/novu/full/novu_full_20260915_010000.tar.gz

# Options:
./scripts/novu-restore.sh <backup-file> --drop-existing

# --drop-existing: Drop current database before restore
# (Without flag: overwrites existing collections)
```

### Restore Workflow

```
1. Pre-Restore Checks
   ✓ MongoDB running
   ✓ Backup file exists
   ✓ Backup integrity verified

2. Safety Backup
   ✓ Current data backed up to /tmp/
   (Can be used for rollback)

3. Restore
   ✓ Database restored from backup
   ✓ Data verified
   ✓ Document count checked

4. Verification
   ✓ Collections count
   ✓ Document count
   ✓ Indexes rebuilt

5. Rollback Ready
   Can restore safety backup if needed
```

### Point-in-Time Recovery

```bash
# Restore from specific date
make novu-restore-from 2026-09-15

# Automatically finds backup from that day
# Uses exact time or nearest available backup
```

---

## Archive Strategy

### Archive Process

```bash
make novu-archive

# Executes:
# 1. Exports notifications older than 30 days
# 2. Creates full collections backup
# 3. Deletes notifications older than 90 days
# 4. Optimizes database storage
# 5. Generates compliance report
```

### Archive Configuration

Edit `monitoring/retention-policy.yaml`:

```yaml
retention_policy:
  default_retention_days: 90      # Keep live 90 days
  archive_threshold_days: 30      # Archive after 30 days
  
  collections:
    notifications:
      retention_days: 90
      archive_after_days: 30
      priority: high
```

### Archive File Locations

```
archives/novu/
├── notifications_archived_20260920_143022.json.gz
├── collections_backup_20260920_143022.tar.gz
└── retention_report_20260920_143022.md
```

---

## Retention Policies

### Default Configuration

| Data Type | Live Keep | Archive Keep | Auto-Delete |
|---|---|---|---|
| Notifications | 90 days | 6 months | After 6 months |
| Messages | 60 days | 1 year | After 1 year |
| Audit Logs | 365 days | Forever | Never |
| Subscribers | Forever | Forever | Never |
| Templates | Forever | Forever | Never |
| API Keys | Forever | Forever | Never |

### Compliance Settings

```yaml
compliance:
  gdpr_right_to_deletion: true    # Support GDPR requests
  legal_hold_enabled: true         # Preserve for litigation
  data_residency: required         # Keep in region
  compliance_retention_override: true  # Legal holds override policy
```

### Storage Monitoring

```bash
# Check storage usage
make novu-storage-usage

# Output:
# Database:        1.2 GB / 10 GB (12%)
# Backups:         2.4 GB / 20 GB (12%)
# Archives:        500 MB / 100 GB (0.5%)
# Total:           4.1 GB / 130 GB (3%)
```

---

## Automated Maintenance

### Scheduled Tasks

```bash
# Daily (2 AM): Archive old data
0 2 * * * cd /app && ./scripts/novu-archive.sh

# Nightly (12 AM): Incremental backup
0 0 * * * cd /app && ./scripts/novu-backup.sh incremental

# Weekly (1 AM Sunday): Full backup
0 1 * * 0 cd /app && ./scripts/novu-backup.sh full

# Monthly (3 AM on 1st): Compliance check
0 3 1 * * cd /app && make novu-compliance-check
```

### Make Targets for Scheduling

```bash
# Setup automated tasks
make novu-backup-schedule

# View schedule
make novu-backup-schedule-status

# Enable/disable
make novu-backup-enable
make novu-backup-disable

# Manual trigger
make novu-archive              # Run archive now
make novu-backup-full          # Run full backup now
make novu-cleanup              # Run cleanup now
```

---

## Recovery Scenarios

### Scenario 1: Accidental Data Deletion

```bash
# 1. Identify what was deleted
make novu-backup-list

# 2. Find nearest backup after deletion
# Example: Data deleted today morning, nearest backup 2 hours old

# 3. Restore from that point
./scripts/novu-restore.sh ./backups/novu/full/novu_full_20260920_010000.tar.gz

# 4. Merge changes if needed
# Manual process: extract new data, merge with restored data
```

### Scenario 2: Database Corruption

```bash
# 1. Verify corruption
make novu-health

# 2. Check backup integrity
make novu-backups-verify

# 3. Restore latest good backup
make novu-restore

# 4. Verify data
make novu-verify-restore
```

### Scenario 3: Complete Disaster (Lost All Data)

```bash
# 1. Bring up new MongoDB
docker-compose up -d novu-mongo

# 2. Wait for initialization
sleep 10

# 3. Restore latest backup
make novu-restore

# 4. Verify completeness
docker exec society_novu_mongo mongosh localhost:27017/novu \
  --eval "db.stats()"
```

### Scenario 4: Large Data Loss (Days Missing)

```bash
# 1. Restore from archive + incremental backups
# Find date to restore from
ls -lh ./backups/novu/full/

# 2. Restore to temporary location
docker run --name novu-temp -d mongo:latest

# 3. Restore backup to temp
./scripts/novu-restore.sh ./backups/novu/full/... 

# 4. Merge data carefully
# Copy only missing data back to live database
```

---

## Disaster Recovery Plan (DRP)

### RTO & RPO

```
RTO (Recovery Time Objective):     1 hour
  - Full restore + verification: 30 min
  - Data merge & testing: 30 min

RPO (Recovery Point Objective):    1 day
  - Nightly incremental backups
  - Maximum 24 hours of data loss
```

### Failover Procedure

```
1. Detect failure (5 min)
   - Monitoring alert
   - Manual detection

2. Assess damage (5 min)
   - Determine what data is lost
   - Find appropriate backup

3. Prepare restore (10 min)
   - Verify backup integrity
   - Prepare new MongoDB instance

4. Execute restore (15 min)
   - Restore backup
   - Verify data integrity

5. Switch traffic (5 min)
   - Update connection strings
   - Health check
   - Monitor

6. Post-incident (ongoing)
   - Document what happened
   - Review logs
   - Improve procedures

Total time: ~40 minutes
```

---

## Compliance & Auditing

### GDPR Compliance

```bash
# Export user data (GDPR Article 20)
make novu-export-user-data <user-id>

# Delete user data (GDPR Article 17 - Right to be Forgotten)
make novu-delete-user-data <user-id>

# Both generate audit log entries
```

### Data Audit Trail

```bash
# View all data operations
make novu-audit-log

# Backup/restore operations
make novu-audit-backups

# Archive operations
make novu-audit-archives

# Deletion operations
make novu-audit-deletions
```

### Compliance Reports

```bash
# Generate compliance report
make novu-compliance-report

# Output includes:
# - Retention policy compliance
# - Backup success rates
# - Archive completeness
# - Legal hold status
# - GDPR readiness
```

---

## Testing & Verification

### Backup Integrity Tests

```bash
# Test all backups
make novu-backups-verify

# Checks:
# ✓ File integrity (tar)
# ✓ Compression validity
# ✓ Metadata completeness
# ✓ Extraction success
```

### Restore Tests

```bash
# Test restore process (to temp database)
make novu-restore-test

# Does NOT affect live database
# Creates temporary MongoDB container
# Verifies restore process works
# Cleans up test environment
```

### Full Disaster Recovery Test

```bash
# Annual DRP test
make novu-drp-test

# Steps:
# 1. Start from scratch
# 2. Deploy new MongoDB
# 3. Restore backup
# 4. Verify all data
# 5. Test connectivity
# 6. Document results
# 7. Cleanup

# Duration: ~1 hour
# Should be done quarterly
```

---

## Monitoring & Alerting

### Backup Health

```bash
make novu-backup-health

# Shows:
# ✓ Last backup time
# ✓ Backup size
# ✓ Storage available
# ✓ Next scheduled backup
# ✓ Retention compliance
```

### Alerts

```
⚠️  Backup failed
   Action: Retry, check logs, escalate if persists

⚠️  Storage nearly full (80%)
   Action: Archive old data, expand storage

⚠️  Restore test failed
   Action: Verify backup integrity, check MongoDB
```

---

## Best Practices

1. **Test restores regularly** - Backups are only good if restores work
2. **Monitor storage** - Don't run out of disk space
3. **Keep backups offsite** - Encrypt and copy to cloud/separate location
4. **Document procedures** - Team members need to know how to restore
5. **Track compliance** - Regular audits and reports
6. **Rotate credentials** - Change backup encryption keys periodically
7. **Verify checksums** - Ensure backups aren't corrupted
8. **Plan for scale** - Backup size grows with data volume

---

## Troubleshooting

### Backup Creation Fails

```bash
# Check MongoDB is running
docker ps | grep novu_mongo

# Check disk space
df -h

# Check MongoDB logs
make logs-novu | grep -i error

# Manually trigger backup with verbose output
./scripts/novu-backup.sh full 2>&1 | head -50
```

### Restore Fails

```bash
# Verify backup file integrity
tar -tzf backup_file.tar.gz | head -20

# Check MongoDB is running
docker ps | grep novu_mongo

# Try restore with verbose output
./scripts/novu-restore.sh backup_file.tar.gz 2>&1 | head -50

# Check safety backup was created
ls -lh /tmp/novu_safety_backup_*
```

### Storage Issues

```bash
# Check database size
docker exec society_novu_mongo du -sh /data/db

# Check backup size
du -sh ./backups/novu/

# Archive old data to free space
make novu-archive

# Compact database
docker exec society_novu_mongo mongosh localhost:27017/admin \
  --eval "db.runCommand({ 'compact': 'novu' })"
```

---

## Make Targets Summary

```bash
# Backup operations
make novu-backup-full               # Create full backup
make novu-backup-incremental        # Create incremental backup
make novu-backup-schedule           # Setup automated backups
make novu-backups-list              # List all backups
make novu-backups-verify            # Verify backup integrity
make novu-backups-cleanup           # Remove old backups
make novu-backup-health             # Check backup status

# Restore operations
make novu-restore                   # Restore latest backup
make novu-restore-from <file>       # Restore specific file
make novu-restore-test              # Test restore (temp DB)

# Archive operations
make novu-archive                   # Run archival
make novu-archives-list             # List archived files
make novu-archives-export           # Export archive data

# Maintenance
make novu-cleanup                   # Cleanup old data
make novu-storage-usage             # Check storage
make novu-storage-report            # Detailed report
make novu-compliance-check          # Compliance audit
make novu-compliance-report         # Generate report

# Disaster recovery
make novu-drp-test                  # Full DRP test
make novu-drp-status                # DRP status
```

---

**Status**: Production Ready ✅  
**Last Updated**: 2026-09-20
