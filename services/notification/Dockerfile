# ── Build (install Python deps in isolation) ──────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /build
RUN pip install --no-cache-dir --upgrade pip
COPY services/notification/requirements.txt .
RUN pip install --no-cache-dir --prefix=/deps -r requirements.txt

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
# curl needed for the docker-compose healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /deps /usr/local
WORKDIR /app
COPY services/notification/app/ app/
COPY services/shared/ shared/
EXPOSE 3009
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=30s \
    CMD curl -sf http://localhost:3009/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3009"]
