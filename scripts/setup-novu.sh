#!/bin/bash
# Novu Notification System Setup (with Legacy Fallback)
# Usage: ./scripts/setup-novu.sh [environment]
#   environment: prod (default), dev, test, stage

set -e

ENVIRONMENT="${1:-prod}"
if [ "$ENVIRONMENT" = "prod" ]; then
  ENV_FILE=".env"
else
  ENV_FILE=".env.${ENVIRONMENT}"
fi

# Colors for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Novu Notification System Setup                     ║"
echo "║         (with Legacy SMS/Telegram/Email Fallback)          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Step 1: Check prerequisites
echo -e "${CYAN}Step 1: Checking Prerequisites${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found. Please install Docker.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker found"

if ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose not found. Please install Docker Compose.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Docker Compose found"

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}✗ Error: $ENV_FILE not found${NC}"
  echo "  Create it first: cp .env.example $ENV_FILE"
  exit 1
fi
echo -e "${GREEN}✓${NC} Environment file: $ENV_FILE"

echo ""

# Step 2: Generate secrets if needed
echo -e "${CYAN}Step 2: Configuring Novu Secrets${NC}"

# Check if NOVU_JWT_SECRET is set
if ! grep -q "NOVU_JWT_SECRET=[^[:space:]]" "$ENV_FILE" 2>/dev/null; then
  JWT_SECRET=$(openssl rand -base64 32)
  if grep -q "^NOVU_JWT_SECRET=" "$ENV_FILE"; then
    sed -i.bak "s/^NOVU_JWT_SECRET=.*/NOVU_JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
  else
    echo "NOVU_JWT_SECRET=$JWT_SECRET" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}✓${NC} Generated NOVU_JWT_SECRET"
else
  echo -e "${GREEN}✓${NC} NOVU_JWT_SECRET already configured"
fi

# Check if NOVU_ENCRYPTION_KEY is set
if ! grep -q "NOVU_ENCRYPTION_KEY=[^[:space:]]" "$ENV_FILE" 2>/dev/null; then
  # Generate Fernet key (Python encryption compatible)
  if command -v python3 &> /dev/null; then
    ENCRYPTION_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>/dev/null || echo "change-me-in-production")
  else
    ENCRYPTION_KEY=$(openssl rand -base64 32)
  fi
  if grep -q "^NOVU_ENCRYPTION_KEY=" "$ENV_FILE"; then
    sed -i.bak "s|^NOVU_ENCRYPTION_KEY=.*|NOVU_ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$ENV_FILE"
  else
    echo "NOVU_ENCRYPTION_KEY=$ENCRYPTION_KEY" >> "$ENV_FILE"
  fi
  echo -e "${GREEN}✓${NC} Generated NOVU_ENCRYPTION_KEY"
else
  echo -e "${GREEN}✓${NC} NOVU_ENCRYPTION_KEY already configured"
fi

# Ensure NOTIFICATION_STRATEGY is set
if ! grep -q "^NOTIFICATION_STRATEGY=" "$ENV_FILE"; then
  echo "NOTIFICATION_STRATEGY=novu_with_fallback" >> "$ENV_FILE"
  echo -e "${GREEN}✓${NC} Set NOTIFICATION_STRATEGY=novu_with_fallback (default)"
else
  STRATEGY=$(grep "^NOTIFICATION_STRATEGY=" "$ENV_FILE" | cut -d= -f2)
  echo -e "${GREEN}✓${NC} NOTIFICATION_STRATEGY=$STRATEGY"
fi

echo ""

# Step 3: Verify legacy system is configured
echo -e "${CYAN}Step 3: Checking Fallback System${NC}"

FALLBACK_READY=1
if grep -q "^AUTH_SERVICE_API_KEY=[^[:space:]]" "$ENV_FILE"; then
  echo -e "${GREEN}✓${NC} AUTH_SERVICE_API_KEY configured (SMS/Telegram fallback available)"
else
  echo -e "${YELLOW}⚠${NC}  AUTH_SERVICE_API_KEY not set (SMS/Telegram fallback disabled)"
  FALLBACK_READY=0
fi

if grep -q "^GMAIL_SMTP_USER=[^[:space:]]" "$ENV_FILE" && grep -q "^GMAIL_APP_PASSWORD=[^[:space:]]" "$ENV_FILE"; then
  echo -e "${GREEN}✓${NC} Gmail SMTP configured (Email fallback available)"
