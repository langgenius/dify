#!/bin/bash

set -e

export NEXT_PUBLIC_DEPLOY_ENV=${DEPLOY_ENV}
export NEXT_PUBLIC_EDITION=${EDITION}

if [[ -z "$CONSOLE_URL" ]]; then
  export NEXT_PUBLIC_API_PREFIX=${CONSOLE_API_URL}/console/api
else
  export NEXT_PUBLIC_API_PREFIX=${CONSOLE_URL}/console/api
fi

if [[ -z "$APP_URL" ]]; then
  export NEXT_PUBLIC_PUBLIC_API_PREFIX=${APP_API_URL}/api
else
  export NEXT_PUBLIC_PUBLIC_API_PREFIX=${APP_URL}/api
fi

export NEXT_PUBLIC_SENTRY_DSN=${SENTRY_DSN}

/usr/local/bin/pm2 -v
/usr/local/bin/pm2-runtime start /app/web/pm2.json
