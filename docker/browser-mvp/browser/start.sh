#!/bin/sh
set -eu
# CDP is reachable only on the dedicated browser network; never publish this port.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &
set -- --user-data-dir=/home/browser/profile --no-first-run --no-default-browser-check --disable-features=Translate --remote-debugging-port=9222 --window-size=1440,1000
if [ -n "${BROWSER_PROXY_SERVER:-}" ]; then
 set -- "$@" "--proxy-server=$BROWSER_PROXY_SERVER" "--proxy-bypass-list=${BROWSER_PROXY_BYPASS:-}"
fi
if [ "${BROWSER_MODE:-headless}" = novnc ]; then
 export DISPLAY=:99
 Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp &
 sleep 1
 x11vnc -display :99 -forever -shared -rfbauth /run/secrets/vnc_password -listen 127.0.0.1 -rfbport 5900 >/tmp/vnc.log 2>&1 &
 websockify --web /usr/share/novnc 6080 127.0.0.1:5900 &
else
 set -- --headless=new "$@"
fi
exec chromium "$@" "${BROWSER_START_URL:-about:blank}"
