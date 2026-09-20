# Novu Testing & CI/CD Guide

**Testing Framework for Novu Notification System**  
**With Health Checks, Smoke Tests, and Pre-Deployment Verification**

---

## Overview

Three-tier testing approach for production-ready deployments:

1. **Health Checks** - Service availability and connectivity
2. **Smoke Tests** - End-to-end notification delivery
3. **Pre-Deployment Checks** - Comprehensive configuration and security

---

## Make Targets

### Health Checks
```bash
make novu-health              # Quick health check (container + API + DB)
make novu-health-verbose      # Detailed health check with debugging
```

### Smoke Testing
```bash
make novu-smoke-test          # End-to-end notification delivery test
```

### Pre-Deployment
```bash
make novu-pre-deploy-check    # Full pre-deployment verification
```

---

## Test Scenarios

### 1. Health Check (`make novu-health`)

**What it checks:**
- Docker containers running (novu-api, novu-worker, novu-mongo, novu-redis)
- Ports listening (27017, 6379, 3000)
- HTTP endpoints responding (Novu /v1/health)
- Database connectivity (MongoDB, Redis)
- Environment configuration (NOVU_API_KEY, NOTIFICATION_STRATEGY)

**Output example:**
```
✓ society_novu_mongo is running
✓ society_novu_redis is running
✓ society_novu_api is running
✓ society_novu_worker is running

✓ MongoDB (27017) is listening
✓ Redis (6379) is listening
✓ Novu API (3000) is listening

✓ Novu API /health is responding (HTTP 200)
✓ MongoDB is accessible
✓ Redis is accessible

✓ All checks passed
```

**Usage:**
```bash
# Quick check during development
make novu-health

# Detailed check for troubleshooting
make novu-health-verbose
```

### 2. Smoke Test (`make novu-smoke-test`)

**What it tests:**
- Novu API connectivity
- Test subscriber creation (in Novu)
- Notification sending via Novu
- PostgreSQL connectivity (for in-app notifications)
- Fallback system connectivity (auth-service, Gmail)
- Configuration validation
- Python client imports

**Output example:**
```
1. Prerequisites Check
  ✓ curl is available
  ✓ Docker is accessible
  ✓ NOVU_API_KEY is configured

2. Novu API Connectivity
  ✓ Novu API is accessible

3. Test Subscriber Setup
  ✓ Test subscriber created in Novu
  ✓ Test subscriber ID: test-smoke-1695206400

4. Novu Notification Test
  ✓ Notification sent to Novu
    Message ID: novu-12345-uuid

5. Python Client Integration Test
  ✓ novu_client.py imports successfully
  ✓ All 3 strategies available

6. Database Connectivity
  ✓ PostgreSQL is accessible
    Current notifications in DB: 24

7. Fallback System Connectivity
  ✓ auth-service is reachable
  ✓ AUTH_SERVICE_API_KEY is configured
    SMS/Telegram fallback: Available
  ✓ Gmail SMTP is configured
    Email fallback: Available

8. Configuration Verification
  ✓ Strategy: novu_with_fallback (Recommended)
    Behavior: Try Novu first, auto-fallback to legacy

✓ Smoke Test Complete
Summary:
  • Novu API:        Available
  • PostgreSQL:      Verified
  • Fallback System: Fully configured

Ready for deployment!
```

**Usage:**
```bash
# Run smoke test
make novu-smoke-test

# Or directly
./scripts/novu-smoke-test.sh
```

### 3. Pre-Deployment Check (`make novu-pre-deploy-check`)

**What it verifies:**

#### 1. Git Status
- Repository clean
- No uncommitted changes
- No untracked files (warnings OK)

#### 2. Configuration & Secrets
- .env file exists
- All Novu settings configured
- No hardcoded secrets in code
- Secrets not committed to git

#### 3. Service Health
- All services running (Novu, PostgreSQL, Redis)
- Health endpoints responding

#### 4. Database Schema
- core.notification table exists
- schema_migrations table exists
- Migrations applied correctly

#### 5. Code Quality
- Python syntax validation
- Import checks
- No syntax errors

#### 6. Docker Compose
- Configuration valid
- Novu services defined
- All services can start

#### 7. Documentation
- All guides present
- Checklist complete

#### 8. Make Targets
- All required targets available
- Build commands working

