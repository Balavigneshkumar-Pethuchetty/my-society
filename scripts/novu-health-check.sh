#!/bin/bash
# Novu Health Check - Verify all services are running and healthy
# Usage: ./scripts/novu-health-check.sh [detailed]
#   detailed: Show additional debugging info

set -e

VERBOSE="${1:-}"
EXIT_CODE=0

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Novu Health Check${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Helper functions
check_container() {
    local container=$1
    local expected_state=${2:-running}

    if docker ps --filter "name=$container" --format '{{.State}}' 2>/dev/null | grep -q "$expected_state"; then
        echo -e "  ${GREEN}✓${NC} $container is $expected_state"
        return 0
    else
        echo -e "  ${RED}✗${NC} $container is not $expected_state"
        [ "$VERBOSE" = "detailed" ] && docker inspect "$container" 2>/dev/null | head -20
        return 1
    fi
}

check_http_endpoint() {
    local url=$1
    local expected_code=${2:-200}
    local name=${3:-$(echo $url | cut -d/ -f3)}

    if curl -sf --connect-timeout 5 -w "%{http_code}" "$url" > /tmp/health_check.txt 2>/dev/null; then
        local code=$(tail -c 3 /tmp/health_check.txt)
        if [ "$code" = "$expected_code" ]; then
            echo -e "  ${GREEN}✓${NC} $name is responding (HTTP $code)"
            return 0
        else
            echo -e "  ${YELLOW}⚠${NC} $name returned HTTP $code (expected $expected_code)"
            [ "$VERBOSE" = "detailed" ] && cat /tmp/health_check.txt
            return 1
        fi
    else
        echo -e "  ${RED}✗${NC} $name is not responding"
        return 1
    fi
}

check_port() {
    local port=$1
    local name=${2:-Port $port}

    if nc -z localhost "$port" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $name is listening"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name is not listening"
        return 1
    fi
}

# 1. Check Docker containers
echo -e "${CYAN}1. Container Status${NC}"
check_container "society_novu_mongo" "running" || EXIT_CODE=1
check_container "society_novu_redis" "running" || EXIT_CODE=1
check_container "society_novu_api" "running" || EXIT_CODE=1
check_container "society_novu_worker" "running" || EXIT_CODE=1
echo ""

# 2. Check ports
echo -e "${CYAN}2. Port Availability${NC}"
check_port 27017 "MongoDB (27017)" || EXIT_CODE=1
check_port 6379 "Redis (6379)" || EXIT_CODE=1
check_port 3000 "Novu API (3000)" || EXIT_CODE=1
echo ""

# 3. Check HTTP endpoints
echo -e "${CYAN}3. HTTP Endpoints${NC}"
check_http_endpoint "http://localhost:3000/v1/health" "200" "Novu API /health" || EXIT_CODE=1
echo ""

# 4. Check Novu API connectivity
echo -e "${CYAN}4. Novu API Details${NC}"
if curl -sf http://localhost:3000/v1/health 2>/dev/null | grep -q "ok"; then
    echo -e "  ${GREEN}✓${NC} Novu API is responding correctly"
    if [ "$VERBOSE" = "detailed" ]; then
        curl -sf http://localhost:3000/v1/health | jq '.' 2>/dev/null || echo "  (Response not JSON)"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Novu API health check did not return expected format"
    EXIT_CODE=1
fi
echo ""

# 5. Check MongoDB
echo -e "${CYAN}5. MongoDB Status${NC}"
if docker exec society_novu_mongo mongosh localhost:27017/novu --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} MongoDB is accessible"
    if [ "$VERBOSE" = "detailed" ]; then
        echo "  DB stats:"
        docker exec society_novu_mongo mongosh localhost:27017/novu --eval "db.stats()" 2>/dev/null | head -10
    fi
else
    echo -e "  ${RED}✗${NC} MongoDB is not responding"
    EXIT_CODE=1
fi
echo ""

# 6. Check Redis
echo -e "${CYAN}6. Redis Status${NC}"
if docker exec society_novu_redis redis-cli ping 2>/dev/null | grep -q PONG; then
    echo -e "  ${GREEN}✓${NC} Redis is accessible"
    if [ "$VERBOSE" = "detailed" ]; then
        echo "  Info:"
        docker exec society_novu_redis redis-cli info server | head -5
    fi
else
    echo -e "  ${RED}✗${NC} Redis is not responding"
    EXIT_CODE=1
fi
echo ""

# 7. Check environment
echo -e "${CYAN}7. Environment Configuration${NC}"
if grep -q "NOVU_API_KEY=[^[:space:]]" .env 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} NOVU_API_KEY is configured"
else
    echo -e "  ${YELLOW}⚠${NC} NOVU_API_KEY is not configured"
    echo "    (This is OK if testing without Novu; required for production)"
fi

if grep -q "NOTIFICATION_STRATEGY=" .env 2>/dev/null; then
    strategy=$(grep "NOTIFICATION_STRATEGY=" .env | cut -d= -f2)
    echo -e "  ${GREEN}✓${NC} NOTIFICATION_STRATEGY is set to: $strategy"
else
    echo -e "  ${YELLOW}⚠${NC} NOTIFICATION_STRATEGY is not configured"
fi
echo ""

# 8. Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed${NC}"
    echo ""
    echo "Novu is running and healthy!"
    echo ""
    echo "Next steps:"
    echo "  • Access dashboard: http://localhost:3000"
    echo "  • Create notification templates"
    echo "  • Get API key from Settings → API Keys"
    echo "  • Update .env with NOVU_API_KEY"
else
    echo -e "${RED}✗ Some checks failed${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  • Check: make novu-status"
    echo "  • Logs:  make logs-novu"
    echo "  • Restart: make novu-restart"
    echo ""
    if [ "$VERBOSE" != "detailed" ]; then
        echo "For more details, run:"
        echo "  ./scripts/novu-health-check.sh detailed"
    fi
fi
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"

exit $EXIT_CODE
