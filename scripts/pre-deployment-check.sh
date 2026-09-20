#!/bin/bash
# Pre-Deployment Verification - Comprehensive checks before production deployment
# Verifies: code quality, configuration, health, security, capacity

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

FAILED=0
WARNINGS=0

echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        Pre-Deployment Verification Checklist            ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Helper functions
pass() {
    echo -e "  ${GREEN}✓${NC} $1"
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    FAILED=$((FAILED + 1))
}

warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
    WARNINGS=$((WARNINGS + 1))
}

# 1. Git Status Check
echo -e "${CYAN}1. Git Repository Status${NC}"

if git rev-parse --git-dir > /dev/null 2>&1; then
    pass "Git repository found"

    if [ -z "$(git status --porcelain)" ]; then
        pass "Working tree is clean"
    else
        warn "Uncommitted changes detected:"
        git status --short | sed 's/^/    /'
    fi

    # Check for untracked files
    if [ -z "$(git ls-files --others --exclude-standard)" ]; then
        pass "No untracked files"
    else
        warn "Untracked files detected:"
        git ls-files --others --exclude-standard | head -5 | sed 's/^/    /'
    fi
else
    fail "Not a git repository"
fi
echo ""

# 2. Configuration Check
echo -e "${CYAN}2. Configuration & Secrets${NC}"

if [ -f ".env" ]; then
    pass ".env file exists"
else
    fail ".env file not found"
fi

if grep -q "^NOVU_API_KEY=[^[:space:]]" .env 2>/dev/null; then
    pass "NOVU_API_KEY is configured"
else
    warn "NOVU_API_KEY not set (OK for testing, required for production)"
fi

if grep -q "^NOVU_JWT_SECRET=[^[:space:]]" .env 2>/dev/null; then
    pass "NOVU_JWT_SECRET is configured"
else
    warn "NOVU_JWT_SECRET not set (auto-generated if missing)"
fi

if grep -q "^NOVU_ENCRYPTION_KEY=[^[:space:]]" .env 2>/dev/null; then
    pass "NOVU_ENCRYPTION_KEY is configured"
else
    warn "NOVU_ENCRYPTION_KEY not set (auto-generated if missing)"
fi

if grep -q "^NOTIFICATION_STRATEGY=" .env 2>/dev/null; then
    strategy=$(grep "^NOTIFICATION_STRATEGY=" .env | cut -d= -f2)
    pass "NOTIFICATION_STRATEGY is set to: $strategy"
else
    warn "NOTIFICATION_STRATEGY not set (default: novu_with_fallback)"
fi

# Check for hardcoded secrets in code
if git grep -l -i "password\|secret\|apikey" 2>/dev/null | grep -v ".env\|.env.example\|\.md" | grep -q .; then
    warn "Potential hardcoded secrets found in code:"
    git grep -l -i "password\|secret\|apikey" | grep -v ".env\|.env.example\|\.md" | head -3 | sed 's/^/    /'
fi

echo ""

# 3. Service Health Check
echo -e "${CYAN}3. Service Health Status${NC}"

if docker ps --filter "name=society_novu_api" --format '{{.State}}' 2>/dev/null | grep -q running; then
    pass "Novu API is running"
else
    warn "Novu API is not running"
fi

if docker ps --filter "name=society_postgres" --format '{{.State}}' 2>/dev/null | grep -q running; then
    pass "PostgreSQL is running"
else
    warn "PostgreSQL is not running"
fi

if docker ps --filter "name=society_redis" --format '{{.State}}' 2>/dev/null | grep -q running; then
    pass "Redis is running"
else
    warn "Redis is not running"
fi

echo ""

# 4. Database Checks
echo -e "${CYAN}4. Database Schema Verification${NC}"

if docker exec -T society_postgres psql -U "$(grep '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2)" -d society_events -c "SELECT to_regclass('core.notification');" >/dev/null 2>&1; then
    pass "core.notification table exists"
else
    fail "core.notification table not found"
fi

# Check schema version
if docker exec -T society_postgres psql -U "$(grep '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2)" -d society_events -c "SELECT COUNT(*) FROM schema_migrations;" >/dev/null 2>&1; then
    count=$(docker exec -T society_postgres psql -U "$(grep '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2)" -d society_events -t -c "SELECT COUNT(*) FROM schema_migrations;" 2>/dev/null || echo "?")
    pass "Schema migrations table found ($count migrations)"
else
    warn "Schema migrations table not found"
fi

echo ""

# 5. Code Quality Checks
echo -e "${CYAN}5. Code Quality${NC}"

# Python syntax check
if python3 -m py_compile services/shared/novu_client.py 2>/dev/null; then
    pass "novu_client.py syntax OK"
else
    fail "novu_client.py has syntax errors"
fi

if python3 -m py_compile services/shared/novu_notifications.py 2>/dev/null; then
    pass "novu_notifications.py syntax OK"
