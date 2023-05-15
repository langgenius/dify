#!/bin/bash

set -e

export NEXT_PUBLIC_DEPLOY_ENV=${DEPLOY_ENV}
export NEXT_PUBLIC_EDITION=${EDITION}
export NEXT_PUBLIC_API_PREFIX=${CONSOLE_URL}/console/api
export NEXT_PUBLIC_PUBLIC_API_PREFIX=${APP_URL}/api

/usr/local/bin/pm2 -v
/usr/local/bin/pm2-runtime start /app/web/pm2.json
