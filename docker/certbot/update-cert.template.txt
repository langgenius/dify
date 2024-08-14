#!/bin/bash
set -e

DOMAIN="${CERTBOT_DOMAIN}"
EMAIL="${CERTBOT_EMAIL}"
OPTIONS="${CERTBOT_OPTIONS}"
CERT_NAME="${DOMAIN}" # 証明書名をドメイン名と同じにする

# Check if the certificate already exists
if [ -f "/etc/letsencrypt/renewal/${CERT_NAME}.conf" ]; then
  echo "Certificate exists. Attempting to renew..."
  certbot renew --noninteractive --cert-name ${CERT_NAME} --webroot --webroot-path=/var/www/html --email ${EMAIL} --agree-tos --no-eff-email ${OPTIONS}
else
  echo "Certificate does not exist. Obtaining a new certificate..."
  certbot certonly --noninteractive --webroot --webroot-path=/var/www/html --email ${EMAIL} --agree-tos --no-eff-email -d ${DOMAIN} ${OPTIONS}
fi
echo "Certificate operation successful"
# Note: Nginx reload should be handled outside this container
echo "Please ensure to reload Nginx to apply any certificate changes."
