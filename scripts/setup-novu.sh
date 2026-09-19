#!/bin/bash
# Setup script for Novu migration
# Run this script to prepare Novu for deployment

set -e

echo "================================"
echo "Novu Setup Script"
echo "================================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Docker
echo -e "${YELLOW}Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not found. Please install Docker.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker found${NC}"

# Check Docker Compose
echo -e "${YELLOW}Checking Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose not found. Please install Docker Compose.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose found${NC}"

# Create .env.novu if it doesn't exist
echo -e "${YELLOW}Setting up environment...${NC}"
if [ ! -f ".env.novu" ]; then
    cp .env.novu.example .env.novu
    echo -e "${YELLOW}Created .env.novu - please update with your credentials${NC}"
else
    echo -e "${GREEN}✓ .env.novu already exists${NC}"
fi

# Start Novu services
echo -e "${YELLOW}Starting Novu services...${NC}"
docker compose -f docker-compose.novu.yml up -d

# Wait for services to be ready
echo -e "${YELLOW}Waiting for Novu to be ready...${NC}"
until curl -s http://localhost:3000/v1/health > /dev/null 2>&1; do
    echo "Waiting for Novu API..."
    sleep 5
done
echo -e "${GREEN}✓ Novu API is ready${NC}"

# Show next steps
echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}Novu Setup Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "Next steps:"
echo "1. Access Novu dashboard: http://localhost:3000"
echo "2. Create an account and login"
echo "3. Go to Settings → API Keys"
echo "4. Create a new API key"
echo "5. Update .env.novu with the API key"
echo "6. Configure integrations (Telegram, SMS, etc.)"
echo "7. Create notification templates"
echo "8. Run: make novu-migrate"
echo ""
echo -e "${YELLOW}Check services with:${NC}"
echo "  docker compose -f docker-compose.novu.yml ps"
echo ""
echo -e "${YELLOW}View logs with:${NC}"
echo "  docker compose -f docker-compose.novu.yml logs -f"
echo ""
