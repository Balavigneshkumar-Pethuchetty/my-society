FROM python:3.12-slim AS builder
WORKDIR /build
RUN pip install --no-cache-dir --upgrade pip
COPY services/payment/requirements.txt .
RUN pip install --no-cache-dir --prefix=/deps -r requirements.txt

FROM python:3.12-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /deps /usr/local
WORKDIR /app
COPY services/payment/app/ app/
COPY services/shared/ shared/
COPY services/payment/test_screenshot/ test_screenshot/
RUN mkdir -p /app/uploads/payment-screenshots
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3007"]
