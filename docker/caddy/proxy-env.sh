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

	# Visitor address from trusted proxies (CDN, load balancer), like Nginx's real_ip module.
	DIFY_PROXY_CLIENT_IP=direct
	DIFY_PROXY_TRUSTED_PROXIES=$(echo "${CADDY_TRUSTED_PROXIES:-}" | tr ',' ' ')
	DIFY_PROXY_CLIENT_IP_HEADERS=$(echo "${CADDY_CLIENT_IP_HEADERS:-X-Forwarded-For}" | tr ',' ' ')
	for range in $DIFY_PROXY_TRUSTED_PROXIES; do
		case $range in
			0.0.0.0/0 | ::/0 | 0::/0)
				echo "CADDY_TRUSTED_PROXIES must not contain $range: any client could choose its own IP." >&2
				return 1
				;;
		esac
		DIFY_PROXY_CLIENT_IP=trusted
	done

	# Certificates obtained and renewed by Caddy itself (ACME), stored in /data.
	DIFY_PROXY_AUTO_HTTPS=off
	DIFY_PROXY_ACME_CA=${CADDY_ACME_CA:-https://acme-v02.api.letsencrypt.org/directory}
	DIFY_PROXY_ACME_SITES=""
	for domain in $(echo "${CADDY_AUTO_HTTPS_DOMAINS:-}" | tr ',' ' '); do
		DIFY_PROXY_ACME_SITES="${DIFY_PROXY_ACME_SITES:+$DIFY_PROXY_ACME_SITES, }$domain"
	done
	if [ -n "$DIFY_PROXY_ACME_SITES" ]; then
		if [ "$DIFY_PROXY_HTTPS" = files ]; then
			echo "Set either CADDY_AUTO_HTTPS_DOMAINS or NGINX_HTTPS_ENABLED=true, not both." >&2
			return 1
		fi
		DIFY_PROXY_HTTPS=acme
		DIFY_PROXY_AUTO_HTTPS=disable_redirects
	fi

	DIFY_PROXY_ACME_CHALLENGE=off
	if [ "${NGINX_ENABLE_CERTBOT_CHALLENGE:-false}" = "true" ]; then
		DIFY_PROXY_ACME_CHALLENGE=on
	fi

	export DIFY_PROXY_MAX_BODY_SIZE DIFY_PROXY_READ_TIMEOUT DIFY_PROXY_SEND_TIMEOUT DIFY_PROXY_IDLE_TIMEOUT \
		DIFY_PROXY_TLS_PROTOCOLS DIFY_PROXY_SOCKET_IO_UPSTREAM DIFY_PROXY_HTTPS DIFY_PROXY_TLS_CERT \
		DIFY_PROXY_TLS_KEY DIFY_PROXY_ACME_CHALLENGE DIFY_PROXY_CLIENT_IP DIFY_PROXY_TRUSTED_PROXIES \
		DIFY_PROXY_CLIENT_IP_HEADERS DIFY_PROXY_AUTO_HTTPS DIFY_PROXY_ACME_CA DIFY_PROXY_ACME_SITES
}