else
  echo -e "${YELLOW}⚠${NC}  Gmail SMTP not configured (Email fallback disabled)"
  FALLBACK_READY=0
fi

if [ $FALLBACK_READY -eq 0 ]; then
  echo ""
  echo "  To enable complete fallback to SMS/Telegram/Email:"
  echo "    - Set AUTH_SERVICE_API_KEY for SMS/Telegram via auth-service"
  echo "    - Set GMAIL_SMTP_USER + GMAIL_APP_PASSWORD for Email"
  echo ""
  echo "  Without these, Novu will be primary (no fallback available)"
fi

echo ""

# Step 4: Start Novu services
echo -e "${CYAN}Step 4: Starting Novu Services${NC}"

ENV_ARG=""
if [ "$ENVIRONMENT" != "prod" ]; then
  ENV_ARG="ENV=$ENVIRONMENT"
fi

echo "  Pulling Novu Docker images…"
docker pull novu/novu:0.25.0 >/dev/null 2>&1 && echo -e "${GREEN}✓${NC} Images pulled" || echo -e "${YELLOW}⚠${NC}  Could not pre-pull images"

echo "  Starting Novu services…"
if command -v make &> /dev/null; then
  make novu-up $ENV_ARG >/dev/null 2>&1 || {
    echo -e "${YELLOW}⚠${NC}  Make command failed, using docker compose directly"
    docker compose --env-file "$ENV_FILE" up -d novu-mongo novu-redis novu-api novu-worker
  }
else
  docker compose --env-file "$ENV_FILE" up -d novu-mongo novu-redis novu-api novu-worker
fi

echo ""

# Step 5: Health checks
echo -e "${CYAN}Step 5: Verifying Services${NC}"

MAX_RETRIES=30
RETRY_COUNT=0

echo "  Checking MongoDB…"
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if docker compose --env-file "$ENV_FILE" exec -T novu-mongo mongosh localhost:27017/novu --eval "db.adminCommand('ping')" >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} MongoDB is ready"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${YELLOW}⚠${NC}  MongoDB health check timed out"
  fi
  sleep 1
done

echo "  Checking Novu API…"
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf http://localhost:3000/v1/health >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Novu API is healthy"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}✗${NC} Novu API health check failed"
    echo "  Debug with: docker logs society_novu_api"
    exit 1
  fi
  sleep 2
done

echo ""

# Step 6: Display next steps
echo -e "${CYAN}Step 6: Next Steps${NC}"
echo ""
echo "  1. Access Novu Dashboard:"
echo -e "     ${YELLOW}http://localhost:3000${NC}"
echo ""
echo "  2. Create Notification Templates in Novu:"
echo "     - refund_processed"
echo "     - refund_rejected"
echo "     - payment_verified"
echo "     - payment_rejected"
echo "     - user_approved"
echo "     - event_cancelled"
echo ""
echo "  3. Get API Key:"
echo "     - Settings → API Keys → Create Key"
echo "     - Copy the key"
echo ""
echo "  4. Update .env:"
if [ "$ENVIRONMENT" = "prod" ]; then
  echo "     NOVU_API_KEY=<your-key-here>"
else
  echo "     Update $ENV_FILE"
  echo "     NOVU_API_KEY=<your-key-here>"
fi
echo ""
echo "  5. Restart Services:"
if [ "$ENVIRONMENT" != "prod" ]; then
  echo "     make restart ENV=$ENVIRONMENT"
else
  echo "     make restart"
fi
echo ""
echo "  6. Test Notifications:"
echo "     - Trigger a payment or event action"
echo "     - Check: make logs-novu"
echo "     - Or: make logs-payment | grep -i novu"
echo ""

echo -e "${GREEN}✓ Setup Complete!${NC}"
echo ""
echo "  Strategy: $(grep '^NOTIFICATION_STRATEGY=' "$ENV_FILE" | cut -d= -f2)"
echo "  Fallback:$([ $FALLBACK_READY -eq 1 ] && echo " Enabled" || echo " Partial/Disabled")"
echo ""
echo "  Useful commands:"
echo "    make novu-status       Check Novu health"
echo "    make logs-novu         Follow all Novu logs"
echo "    make logs-novu-api     Follow API logs only"
echo "    make novu-restart      Restart Novu services"
echo ""

# Cleanup backup file if it was created by sed
if [ -f "$ENV_FILE.bak" ]; then
  rm "$ENV_FILE.bak"
fi
