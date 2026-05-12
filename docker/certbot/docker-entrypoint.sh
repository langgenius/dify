#!/bin/sh
set -e

printf '%s\n' "Docker entrypoint script is running"

printf '\n%s\n' "Checking specific environment variables:"
printf '%s\n' "CERTBOT_EMAIL: ${CERTBOT_EMAIL:-Not set}"
printf '%s\n' "CERTBOT_DOMAIN: ${CERTBOT_DOMAIN:-Not set}"
printf '%s\n' "CERTBOT_OPTIONS: ${CERTBOT_OPTIONS:-Not set}"

printf '\n%s\n' "Checking mounted directories:"
for dir in "/etc/letsencrypt" "/var/www/html" "/var/log/letsencrypt"; do
    if [ -d "$dir" ]; then
        printf '%s\n' "$dir exists. Contents:"
        ls -la "$dir"
    else
        printf '%s\n' "$dir does not exist."
    fi
done

printf '\n%s\n' "Generating update-cert.sh from template"
sed -e "s|\${CERTBOT_EMAIL}|$CERTBOT_EMAIL|g" \
    -e "s|\${CERTBOT_DOMAIN}|$CERTBOT_DOMAIN|g" \
    -e "s|\${CERTBOT_OPTIONS}|$CERTBOT_OPTIONS|g" \
    /update-cert.template.txt > /update-cert.sh

chmod +x /update-cert.sh

printf '\n%s\n' "Executing command:"
printf '%s\n' "$@"
exec "$@"