else
    fail "novu_notifications.py has syntax errors"
fi

# Check imports
python3 -c "from services.shared.novu_client import get_novu_client, NotificationStrategy" 2>/dev/null && \
    pass "All imports work correctly" || \
    fail "Import errors detected"

echo ""

# 6. Docker Compose Validation
echo -e "${CYAN}6. Docker Compose Configuration${NC}"

if docker compose config -q 2>/dev/null; then
    pass "docker-compose.yml is valid"
else
    fail "docker-compose.yml has validation errors"
fi

# Check Novu services are defined
if docker compose config 2>/dev/null | grep -q "novu-api"; then
    pass "Novu services are defined in docker-compose.yml"
else
    fail "Novu services not found in docker-compose.yml"
fi

echo ""

# 7. Documentation Check
echo -e "${CYAN}7. Documentation Completeness${NC}"

required_docs=(
    "NOVU_QUICKSTART.md"
    "NOVU_IMPLEMENTATION_GUIDE.md"
    "NOVU_MIGRATION_EXAMPLE.md"
    "NOVU_DELIVERY_CHECKLIST.md"
)

for doc in "${required_docs[@]}"; do
    if [ -f "$doc" ]; then
        pass "$doc exists"
    else
        warn "$doc not found"
    fi
done

echo ""

# 8. Make Targets Check
echo -e "${CYAN}8. Make Targets Availability${NC}"

make_targets=("novu-up" "novu-down" "novu-status" "logs-novu" "restart-payment" "restart-event-service")

for target in "${make_targets[@]}"; do
    if make -n "$target" >/dev/null 2>&1; then
        pass "make $target is available"
    else
        warn "make $target not found"
    fi
done

echo ""

# 9. Environment-Specific Checks
echo -e "${CYAN}9. Environment-Specific Settings${NC}"

current_env=${ENV:-prod}
case "$current_env" in
    prod)
        pass "Environment: Production"

        if grep -q "^VITE_MODE=prod" .env 2>/dev/null; then
            pass "VITE_MODE is set to production"
        else
            warn "VITE_MODE is not set to production"
        fi
        ;;
    dev)
        pass "Environment: Development"
        ;;
    *)
        warn "Unknown environment: $current_env"
        ;;
esac

echo ""

# 10. Backup & Recovery Checks
echo -e "${CYAN}10. Backup & Recovery Readiness${NC}"

if [ -d ".git" ]; then
    pass "Git repository can be used for code backups"
else
    warn "Not using git for version control"
fi

if docker volume ls 2>/dev/null | grep -q "novu_mongo_data"; then
    pass "MongoDB volume exists (data persists)"
else
    warn "MongoDB volume not found"
fi

if docker volume ls 2>/dev/null | grep -q "postgres_data"; then
    pass "PostgreSQL volume exists (data persists)"
else
    warn "PostgreSQL volume not found"
fi

echo ""

# 11. Security Checks
echo -e "${CYAN}11. Security Verification${NC}"

# Check for .env in .gitignore
if grep -q "^\.env" .gitignore 2>/dev/null; then
    pass ".env is in .gitignore"
else
    fail ".env is not in .gitignore (security risk!)"
fi

# Check Docker security
if docker ps --format '{{.SecurityOpt}}' 2>/dev/null | grep -q "no-new-privileges"; then
    pass "Container security options configured"
else
    warn "Container security options not fully configured"
fi

echo ""

# 12. Resource Limits Check
echo -e "${CYAN}12. Resource Allocation${NC}"

if docker stats --no-stream --format "table {{.Container}}\t{{.MemUsage}}" society_novu_api 2>/dev/null | grep -q novu_api; then
    pass "Novu API container is running"
    memory=$(docker stats --no-stream --format "{{.MemUsage}}" society_novu_api 2>/dev/null | cut -d/ -f1)
    echo "    Current memory usage: $memory"
else
    warn "Cannot get resource statistics"
fi

echo ""

# Final Summary
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════╗${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "${CYAN}║${NC}${GREEN}        ✓ Pre-Deployment Checks PASSED${NC}${CYAN}                 ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║ Status:${NC} Ready for deployment${CYAN}                            ║${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${CYAN}║ Warnings:${NC} $WARNINGS (non-critical)${CYAN}                         ║${NC}"
    fi
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${CYAN}║${NC}${RED}        ✗ Pre-Deployment Checks FAILED${NC}${CYAN}                ║${NC}"
    echo -e "${CYAN}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${CYAN}║ Failures:${NC} $FAILED (must fix before deployment)${CYAN}           ║${NC}"
    echo -e "${CYAN}║ Warnings:${NC} $WARNINGS (non-critical)${CYAN}                         ║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  • Run: ./scripts/novu-health-check.sh detailed"
    echo "  • Run: ./scripts/novu-smoke-test.sh"
    echo "  • Check: make logs-novu"
    exit 1
fi
