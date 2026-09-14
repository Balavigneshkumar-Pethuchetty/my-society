# Society Events — Developer Makefile
# Usage: make <target> [ENV=dev|test|stage|prod]
#
#   ENV=prod  (default) reads .env
#   ENV=dev            reads .env.dev
#   ENV=test           reads .env.test
#   ENV=stage          reads .env.stage
#
# Examples:
#   make up                  # start production stack
#   make up ENV=dev          # start dev stack
#   make down ENV=test       # stop test stack
#   make logs ENV=stage      # follow stage logs

.PHONY: help up down restart mode-local mode-public free-ports validate-ports check-env logs ps reset seed \
        migrate migrate-status \
        test test-db-up test-db-down \
        shell-db shell-redis shell-visitor-db sync-users setup-google-idp sync-keycloak-redirect-uris \
        frontend frontend-install frontend-docker \
        restart-nginx restart-postgres restart-redis \
        restart-pgadmin restart-user-service restart-event-service \
        restart-visitor-service restart-visitor-postgres \
        restart-mfe-admin restart-mfe-events restart-mfe-booking restart-mfe-payment restart-mfe-visitors \
        logs-nginx logs-db logs-user logs-events logs-visitor logs-visitor-db \
        logs-mfe-admin logs-mfe-events logs-mfe-booking logs-mfe-payment logs-mfe-visitors \
        logs-splunk logs-fluent-bit \
        splunk-up splunk-down

## ── Environment ─────────────────────────────────────────────────────────────
# ENV=prod   → docker-compose.yml + docker-compose.prod.yml
# ENV=stage  → docker-compose.yml
# ENV=dev    → docker-compose.yml
# ENV=test   → docker-compose.yml
#
# Splunk + Fluent Bit are centralized in ~/splunk-service (independent stack).
# Start with: make splunk-up  |  Stop with: make splunk-down
ENV              ?= prod
ENV_FILE         := $(if $(filter prod,$(ENV)),.env,.env.$(ENV))

ifeq ($(ENV),prod)
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml
else
  COMPOSE_FILES := -f docker-compose.yml
endif

COMPOSE          := docker compose --env-file $(ENV_FILE) $(COMPOSE_FILES)
COMPOSE_PROJECT  := $(shell grep -m1 '^COMPOSE_PROJECT_NAME=' $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]' || echo society)
POSTGRES_DB_NAME := $(shell grep -m1 '^POSTGRES_DB=' $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]' || echo society_events)

## ── Colours ─────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
RESET := \033[0m

help: ## Show this help
	@echo ""
	@echo "  Society Events — Local Dev Commands"
	@echo "  Usage: make <target> [ENV=dev|test|stage|prod]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-26s$(RESET) %s\n", $$1, $$2}'
	@echo ""

## ── Core lifecycle ──────────────────────────────────────────────────────────
check-env: ## Ensure the active env file exists (auto-creates from example if available)
	@if [ ! -f $(ENV_FILE) ]; then \
	  example="$(ENV_FILE).example"; \
	  if [ -f "$$example" ]; then \
	    cp "$$example" $(ENV_FILE); \
	    echo "$(CYAN)$(ENV_FILE) created from $$example — review values before starting.$(RESET)"; \
	  else \
	    echo "$(CYAN)ERROR: $(ENV_FILE) not found. Create it or run: cp .env.example $(ENV_FILE)$(RESET)"; \
	    exit 1; \
	  fi; \
	fi

free-ports: ## Kill stale rootlessport processes that hold project ports (Podman rootless workaround)
	@_released=0; \
	for port in \
	    $$(grep -m1 '^NGINX_PORT='    $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]' || echo 8080) \
	    $$(grep -m1 '^POSTGRES_PORT=' $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]' || echo 5432) \
	    $$(grep -m1 '^REDIS_PORT='    $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]' || echo 6379); do \
	  pid=$$(ss -Htlnp | grep ":$$port[[:space:]]" | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1); \
	  if [ -n "$$pid" ]; then \
	    echo "  [free-ports] releasing port $$port (pid $$pid)"; \
	    kill "$$pid" 2>/dev/null || true; \
	    _released=1; \
	  fi; \
	done; \
	[ "$$_released" = "1" ] && sleep 1 || true

