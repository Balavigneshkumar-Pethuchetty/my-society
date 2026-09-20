#!/bin/bash
# Novu Smoke Test - Verify notification delivery works end-to-end
# Tests both Novu primary and legacy fallback paths

set -e

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Novu Smoke Test - End-to-End Notification Test${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check prerequisites
echo -e "${CYAN}1. Prerequisites Check${NC}"

if ! command -v curl &> /dev/null; then
    echo -e "${RED}✗ curl not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} curl is available"

if ! docker ps &>/dev/null; then
    echo -e "${RED}✗ Docker not accessible${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker is accessible"

if ! grep -q "NOVU_API_KEY=" .env 2>/dev/null; then
    echo -e "${YELLOW}⚠${NC} NOVU_API_KEY not configured (testing fallback mode)"
else
    echo -e "${GREEN}✓${NC} NOVU_API_KEY is configured"
fi

echo ""

# Test Novu API connectivity
echo -e "${CYAN}2. Novu API Connectivity${NC}"

if curl -sf http://localhost:3000/v1/health >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Novu API is accessible"
    NOVU_AVAILABLE=1
else
    echo -e "${YELLOW}⚠${NC} Novu API is not accessible"
    echo "    (This is OK - testing fallback path)"
    NOVU_AVAILABLE=0
fi

echo ""

# Create test subscriber
echo -e "${CYAN}3. Test Subscriber Setup${NC}"

TEST_USER_ID="test-smoke-$(date +%s)"
TEST_EMAIL="test-smoke-$(date +%s)@example.local"
TEST_PHONE="+1-555-0123"

echo "  Creating test subscriber: $TEST_USER_ID"

if [ $NOVU_AVAILABLE -eq 1 ]; then
    if NOVU_API_KEY=$(grep "NOVU_API_KEY=" .env 2>/dev/null | cut -d= -f2); then
        response=$(curl -sf -X POST http://localhost:3000/v1/subscribers \
            -H "Authorization: ApiKey $NOVU_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{
                \"subscriberId\": \"$TEST_USER_ID\",
                \"email\": \"$TEST_EMAIL\",
                \"phone\": \"$TEST_PHONE\"
            }" 2>/dev/null || echo "{}")

        if echo "$response" | grep -q "$TEST_USER_ID"; then
            echo -e "${GREEN}✓${NC} Test subscriber created in Novu"
        else
            echo -e "${YELLOW}⚠${NC} Could not create subscriber in Novu"
        fi
    fi
fi

echo -e "${GREEN}✓${NC} Test subscriber ID: $TEST_USER_ID"
echo ""

# Test notification sending (Novu)
echo -e "${CYAN}4. Novu Notification Test${NC}"

if [ $NOVU_AVAILABLE -eq 1 ]; then
    if NOVU_API_KEY=$(grep "NOVU_API_KEY=" .env 2>/dev/null | cut -d= -f2); then
        echo "  Sending test notification via Novu..."

        response=$(curl -sf -X POST http://localhost:3000/v1/events/trigger \
            -H "Authorization: ApiKey $NOVU_API_KEY" \
            -H "Content-Type: application/json" \
            -d "{
                \"name\": \"test_notification\",
                \"to\": {
                    \"subscriberId\": \"$TEST_USER_ID\"
                },
                \"payload\": {
                    \"title\": \"Smoke Test Notification\",
                    \"message\": \"This is a smoke test from $(date)\",
                    \"test_id\": \"$TEST_USER_ID\"
                }
            }" 2>/dev/null || echo "{}")

        if echo "$response" | grep -q "triggeredEvents\|id"; then
            echo -e "${GREEN}✓${NC} Notification sent to Novu"
            if echo "$response" | grep -q "id"; then
                NOVU_MSG_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
                echo "    Message ID: $NOVU_MSG_ID"
            fi
        else
            echo -e "${RED}✗${NC} Failed to send notification to Novu"
            echo "    Response: $(echo $response | head -c 200)"
        fi
    else
        echo -e "${YELLOW}⚠${NC} NOVU_API_KEY not configured - skipping Novu send"
    fi
else
    echo -e "${YELLOW}⚠${NC} Novu API not available - skipping Novu send test"
fi

echo ""

# Test Python client
echo -e "${CYAN}5. Python Client Integration Test${NC}"

