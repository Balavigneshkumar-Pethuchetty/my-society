# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_MODE=production
ARG VITE_APP_ENV=prod
ARG VITE_GOOGLE_LOGIN=
ARG VITE_PHONE_LOGIN=
ARG VITE_KEYCLOAK_URL=
RUN if [ "$VITE_MODE" = "development" ]; then \
      VITE_APP_ENV=$VITE_APP_ENV \
      VITE_GOOGLE_LOGIN=$VITE_GOOGLE_LOGIN \
      VITE_PHONE_LOGIN=$VITE_PHONE_LOGIN \
      VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
      npm run build:dev; \
    else \
      VITE_APP_ENV=$VITE_APP_ENV \
      VITE_GOOGLE_LOGIN=$VITE_GOOGLE_LOGIN \
      VITE_PHONE_LOGIN=$VITE_PHONE_LOGIN \
      VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
      npm run build; \
    fi

# ── Runtime (nginx serves the SPA) ───────────────────────────────────────────
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
