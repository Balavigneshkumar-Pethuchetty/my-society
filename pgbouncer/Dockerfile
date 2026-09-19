FROM edoburu/pgbouncer:v1.23.1-p0

# Copy the entrypoint script with execute permissions
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