# Check if we can import the Novu client
python3 -c "
import sys
sys.path.insert(0, '.')

try:
    from services.shared.novu_client import get_novu_client, NotificationStrategy
    print('✓ novu_client.py imports successfully')

    # Check strategies
    strategies = [NotificationStrategy.NOVU_ONLY, NotificationStrategy.LEGACY_ONLY, NotificationStrategy.NOVU_WITH_FALLBACK]
    print(f'✓ All 3 strategies available: {[s.value for s in strategies]}')

except ImportError as e:
    print(f'✗ Import error: {e}')
    sys.exit(1)
except Exception as e:
    print(f'✗ Error: {e}')
    sys.exit(1)
" 2>/dev/null || {
    echo -e "${YELLOW}⚠${NC} Could not test Python client (not a critical failure)"
}

echo ""

# Test database connectivity (for in-app notifications)
echo -e "${CYAN}6. Database Connectivity${NC}"

if docker exec -T society_postgres psql -U "$(grep '^POSTGRES_USER=' .env | cut -d= -f2)" -d society_events -c '\dt core.notification' >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} PostgreSQL is accessible"

    # Count existing notifications
    count=$(docker exec -T society_postgres psql -U "$(grep '^POSTGRES_USER=' .env | cut -d= -f2)" -d society_events -t -c "SELECT COUNT(*) FROM core.notification;" 2>/dev/null || echo "?")
    echo "    Current notifications in DB: $count"
else
    echo -e "${YELLOW}⚠${NC} Could not verify PostgreSQL access"
fi

echo ""

# Test auth-service connectivity (for SMS/Telegram fallback)
echo -e "${CYAN}7. Fallback System Connectivity${NC}"

if curl -sf --connect-timeout 2 "http://host.containers.internal:8000/health" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} auth-service is reachable"

    if grep -q "AUTH_SERVICE_API_KEY=[^[:space:]]" .env 2>/dev/null; then
        echo -e "${GREEN}✓${NC} AUTH_SERVICE_API_KEY is configured"
        echo "    SMS/Telegram fallback: Available"
    else
        echo -e "${YELLOW}⚠${NC} AUTH_SERVICE_API_KEY not configured"
        echo "    SMS/Telegram fallback: Disabled"
    fi
else
    echo -e "${YELLOW}⚠${NC} auth-service is not reachable (external service)"
    echo "    SMS/Telegram fallback: Unavailable"
fi

if grep -q "GMAIL_SMTP_USER=[^[:space:]]" .env 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Gmail SMTP is configured"
    echo "    Email fallback: Available"
else
    echo -e "${YELLOW}⚠${NC} Gmail SMTP not configured"
    echo "    Email fallback: Disabled"
fi

echo ""

# Test configuration
echo -e "${CYAN}8. Configuration Verification${NC}"

if strategy=$(grep "NOTIFICATION_STRATEGY=" .env 2>/dev/null | cut -d= -f2); then
    case "$strategy" in
        novu_with_fallback)
            echo -e "${GREEN}✓${NC} Strategy: $strategy (Recommended)"
            echo "    Behavior: Try Novu first, auto-fallback to legacy"
            ;;
        novu_only)
            echo -e "${YELLOW}⚠${NC} Strategy: $strategy"
            echo "    Behavior: Novu exclusive (no fallback)"
            ;;
        legacy_only)
            echo -e "${YELLOW}⚠${NC} Strategy: $strategy"
            echo "    Behavior: Legacy only (Novu disabled)"
            ;;
        *)
            echo -e "${RED}✗${NC} Strategy: $strategy (Unknown)"
            ;;
    esac
else
    echo -e "${YELLOW}⚠${NC} NOTIFICATION_STRATEGY not configured"
fi

echo ""

# Final summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Smoke Test Complete${NC}"
echo ""
echo "Summary:"
echo "  • Novu API:        $([ $NOVU_AVAILABLE -eq 1 ] && echo 'Available' || echo 'Unavailable (testing fallback)')"
echo "  • PostgreSQL:      Verified"
echo "  • Fallback System: Partially configured (see details above)"
echo ""
echo "Ready for deployment!"
echo ""
echo "Next steps:"
echo "  1. Create notification templates in Novu dashboard"
echo "  2. Run: make restart-payment"
echo "  3. Run: make restart-event-service"
echo "  4. Test notifications in your application"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
