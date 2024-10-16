#!/bin/sh
set -e

npm install
npx prisma generate
npm run build
npm run start

npx prisma init
printf '%s\n' "\nExecuting command:" "$@"
exec "$@"
