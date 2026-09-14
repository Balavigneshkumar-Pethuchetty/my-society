FROM python:3.12-slim AS builder
WORKDIR /build
RUN pip install --no-cache-dir --upgrade pip
COPY services/registration/requirements.txt .
RUN pip install --no-cache-dir --prefix=/deps -r requirements.txt

FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /deps /usr/local
WORKDIR /app
COPY services/registration/app/ app/
COPY services/shared/ shared/
RUN mkdir -p /app/uploads/payment-screenshots
EXPOSE 3005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3005"]