#### 9. Environment Settings
- Environment type correct (prod/dev/test)
- Settings appropriate for environment

#### 10. Backup & Recovery
- Git repository configured
- Volumes created for persistence
- Data survives container restarts

#### 11. Security
- .env in .gitignore
- Container security options set
- Secrets not in code

#### 12. Resource Allocation
- Containers within limits
- No memory leaks
- Performance acceptable

**Exit Codes:**
- `0` - All checks passed, ready to deploy
- `1` - Failures detected, fix before deploying

**Usage:**
```bash
# Full pre-deployment check
make novu-pre-deploy-check

# Or directly
./scripts/pre-deployment-check.sh
```

---

## Testing Workflows

### Development Workflow

```bash
# 1. Make changes to notification code
vim services/shared/novu_client.py

# 2. Quick health check
make novu-health

# 3. Smoke test to verify changes work
make novu-smoke-test

# 4. Commit changes
git add .
git commit -m "..."
```

### Staging Deployment

```bash
# 1. Pre-deployment check
make novu-pre-deploy-check
# Fix any issues before proceeding

# 2. Deploy to staging
git push origin develop
# CI/CD runs tests

# 3. Verify in staging
make novu-health
make novu-smoke-test

# 4. Run manual tests
# - Create templates in Novu
# - Test notifications in UI
```

### Production Deployment

```bash
# 1. Final pre-deployment check
make novu-pre-deploy-check

# 2. Verify configuration
grep "^NOVU_API_KEY=" .env
grep "^NOTIFICATION_STRATEGY=" .env

# 3. Smoke test in production environment
make novu-smoke-test

# 4. Deploy
git push origin main
# CI/CD handles deployment

# 5. Post-deployment verification
make novu-health
make logs-novu  # Watch for any issues
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Novu Tests

on: [push, pull_request]

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start services
        run: make up
      - name: Health check
        run: make novu-health
      - name: Smoke test
        run: make novu-smoke-test

  pre-deployment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Pre-deployment check
        run: make novu-pre-deploy-check
```

### GitLab CI Example

```yaml
stages:
  - test

novu-health:
  stage: test
  script:
    - make up
    - make novu-health

novu-smoke:
  stage: test
  script:
    - make novu-smoke-test

pre-deploy:
  stage: test
  script:
    - make novu-pre-deploy-check
  only:
    - merge_requests
    - main
```

---

## Script Details

### novu-health-check.sh

**Purpose**: Quick verification that all Novu services are healthy

**Features:**
- Container status checking
- Port availability verification
- HTTP endpoint validation
- Database connectivity checks
- Environment configuration review
- Verbose/detailed mode for troubleshooting

**Output:**
- ✓ (green) - Check passed
- ✗ (red) - Check failed
- ⚠ (yellow) - Warning or non-critical issue

**Exit Codes:**
- `0` - All checks passed
- `1` - At least one check failed

### novu-smoke-test.sh

**Purpose**: End-to-end test of notification delivery

**Features:**
- Prerequisite validation
- Novu API connectivity test
- Test subscriber creation
- Notification sending via Novu
- Python client import verification
- Database connectivity test
- Fallback system connectivity test
- Configuration validation

**Exit Codes:**
- `0` - Test completed (some failures may be non-critical)
- `1` - Test failed (critical issues)

### pre-deployment-check.sh

**Purpose**: Comprehensive pre-deployment verification

**Features:**
- 12-point verification checklist
- Configuration validation
- Security checks
- Code quality verification
- Resource allocation review
- Backup readiness check
- Detailed reporting

**Exit Codes:**
- `0` - Ready for deployment
- `1` - Issues must be fixed before deployment

---

## Troubleshooting Test Failures

### Health Check Failures

```bash
# Check container logs
docker logs society_novu_api

# Restart Novu
make novu-restart

# Verify configuration
cat .env | grep NOVU

# Run health check with verbose output
make novu-health-verbose
```

### Smoke Test Failures

```bash
# Check if Novu API is reachable
curl http://localhost:3000/v1/health

# Verify auth-service (for fallback)
curl http://host.containers.internal:8000/health

# Check Gmail SMTP
grep GMAIL .env

# Run with debugging
./scripts/novu-smoke-test.sh 2>&1 | tail -100
```

