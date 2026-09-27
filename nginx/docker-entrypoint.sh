#!/bin/sh
set -e

if [ -z "$NGINX_ADMIN_PASSWORD" ]; then
  echo "[nginx-entrypoint] WARNING: NGINX_ADMIN_PASSWORD not set; basic auth disabled for pgAdmin." >&2
fi

if [ -z "$NGINX_PORT" ]; then
  echo "[nginx-entrypoint] ERROR: NGINX_PORT env var is not set." >&2
  exit 1
fi

# Detect the DNS resolver from /etc/resolv.conf — works for Docker (127.0.0.11)
# and Podman (10.89.0.1 or similar) without hardcoding either.
RESOLVER=$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)
echo "[nginx-entrypoint] Using DNS resolver: $RESOLVER"
sed -i "s/__RESOLVER__/$RESOLVER/g" /etc/nginx/nginx.conf
sed -i "s/__NGINX_PORT__/$NGINX_PORT/g" /etc/nginx/nginx.conf
echo "[nginx-entrypoint] Listening on port: $NGINX_PORT"

# ADMIN_USER="${NGINX_ADMIN_USER:-admin}"
#
# # Basic auth disabled — all auth_basic directives commented out in nginx.conf
# # Do NOT generate .htpasswd file
#
# if [ -n "$NGINX_ADMIN_PASSWORD" ]; then
#   htpasswd -bc /etc/nginx/.htpasswd "$ADMIN_USER" "$NGINX_ADMIN_PASSWORD"
#   echo "[nginx-entrypoint] Basic auth configured for user: $ADMIN_USER"
# else
#   touch /etc/nginx/.htpasswd
#   echo "[nginx-entrypoint] Basic auth disabled (.htpasswd created but empty)"
# fi

echo "[nginx-entrypoint] Basic auth completely disabled"

exec "$@"
