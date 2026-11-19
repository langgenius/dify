#!/bin/sh
# Start Caddy with the NGINX_* settings translated by proxy-env.sh.
#   docker-entrypoint.sh          run the proxy (container entrypoint)
#   docker-entrypoint.sh reload   apply changed settings or renewed certificates
#                                 without dropping connections
set -eu

. /etc/caddy/proxy-env.sh
dify_proxy_env

case "${1:-run}" in
	run) exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile ;;
	reload) exec caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ;;
	*) exec "$@" ;;
esac