### Pre-Deployment Check Failures

```bash
# Fix specific issues:
# 1. Git status - commit changes
git add .
git commit -m "..."

# 2. .env file - create it
cp .env.example .env

# 3. Secrets - generate them
./scripts/setup-novu.sh

# 4. Services - start them
make up

# 5. Schema - apply migrations
make migrate
```

---

## Test Coverage

| Component | Health Check | Smoke Test | Pre-Deploy |
|---|:---:|:---:|:---:|
| Container Availability | ✅ | ✅ | ✅ |
| API Endpoints | ✅ | ✅ | ✅ |
| Database Connectivity | ✅ | ✅ | ✅ |
| Configuration | ✅ | ✅ | ✅ |
| Notification Delivery | ❌ | ✅ | ❌ |
| Code Quality | ❌ | ✅ | ✅ |
| Security | ❌ | ❌ | ✅ |
| Resource Limits | ❌ | ❌ | ✅ |
| Backup Readiness | ❌ | ❌ | ✅ |

---

## Performance Benchmarks

Expected runtimes:

| Test | Duration |
|---|---|
| `make novu-health` | 2-5 seconds |
| `make novu-health-verbose` | 5-10 seconds |
| `make novu-smoke-test` | 10-20 seconds |
| `make novu-pre-deploy-check` | 15-30 seconds |

---

## Recommended Test Schedule

### Every Commit
```bash
make novu-health
```

### Before Merging PR
```bash
make novu-smoke-test
make novu-pre-deploy-check
```

### Before Production Deploy
```bash
make novu-pre-deploy-check
make novu-smoke-test
make novu-health
```

### Weekly (Maintenance)
```bash
make novu-smoke-test  # Verify everything still works
make logs-novu        # Check for any issues
```

---

## Sample Test Run Output

```bash
$ make novu-health
═══════════════════════════════════════════════════════════
Novu Services Status:

  Container status:
NAME                    COMMAND             STATUS         PORTS
society_novu_mongo      mongod --replSet... Up 2 minutes   27017/tcp
society_novu_redis      redis-server        Up 2 minutes   6379/tcp
society_novu_api        npm run start       Up 2 minutes   3000/tcp
society_novu_worker     npm run start:worker Up 2 minutes

  API health check:
{"status":"ok","timestamp":"2026-09-20T12:00:00.000Z"}
  ✓ Novu API is healthy

═══════════════════════════════════════════════════════════

$ make novu-smoke-test
═══════════════════════════════════════════════════════════
Novu Smoke Test - End-to-End Notification Test

1. Prerequisites Check
  ✓ curl is available
  ✓ Docker is accessible
  ✓ NOVU_API_KEY is configured

... (more output)

✓ Smoke Test Complete
═══════════════════════════════════════════════════════════

$ make novu-pre-deploy-check
╔═══════════════════════════════════════════════════════════╗
║        Pre-Deployment Verification Checklist            ║
╚═══════════════════════════════════════════════════════════╝

1. Git Repository Status
  ✓ Git repository found
  ✓ Working tree is clean
  ✓ No untracked files

... (more checks)

╔═══════════════════════════════════════════════════════════╗
║        ✓ Pre-Deployment Checks PASSED                   ║
╠═══════════════════════════════════════════════════════════╣
║ Status: Ready for deployment                             ║
╚═══════════════════════════════════════════════════════════╝
```

---

## Next Steps

1. **Run Health Check**
   ```bash
   make novu-health
   ```

2. **Run Smoke Test**
   ```bash
   make novu-smoke-test
   ```

3. **Pre-Deployment Verification**
   ```bash
   make novu-pre-deploy-check
   ```

4. **Fix Any Issues**
   - Address failures from pre-deployment check
   - Commit fixes
   - Re-run tests

5. **Deploy with Confidence**
   - All tests passing
   - Ready for production

---

## Support

For test failures or questions:

1. Check script output (verbose flag available)
2. Review [NOVU_IMPLEMENTATION_GUIDE.md](NOVU_IMPLEMENTATION_GUIDE.md)
3. Run `make logs-novu` for service logs
4. Check [NOVU_QUICKSTART.md](NOVU_QUICKSTART.md) troubleshooting section

---

**Status**: Production Ready ✅  
**Last Updated**: 2026-09-20