validate-ports: check-env ## Validate that host ports in the active env file do not conflict
	@_f=$(ENV_FILE); \
	_get() { grep -m1 "^$$1=" "$$_f" 2>/dev/null | cut -d= -f2- | tr -d '"[:space:]' || echo "$$2"; }; \
	ports="NGINX_PORT:$$(_get NGINX_PORT 8080) POSTGRES_PORT:$$(_get POSTGRES_PORT 5432) REDIS_PORT:$$(_get REDIS_PORT 6379)"; \
	seen=""; has_conflict=0; \
	for item in $$ports; do \
	  name=$${item%%:*}; port=$${item#*:}; \
	  for prev in $$seen; do \
	    if [ "$${prev#*:}" = "$$port" ]; then \
	      echo "  [validate-ports] $$name and $${prev%%:*} both use port $$port in $(ENV_FILE)"; \
	      has_conflict=1; \
	    fi; \
	  done; \
	  seen="$$seen $$item"; \
	done; \
	if [ "$$has_conflict" = "1" ]; then \
	  echo "  Update $(ENV_FILE) so each exposed service has a unique host port."; \
	  exit 1; \
	fi

up: validate-ports ## Start all services (detached). ENV=dev|test|stage|prod
	@$(MAKE) -s free-ports ENV=$(ENV)
	$(COMPOSE) --profile frontend up -d --build
	@echo "  Activating host port bindings…"
	@$(COMPOSE) restart nginx 2>/dev/null || true
	@$(MAKE) -s sync-keycloak-redirect-uris ENV=$(ENV)
	@echo ""
	@_port=$$(grep -m1 '^NGINX_PORT=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo 8080); \
	 _local="http://localhost:$$_port"; \
	 _kc=$$(grep -m1 '^KEYCLOAK_PUBLIC_URL=' $(ENV_FILE) | cut -d= -f2- | tr -d '"[:space:]' || echo https://auth.gm-global-techies-town.club); \
	 _hec=$$(grep -m1 '^SPLUNK_HEC_TOKEN=' $(ENV_FILE) | cut -d= -f2- | tr -d '"[:space:]'); \
	 if [ "$(ENV)" = "prod" ] || [ "$(ENV)" = "stage" ]; then \
	   _site="https://gm-global-techies-town.club"; \
	   _pgadmin="https://pgadmin.gm-global-techies-town.club"; \
	 else \
	   _site="$$_local"; \
	   _pgadmin="$$_local/pgadmin/"; \
	 fi; \
	 echo ""; \
	 echo "  $(CYAN)[$(ENV)] Services starting…$(RESET)"; \
	 echo "  Env file           → $(ENV_FILE)"; \
	 echo "  Local              → $$_local/"; \
	 echo "  Keycloak           → $$_kc/admin/  (shared, external — in ~/auth-service, not started by this stack)"; \
	 echo ""; \
	 echo "  $(CYAN)Browser pages$(RESET)"; \
	 echo "  App home           → $$_site/"; \
	 echo "  Forgot password    → $$_site/forgot-password"; \
	 echo "  Profile            → $$_site/profile"; \
	 echo "  Events             → $$_site/events"; \
	 echo "  Tickets            → $$_site/tickets"; \
	 echo "  Checkout           → $$_site/checkout"; \
	 echo "  Payments           → $$_site/payments"; \
	 echo "  Event manager      → $$_site/manage"; \
	 echo "  Admin panel        → $$_site/admin"; \
	 echo "  Sponsor portal     → $$_site/sponsor"; \
	 echo "  QR scanner         → $$_site/scanner"; \
	 echo "  Entry log          → $$_site/entry-log"; \
	 echo ""; \
	 echo "  $(CYAN)Admin / docs$(RESET)"; \
	 echo "  Keycloak admin     → $$_kc/admin/  (shared, external)"; \
	 echo "  pgAdmin            → $$_pgadmin"; \
	 if [ -n "$$_hec" ]; then \
	   echo "  Splunk             → https://splunk.gm-global-techies-town.club  (shared, external — this env ships logs there)"; \
	 else \
	   echo "  Splunk             → not configured for [$(ENV)] (no SPLUNK_HEC_TOKEN in $(ENV_FILE)) — logs stay local"; \
	 fi; \
	 echo "  User API docs      → $$_local/api/users/docs"; \
	 echo "  Event API docs     → $$_local/api/events/docs"; \
	 echo "  Registration docs  → $$_local/api/registrations/docs"; \
	 echo "  Ticket API docs    → $$_local/api/tickets/docs"; \
	 echo "  Payment API docs   → $$_local/api/payments/docs"; \
	 echo ""; \
	 echo "  $(CYAN)MFE preview roots$(RESET)"; \
	 echo "  Admin MFE          → $$_local/mfe-admin/"; \
	 echo "  Events MFE         → $$_local/mfe-events/"; \
	 echo "  Booking MFE        → $$_local/mfe-booking/"; \
	 echo "  Payment MFE        → $$_local/mfe-payment/"; \
	 echo "  Run 'make logs ENV=$(ENV)' to follow logs."; \
	 echo ""

down: ## Stop and remove all containers for the active environment
	$(COMPOSE) --profile frontend down --remove-orphans
	@$(MAKE) -s free-ports ENV=$(ENV)

fix-ports: ## Re-bind host ports when localhost stops responding (WSL2/Podman rootlessport dies)
	@echo "Restarting port forwarders…"
	@$(COMPOSE) restart nginx 2>/dev/null || true
	@echo "  Port 8080: $$(ss -tlnp | grep -c ':8080' && echo ok || echo FAILED)"

setup-email: ## Configure Keycloak SMTP (Gmail) — set GMAIL_SMTP_USER + GMAIL_APP_PASSWORD in env file first
	@_user=$$(grep -m1 '^GMAIL_SMTP_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_pass=$$(grep -m1 '^GMAIL_APP_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_kc_user=$$(grep -m1 '^KEYCLOAK_ADMIN_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo admin); \
	_kc_pass=$$(grep -m1 '^KEYCLOAK_ADMIN_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_kc_url=$$(grep -m1 '^KEYCLOAK_URL=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo https://auth.gm-global-techies-town.club); \
	_realm=$$(grep -m1 '^KEYCLOAK_REALM=' $(ENV_FILE) 2>/dev/null | cut -d= -f2 | tr -d '"[:space:]'); \
	[ -z "$$_realm" ] && _realm=society-events; \
	if [ -z "$$_user" ] || [ -z "$$_pass" ]; then \
	  echo "$(CYAN)ERROR: Set GMAIL_SMTP_USER and GMAIL_APP_PASSWORD in $(ENV_FILE) first$(RESET)"; \
	  exit 1; \
	fi; \
	echo "  Obtaining Keycloak admin token from $$_kc_url…"; \
	_token=$$(curl -s -X POST "$$_kc_url/realms/master/protocol/openid-connect/token" \
	  -d "client_id=admin-cli&grant_type=password&username=$$_kc_user&password=$$_kc_pass" \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null); \
	if [ -z "$$_token" ]; then echo "$(CYAN)ERROR: Could not get Keycloak admin token$(RESET)"; exit 1; fi; \
	echo "  Configuring SMTP for realm $$_realm…"; \
	curl -s -X PUT "$$_kc_url/admin/realms/$$_realm" \
	  -H "Authorization: Bearer $$_token" \
	  -H "Content-Type: application/json" \
	  -d "{\"smtpServer\":{\"host\":\"smtp.gmail.com\",\"port\":\"587\",\"from\":\"$$_user\",\"fromDisplayName\":\"GM Global Techies Town\",\"auth\":\"true\",\"ssl\":\"false\",\"starttls\":\"true\",\"user\":\"$$_user\",\"password\":\"$$_pass\"}}" \
	  -o /dev/null -w "%{http_code}" | grep -q '204' \
	  && echo "  $(CYAN)SMTP configured — test by running: make test-email ENV=$(ENV)$(RESET)" \
	  || echo "  $(CYAN)ERROR: SMTP update failed$(RESET)"

test-email: ## Send a test reset email to GMAIL_SMTP_USER (verifies SMTP works)
	@_user=$$(grep -m1 '^GMAIL_SMTP_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_kc_user=$$(grep -m1 '^KEYCLOAK_ADMIN_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo admin); \
	_kc_pass=$$(grep -m1 '^KEYCLOAK_ADMIN_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_kc_url=$$(grep -m1 '^KEYCLOAK_URL=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo https://auth.gm-global-techies-town.club); \
	_realm=$$(grep -m1 '^KEYCLOAK_REALM=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' || echo society-events); \
	_pub=$$(grep -m1 '^KEYCLOAK_PUBLIC_URL=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	_token=$$(curl -s -X POST "$$_kc_url/realms/master/protocol/openid-connect/token" \
	  -d "client_id=admin-cli&grant_type=password&username=$$_kc_user&password=$$_kc_pass" \
	  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null); \
	_uid=$$(curl -s "$$_kc_url/admin/realms/$$_realm/users?email=$$_user&exact=true" \
	  -H "Authorization: Bearer $$_token" \
	  | python3 -c "import sys,json; u=json.load(sys.stdin); print(u[0]['id'] if u else '')" 2>/dev/null); \
	if [ -z "$$_uid" ]; then echo "$(CYAN)User $$_user not found in Keycloak$(RESET)"; exit 1; fi; \
	curl -s -X PUT "$$_kc_url/admin/realms/$$_realm/users/$$_uid/execute-actions-email" \
	  -H "Authorization: Bearer $$_token" -H "Content-Type: application/json" \
	  -G --data-urlencode "client_id=society-frontend" --data-urlencode "redirect_uri=$$_pub/" \
	  -d '["UPDATE_PASSWORD"]' -w "\nHTTP %{http_code}\n" \
	  && echo "  $(CYAN)Reset email sent to $$_user$(RESET)"

restart: ## Restart all core services (rebuilds changed images)
	$(COMPOSE) --profile frontend up -d --build

mode-local: ## Rebuild against local Keycloak (society-dev stack, .env.dev — run `make mode-local` in ~/auth-service too)
	$(MAKE) --no-print-directory restart ENV=dev

mode-public: ## Rebuild against public Keycloak (society stack, .env — the Cloudflare tunnel)
	$(MAKE) --no-print-directory restart ENV=prod

## ── Individual service restarts ─────────────────────────────────────────────
restart-nginx: ## Rebuild & restart nginx (nginx.conf is baked into the image)
	$(COMPOSE) up -d --build nginx

restart-keycloak: ## Restart Keycloak (managed by auth-service)
	cd $(HOME)/auth-service && podman-compose restart keycloak

restart-postgres: ## Restart Postgres only
	$(COMPOSE) restart postgres

restart-redis: ## Restart Redis only
	$(COMPOSE) restart redis

restart-pgadmin: ## Restart pgAdmin only
	$(COMPOSE) restart pgadmin

restart-user-service: ## Rebuild & restart user service (picks up code changes)
	$(COMPOSE) up -d --build user-service

restart-event-service: ## Rebuild & restart event service (picks up code changes)
	$(COMPOSE) up -d --build event-service

restart-visitor-service: ## Rebuild & restart visitor service (picks up code changes)
	$(COMPOSE) up -d --build visitor-service

restart-visitor-postgres: ## Restart the visitor service's dedicated Postgres only
	$(COMPOSE) restart visitor-postgres

restart-cloudflared: ## Restart Cloudflare tunnel (managed by auth-service)
	cd $(HOME)/auth-service && podman-compose restart cloudflared

restart-mfe-admin: ## Rebuild & restart mfe-admin container
	$(COMPOSE) --profile frontend up -d --build mfe-admin

restart-mfe-events: ## Rebuild & restart mfe-events container
	$(COMPOSE) --profile frontend up -d --build mfe-events

restart-mfe-booking: ## Rebuild & restart mfe-booking container
	$(COMPOSE) --profile frontend up -d --build mfe-booking

restart-mfe-payment: ## Rebuild & restart mfe-payment container
	$(COMPOSE) --profile frontend up -d --build mfe-payment

restart-mfe-visitors: ## Rebuild & restart mfe-visitors container
	$(COMPOSE) --profile frontend up -d --build mfe-visitors

## ── Splunk / Fluent Bit (centralized ~/splunk-service) ──────────────────────
splunk-up: ## Start centralized Splunk + Fluent Bit (~/splunk-service)
	cd $(HOME)/splunk-service && podman-compose up -d --build

splunk-down: ## Stop centralized Splunk + Fluent Bit (~/splunk-service)
	cd $(HOME)/splunk-service && podman-compose down

## ── Status ──────────────────────────────────────────────────────────────────
ps: ## Show service status and health
	$(COMPOSE) ps

## ── Logs ────────────────────────────────────────────────────────────────────
logs: ## Follow logs for all running services
	$(COMPOSE) logs -f

logs-nginx: ## Follow nginx logs only
	$(COMPOSE) logs -f nginx

logs-kc: ## Follow Keycloak logs (managed by auth-service)
	cd $(HOME)/auth-service && podman-compose logs -f keycloak

logs-db: ## Follow Postgres logs only
	$(COMPOSE) logs -f postgres

logs-user: ## Follow user service logs only
	$(COMPOSE) logs -f user-service

logs-events: ## Follow event service logs only
	$(COMPOSE) logs -f event-service

logs-visitor: ## Follow visitor service logs only
	$(COMPOSE) logs -f visitor-service

logs-visitor-db: ## Follow visitor-postgres logs only
	$(COMPOSE) logs -f visitor-postgres

logs-cloudflared: ## Follow Cloudflare tunnel logs (managed by auth-service)
	cd $(HOME)/auth-service && podman-compose logs -f cloudflared

logs-mfe-admin: ## Follow mfe-admin logs
	$(COMPOSE) --profile frontend logs -f mfe-admin

logs-mfe-events: ## Follow mfe-events logs
	$(COMPOSE) --profile frontend logs -f mfe-events

logs-mfe-booking: ## Follow mfe-booking logs
	$(COMPOSE) --profile frontend logs -f mfe-booking

logs-mfe-payment: ## Follow mfe-payment logs
	$(COMPOSE) --profile frontend logs -f mfe-payment

logs-mfe-visitors: ## Follow mfe-visitors logs
	$(COMPOSE) --profile frontend logs -f mfe-visitors

logs-splunk: ## Follow Splunk logs (centralized ~/splunk-service)
	cd $(HOME)/splunk-service && podman-compose logs -f splunk

logs-fluent-bit: ## Follow Fluent Bit logs (centralized ~/splunk-service)
	cd $(HOME)/splunk-service && podman-compose logs -f fluent-bit

## ── Database ────────────────────────────────────────────────────────────────
shell-db: ## Open psql in the active environment's database
	$(COMPOSE) exec postgres psql -U $$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') -d $(POSTGRES_DB_NAME)

shell-redis: ## Open redis-cli (authenticates if REDIS_PASSWORD is set)
	$(COMPOSE) exec redis redis-cli $$(grep -m1 '^REDIS_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]' | grep -q . && echo "-a $$(grep -m1 '^REDIS_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]')") --no-auth-warning

shell-visitor-db: ## Open psql in the visitor service's dedicated database
	$(COMPOSE) exec visitor-postgres psql -U $$(grep -m1 '^VISITOR_POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') -d $$(grep -m1 '^VISITOR_POSTGRES_DB=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]')

seed: ## Re-run only the seed script (idempotent — uses ON CONFLICT DO NOTHING)
	$(COMPOSE) exec -T postgres \
	  psql -U $$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') -d $(POSTGRES_DB_NAME) \
	  -f /docker-entrypoint-initdb.d/02_seed.sql
	@echo "Seed complete."

migrate: ## Apply not-yet-recorded SQL migrations in db/migrations/ (idempotent; tracked in schema_migrations)
	@PGUSER=$$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	rec() { $(COMPOSE) exec -T postgres psql -q -v ON_ERROR_STOP=1 -U $$PGUSER -d $(POSTGRES_DB_NAME) "$$@"; }; \
	rec -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"; \
	applied=$$(rec -tAc "SELECT filename FROM schema_migrations"); \
	for f in db/migrations/*.sql; do \
	  base=$$(basename $$f); \
	  if printf '%s\n' "$$applied" | grep -qxF "$$base"; then \
	    echo "✓ $$base (already applied)"; continue; \
	  fi; \
	  echo "→ Applying $$base…"; \
	  if $(COMPOSE) exec -T postgres psql -v ON_ERROR_STOP=1 \
	      -U $$PGUSER -d $(POSTGRES_DB_NAME) -f /dev/stdin < $$f; then \
	    rec -c "INSERT INTO schema_migrations (filename) VALUES ('$$base') ON CONFLICT (filename) DO NOTHING;"; \
	  else \
	    echo "✗ $$base FAILED — stopping (nothing recorded for it)."; exit 1; \
	  fi; \
	done; \
	echo "Migrations complete."

migrate-status: ## Show which db/migrations/ files are applied vs still pending
	@PGUSER=$$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]'); \
	$(COMPOSE) exec -T postgres psql -q -U $$PGUSER -d $(POSTGRES_DB_NAME) \
	  -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());" >/dev/null; \
	applied=$$($(COMPOSE) exec -T postgres psql -tAq -U $$PGUSER -d $(POSTGRES_DB_NAME) -c "SELECT filename FROM schema_migrations"); \
	pending=0; \
	for f in db/migrations/*.sql; do \
	  base=$$(basename $$f); \
	  if printf '%s\n' "$$applied" | grep -qxF "$$base"; then \
	    echo "  ✓ $$base"; \
	  else \
	    echo "  ✗ $$base  (pending)"; pending=$$((pending + 1)); \
	  fi; \
	done; \
	echo "$$pending migration(s) pending."

## ── Testing (see MAINTAINABILITY_PLAN.md step 6) ───────────────────────────
# A disposable, bare postgres:16-alpine container — NOT the ENV=test full stack
# (docker-compose + Keycloak via .env.test/.env.test.example — that's for manual
# end-to-end testing). Auth in tests goes through FastAPI dependency_overrides
# instead (see services/shared/testing.py), so no Keycloak is needed here at all.
TEST_PG_CONTAINER := society_test_postgres
TEST_PG_PORT       ?= 5434
TEST_PG_USER       := test_user
TEST_PG_PASSWORD   := test_pass
TEST_PG_DB         := society_events_test
# visitor-service has its own standalone database (no FKs to the main schema — see
# services/visitor/db/init/01_schema.sql's own header comment) with its own migrations,
# so it gets a second, separately-schemaed disposable Postgres.
TEST_VISITOR_PG_CONTAINER := society_test_visitor_postgres
TEST_VISITOR_PG_PORT       ?= 5436
TEST_VISITOR_PG_DB         := visitor_service_test
TEST_SERVICES      := event payment registration ticket user visitor

test-db-up: ## Start disposable test Postgres instances (schema + migrations applied), for `make test`
	@docker rm -f $(TEST_PG_CONTAINER) $(TEST_VISITOR_PG_CONTAINER) >/dev/null 2>&1 || true
	docker run -d --name $(TEST_PG_CONTAINER) \
	  -e POSTGRES_USER=$(TEST_PG_USER) -e POSTGRES_PASSWORD=$(TEST_PG_PASSWORD) -e POSTGRES_DB=$(TEST_PG_DB) \
	  -p 127.0.0.1:$(TEST_PG_PORT):5432 \
	  postgres:16-alpine >/dev/null
	docker run -d --name $(TEST_VISITOR_PG_CONTAINER) \
	  -e POSTGRES_USER=$(TEST_PG_USER) -e POSTGRES_PASSWORD=$(TEST_PG_PASSWORD) -e POSTGRES_DB=$(TEST_VISITOR_PG_DB) \
	  -p 127.0.0.1:$(TEST_VISITOR_PG_PORT):5432 \
	  postgres:16-alpine >/dev/null
	@echo "$(CYAN)Waiting for test postgres instances…$(RESET)"
	@until docker exec $(TEST_PG_CONTAINER) pg_isready -U $(TEST_PG_USER) -d $(TEST_PG_DB) -q 2>/dev/null; do sleep 1; done
	@until docker exec $(TEST_VISITOR_PG_CONTAINER) pg_isready -U $(TEST_PG_USER) -d $(TEST_VISITOR_PG_DB) -q 2>/dev/null; do sleep 1; done
	docker exec -i $(TEST_PG_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(TEST_PG_USER) -d $(TEST_PG_DB) -f /dev/stdin < db/init/01_schema.sql >/dev/null
	@# services/shared/test_seed.sql, not db/init/02_seed.sql — the latter seeds far more
	@# demo data than tests need; only the SOCIETY_ID row + 'INR' currency are required.
	docker exec -i $(TEST_PG_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(TEST_PG_USER) -d $(TEST_PG_DB) -f /dev/stdin < services/shared/test_seed.sql >/dev/null
	@for f in db/migrations/*.sql; do \
	  docker exec -i $(TEST_PG_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(TEST_PG_USER) -d $(TEST_PG_DB) -f /dev/stdin < $$f >/dev/null \
	    || { echo "✗ $$f failed"; exit 1; }; \
	done
	docker exec -i $(TEST_VISITOR_PG_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(TEST_PG_USER) -d $(TEST_VISITOR_PG_DB) -f /dev/stdin < services/visitor/db/init/01_schema.sql >/dev/null
	@for f in services/visitor/db/migrations/*.sql; do \
	  docker exec -i $(TEST_VISITOR_PG_CONTAINER) psql -v ON_ERROR_STOP=1 -U $(TEST_PG_USER) -d $(TEST_VISITOR_PG_DB) -f /dev/stdin < $$f >/dev/null \
	    || { echo "✗ $$f failed"; exit 1; }; \
	done
	@echo "$(CYAN)Test postgres ready: main=127.0.0.1:$(TEST_PG_PORT) visitor=127.0.0.1:$(TEST_VISITOR_PG_PORT)$(RESET)"

test-db-down: ## Stop and remove the disposable test Postgres instances
	docker rm -f $(TEST_PG_CONTAINER) $(TEST_VISITOR_PG_CONTAINER) >/dev/null 2>&1 || true

test: test-db-down test-db-up ## Run every backend service's pytest suite against a fresh test Postgres
	@set -e; \
	fail=0; \
	for s in $(TEST_SERVICES); do \
	  [ -d services/$$s/tests ] || continue; \
	  echo "$(CYAN)── pytest: $$s-service ──$(RESET)"; \
	  if [ "$$s" = "visitor" ]; then \
	    export TEST_POSTGRES_PORT=$(TEST_VISITOR_PG_PORT) TEST_POSTGRES_DB=$(TEST_VISITOR_PG_DB); \
	  else \
	    export TEST_POSTGRES_PORT=$(TEST_PG_PORT) TEST_POSTGRES_DB=$(TEST_PG_DB); \
	  fi; \
	  export TEST_POSTGRES_USER=$(TEST_PG_USER) TEST_POSTGRES_PASSWORD=$(TEST_PG_PASSWORD); \
	  venv=services/$$s/.venv-test; \
	  if [ ! -d $$venv ]; then \
	    python3 -m venv $$venv; \
	    $$venv/bin/pip install -q --upgrade pip; \
	    $$venv/bin/pip install -q -r services/$$s/requirements.txt -r requirements-test.txt; \
	  fi; \
	  $$venv/bin/python -m pytest services/$$s/tests/ -q || fail=1; \
	done; \
	$(MAKE) -s test-db-down; \
	exit $$fail

setup-google-idp: ## Apply Google IDP + first-broker-login flow to the RUNNING Keycloak (idempotent)
	python3 scripts/setup_google_idp.py

sync-keycloak-redirect-uris: ## Register this stack's NGINX_PORT origin with Keycloak's society-frontend client (idempotent; auto-run by `make up`)
	@python3 scripts/sync_keycloak_redirect_uris.py $(ENV_FILE)

sync-users: ## Sync users from auth-service realm.json → postgres (inserts only, never overwrites)
	docker run --rm \
	  --network $(COMPOSE_PROJECT)_network \
	  -v $(HOME)/auth-service/keycloak/realm.json:/realm.json:ro \
	  -v $(PWD)/scripts/sync_keycloak_users.py:/sync.py:ro \
	  -e POSTGRES_HOST=$(COMPOSE_PROJECT)_postgres \
	  -e POSTGRES_DB=$(POSTGRES_DB_NAME) \
	  -e POSTGRES_USER=$$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') \
	  -e POSTGRES_PASSWORD=$$(grep -m1 '^POSTGRES_PASSWORD=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') \
	  -e REALM_JSON_PATH=/realm.json \
	  python:3.12-alpine \
	  sh -c "pip install psycopg2-binary -q && python /sync.py"

## ── Reset ───────────────────────────────────────────────────────────────────
reset: ## ⚠ Destroy ALL volumes for the active env, restart from scratch, then sync users
	@echo "$(CYAN)Stopping containers and removing volumes… [$(ENV)]$(RESET)"
	$(COMPOSE) --profile frontend down -v --remove-orphans
	@$(MAKE) -s validate-ports ENV=$(ENV)
	@$(MAKE) -s free-ports ENV=$(ENV)
	$(COMPOSE) --profile frontend up -d --build
	@echo "$(CYAN)Waiting for postgres to be healthy…$(RESET)"
	@until $(COMPOSE) exec -T postgres pg_isready \
	    -U $$(grep -m1 '^POSTGRES_USER=' $(ENV_FILE) | cut -d= -f2 | tr -d '"[:space:]') \
	    -d $(POSTGRES_DB_NAME) -q; do sleep 2; done
	@$(MAKE) sync-users ENV=$(ENV)
	@echo "$(CYAN)Fresh [$(ENV)] environment ready.$(RESET)"

## ── Frontend ────────────────────────────────────────────────────────────────
frontend: ## Start the Shell App dev server on http://localhost:3000 (hot-reload)
	cd frontend/shell && npm install && npm run dev

frontend-install: ## Install frontend dependencies only
	cd frontend/shell && npm install

frontend-docker: ## Build and run all production frontend containers (served by nginx at /)
	$(COMPOSE) --profile frontend build --no-cache frontend mfe-admin mfe-events mfe-booking mfe-payment
	$(COMPOSE) --profile frontend up -d frontend mfe-admin mfe-events mfe-booking mfe-payment
