#!/bin/sh
set -e

npm install
npm run build
npm run start

printf '%s\n' "\nExecuting command:" "$@"
exec "$@"
