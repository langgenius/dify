#!/bin/sh
# Translate the reverse-proxy settings shared with Nginx (NGINX_* in
# envs/infrastructure/nginx.defaults) into values Caddy accepts, and export them
# as DIFY_PROXY_* for the Caddyfile. Sourced by docker-entrypoint.sh.

# Nginx sizes are binary (100M = 100 MiB). Caddy reads "100M" as 10^8 bytes.
dify_proxy_size() {
	value=$1
	number=${value%[kKmMgG]}
	case ${value#"$number"} in
		k | K) echo "${number}KiB" ;;
		m | M) echo "${number}MiB" ;;
		g | G) echo "${number}GiB" ;;
		*) echo "$value" ;;
	esac
}

# Nginx accepts a bare number of seconds; Caddy requires a unit.
dify_proxy_duration() {
	case $1 in
		*[!0-9]*) echo "$1" ;;
		*) echo "${1}s" ;;
	esac
}

# Nginx lists protocols ("TLSv1.2 TLSv1.3"); Caddy takes a minimum and a maximum.
# Caddy does not offer TLS 1.0 or 1.1, so those raise the minimum to TLS 1.2.
dify_proxy_tls_range() {
	older=false
	newest=false
	for protocol in $1; do
		case $protocol in
			TLSv1 | TLSv1.1 | TLSv1.2) older=true ;;
			TLSv1.3) newest=true ;;
		esac
	done
	case $older$newest in
		truefalse) echo "tls1.2 tls1.2" ;;
		falsetrue) echo "tls1.3 tls1.3" ;;
		*) echo "tls1.2 tls1.3" ;;
	esac
}

dify_proxy_env() {
	DIFY_PROXY_MAX_BODY_SIZE=$(dify_proxy_size "${NGINX_CLIENT_MAX_BODY_SIZE:-100M}")
	DIFY_PROXY_READ_TIMEOUT=$(dify_proxy_duration "${NGINX_PROXY_READ_TIMEOUT:-3600s}")
	DIFY_PROXY_SEND_TIMEOUT=$(dify_proxy_duration "${NGINX_PROXY_SEND_TIMEOUT:-3600s}")
	DIFY_PROXY_IDLE_TIMEOUT=$(dify_proxy_duration "${NGINX_KEEPALIVE_TIMEOUT:-65}")
	DIFY_PROXY_TLS_PROTOCOLS=$(dify_proxy_tls_range "${NGINX_SSL_PROTOCOLS:-TLSv1.2 TLSv1.3}")
	DIFY_PROXY_SOCKET_IO_UPSTREAM=${NGINX_SOCKET_IO_UPSTREAM:-api_websocket:5001}

	# Same certificate lookup as nginx/docker-entrypoint.sh: Certbot's live
	# directory when it holds both files, otherwise the legacy nginx/ssl mount.
	DIFY_PROXY_HTTPS=off
	if [ "${NGINX_HTTPS_ENABLED:-false}" = "true" ]; then
		DIFY_PROXY_HTTPS=files
		cert=${NGINX_SSL_CERT_FILENAME:-dify.crt}
		key=${NGINX_SSL_CERT_KEY_FILENAME:-dify.key}
		live=${DIFY_PROXY_CERTBOT_LIVE_DIR:-/etc/letsencrypt/live}/${CERTBOT_DOMAIN:-}
		if [ -n "${CERTBOT_DOMAIN:-}" ] && [ -f "$live/$cert" ] && [ -f "$live/$key" ]; then
			DIFY_PROXY_TLS_CERT=$live/$cert
			DIFY_PROXY_TLS_KEY=$live/$key
		else
			DIFY_PROXY_TLS_CERT=${DIFY_PROXY_SSL_DIR:-/etc/ssl}/$cert
			DIFY_PROXY_TLS_KEY=${DIFY_PROXY_SSL_DIR:-/etc/ssl}/$key
		fi
	fi

	DIFY_PROXY_ACME_CHALLENGE=off
	if [ "${NGINX_ENABLE_CERTBOT_CHALLENGE:-false}" = "true" ]; then
		DIFY_PROXY_ACME_CHALLENGE=on
	fi

	export DIFY_PROXY_MAX_BODY_SIZE DIFY_PROXY_READ_TIMEOUT DIFY_PROXY_SEND_TIMEOUT DIFY_PROXY_IDLE_TIMEOUT \
		DIFY_PROXY_TLS_PROTOCOLS DIFY_PROXY_SOCKET_IO_UPSTREAM DIFY_PROXY_HTTPS DIFY_PROXY_TLS_CERT \
		DIFY_PROXY_TLS_KEY DIFY_PROXY_ACME_CHALLENGE
}
