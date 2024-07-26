#!/bin/sh
set -e

echo "Docker entrypoint script is running"

echo "\nChecking specific environment variables:"
echo "CERTBOT_EMAIL: ${CERTBOT_EMAIL:-Not set}"
echo "CERTBOT_DOMAIN: ${CERTBOT_DOMAIN:-Not set}"
echo "CERTBOT_OPTIONS: ${CERTBOT_OPTIONS:-Not set}"

echo "\nChecking mounted directories:"
for dir in "/etc/letsencrypt" "/var/www/html" "/var/log/letsencrypt"; do
    if [ -d "$dir" ]; then
        echo "$dir exists. Contents:"
        ls -la "$dir"
    else
        echo "$dir does not exist."
    fi
done

echo "\nGenerating update-cert.sh from template"
sed -e "s|\${CERTBOT_EMAIL}|$CERTBOT_EMAIL|g" \
    -e "s|\${CERTBOT_DOMAIN}|$CERTBOT_DOMAIN|g" \
    -e "s|\${CERTBOT_OPTIONS}|$CERTBOT_OPTIONS|g" \
    /update-cert.sh.template > /update-cert.sh

chmod +x /update-cert.sh

echo "\nExecuting command:" "$@"
