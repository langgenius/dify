#!/bin/bash

# Simplified entrypoint for the dedicated agent_ssrf_proxy container.
# The squid-agent.conf.template is a self-contained static config — no dynamic
# include files are needed. We only forward logs to stdout and expand
# environment variables in the templates.

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

echo "[ENTRYPOINT] replacing environment variables in the templates"
expand_env /etc/squid/squid.conf.template > /etc/squid/squid.conf
expand_env /etc/squid/dify_common.conf.template > /etc/squid/dify_common.conf

/usr/sbin/squid -Nz
echo "[ENTRYPOINT] starting squid"
/usr/sbin/squid -f /etc/squid/squid.conf -NYC 1
