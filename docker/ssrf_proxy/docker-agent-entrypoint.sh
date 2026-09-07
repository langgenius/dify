#!/bin/bash

tail -F /var/log/squid/access.log 2>/dev/null &
tail -F /var/log/squid/error.log 2>/dev/null &
tail -F /var/log/squid/store.log 2>/dev/null &
tail -F /var/log/squid/cache.log 2>/dev/null &

expand_env() {
    awk '{
        while(match($0, /\${[A-Za-z_][A-Za-z_0-9]*}/)) {
            var = substr($0, RSTART+2, RLENGTH-3)
            val = ENVIRON[var]
            $0 = substr($0, 1, RSTART-1) val substr($0, RSTART+RLENGTH)
        }
        print
    }' "$1"
}

export SSRF_PROXY_CONNECT_TIMEOUT="${SSRF_PROXY_CONNECT_TIMEOUT:-${HTTP_REQUEST_MAX_CONNECT_TIMEOUT:-30}}"
export SSRF_PROXY_REQUEST_TIMEOUT="${SSRF_PROXY_REQUEST_TIMEOUT:-${HTTP_REQUEST_MAX_READ_TIMEOUT:-600}}"
export SSRF_PROXY_READ_TIMEOUT="${SSRF_PROXY_READ_TIMEOUT:-${HTTP_REQUEST_MAX_READ_TIMEOUT:-600}}"

echo "[ENTRYPOINT] replacing environment variables in the templates"
expand_env /etc/squid/squid.conf.template > /etc/squid/squid.conf
expand_env /etc/squid/dify_common.conf.template > /etc/squid/dify_common.conf

/usr/sbin/squid -Nz
echo "[ENTRYPOINT] starting squid"
/usr/sbin/squid -f /etc/squid/squid.conf -NYC 1
