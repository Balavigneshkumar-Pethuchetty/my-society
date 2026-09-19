#!/bin/bash
set -e

# Create userlist.txt with all database roles
cat > /etc/pgbouncer/userlist.txt <<EOF
"${POSTGRES_USER}" "${POSTGRES_PASSWORD}"
"${USER_DB_USER}" "${USER_DB_PASSWORD}"
"${EVENT_DB_USER}" "${EVENT_DB_PASSWORD}"
"${TICKET_DB_USER}" "${TICKET_DB_PASSWORD}"
"${PAYMENT_DB_USER}" "${PAYMENT_DB_PASSWORD}"
"${REGISTRATION_DB_USER}" "${REGISTRATION_DB_PASSWORD}"
EOF

# Set proper permissions
chmod 600 /etc/pgbouncer/userlist.txt

# Generate pgbouncer.ini from environment variables
cat > /etc/pgbouncer/pgbouncer.ini <<EOF
[databases]
${DB_NAME} = host=${DB_HOST} port=${DB_PORT} user=${DB_USER}

[pgbouncer]
logfile = /var/log/pgbouncer/pgbouncer.log
pidfile = /var/run/pgbouncer/pgbouncer.pid
listen_addr = 0.0.0.0
listen_port = ${LISTEN_PORT}
unix_socket_dir = /var/run/pgbouncer
user = pgbouncer
admin_users = ${ADMIN_USERS}
stats_users = ${STATS_USERS:-stats}
auth_type = ${AUTH_TYPE}
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = ${POOL_MODE}
max_client_conn = ${MAX_CLIENT_CONN}
default_pool_size = ${DEFAULT_POOL_SIZE}
reserve_pool_size = ${RESERVE_POOL_SIZE}
reserve_pool_timeout = 3
max_db_connections = 0
max_user_connections = 0
server_lifetime = 3600
server_idle_timeout = 600
query_timeout = 0
query_wait_timeout = 120
client_idle_timeout = 0
client_login_timeout = 15
application_name_add_host = 0
idle_in_transaction_session_timeout = 0
EOF

# Start pgbouncer in foreground
exec /usr/bin/pgbouncer /etc/pgbouncer/pgbouncer.ini
