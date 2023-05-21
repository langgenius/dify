#!/bin/bash

[ ! -f .env ] || export $(grep -v '^#' .env | xargs)

export NEXT_PUBLIC_DEPLOY_ENV=${DEPLOY_ENV}
export NEXT_PUBLIC_EDITION=${EDITION}
export NEXT_PUBLIC_API_PREFIX=${CONSOLE_URL}/console/api
export NEXT_PUBLIC_PUBLIC_API_PREFIX=${APP_URL}/api
