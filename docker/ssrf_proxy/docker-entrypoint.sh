#!/bin/bash

# Modified based on Squid OCI image entrypoint

# This entrypoint aims to forward the squid logs to stdout to assist users of
# common container related tooling (e.g., kubernetes, docker-compose, etc) to
# access the service logs.

# Moreover, it invokes the squid binary, leaving all the desired parameters to
# be provided by the "command" passed to the spawned container. If no command
# is provided by the user, the default behavior (as per the CMD statement in
# the Dockerfile) will be to use Ubuntu's default configuration [1] and run
# squid with the "-NYC" options to mimic the behavior of the Ubuntu provided
# systemd unit.

# [1] The default configuration is changed in the Dockerfile to allow local
# network connections. See the Dockerfile for further information.

echo "[ENTRYPOINT] re-create snakeoil self-signed certificate removed in the build process"
if [ ! -f /etc/ssl/private/ssl-cert-snakeoil.key ]; then
    /usr/sbin/make-ssl-cert generate-default-snakeoil --force-overwrite > /dev/null 2>&1
fi

tail -F /var/log/squid/access.log 2>/dev/null &
tail -F /var/log/squid/error.log 2>/dev/null &
tail -F /var/log/squid/store.log 2>/dev/null &
tail -F /var/log/squid/cache.log 2>/dev/null &

# Select the appropriate template based on DEV_MODE
echo "[ENTRYPOINT] SSRF_PROXY_DEV_MODE is set to: '${SSRF_PROXY_DEV_MODE}'"
if [ "${SSRF_PROXY_DEV_MODE}" = "true" ] || [ "${SSRF_PROXY_DEV_MODE}" = "True" ] || [ "${SSRF_PROXY_DEV_MODE}" = "TRUE" ] || [ "${SSRF_PROXY_DEV_MODE}" = "1" ]; then
    echo "[ENTRYPOINT] WARNING: Development mode is ENABLED! All SSRF protections are DISABLED!"
    echo "[ENTRYPOINT] This allows access to localhost, private networks, and all ports."
    echo "[ENTRYPOINT] DO NOT USE IN PRODUCTION!"
    TEMPLATE_FILE="/etc/squid/squid.conf.dev.template"
else
    echo "[ENTRYPOINT] Using production configuration with SSRF protections enabled"
    TEMPLATE_FILE="/etc/squid/squid.conf.template"
fi

# Check if the selected template exists
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "[ENTRYPOINT] ERROR: Template file $TEMPLATE_FILE not found"
    exit 1
fi

# Replace environment variables in the template and output to the squid.conf
echo "[ENTRYPOINT] replacing environment variables in the template: $TEMPLATE_FILE"
awk '{
    while(match($0, /\${[A-Za-z_][A-Za-z_0-9]*}/)) {
        var = substr($0, RSTART+2, RLENGTH-3)
        val = ENVIRON[var]
        $0 = substr($0, 1, RSTART-1) val substr($0, RSTART+RLENGTH)
    }
    print
}' "$TEMPLATE_FILE" > /etc/squid/squid.conf

# Log first few lines of generated config for debugging
echo "[ENTRYPOINT] First 30 lines of generated squid.conf:"
head -n 30 /etc/squid/squid.conf

# Create an empty conf.d directory if it doesn't exist
if [ ! -d /etc/squid/conf.d ]; then
    echo "[ENTRYPOINT] creating /etc/squid/conf.d directory"
    mkdir -p /etc/squid/conf.d
fi

# If conf.d directory is empty, create a placeholder file to prevent include errors
# Only needed for production template which has the include directive
if [ "${SSRF_PROXY_DEV_MODE}" != "true" ] && [ -z "$(ls -A /etc/squid/conf.d/*.conf 2>/dev/null)" ]; then
    echo "[ENTRYPOINT] conf.d directory is empty, creating placeholder"
    echo "# Placeholder file to prevent include errors" > /etc/squid/conf.d/placeholder.conf
fi

/usr/sbin/squid -Nz
echo "[ENTRYPOINT] starting squid"
/usr/sbin/squid -f /etc/squid/squid.conf -NYC 1
