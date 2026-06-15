# Launching new servers with SSL certificates

## Short description

docker compose certbot configurations with Backward compatibility (without certbot container).\
Use `docker compose --profile certbot up` to use this features.

## The simplest way for launching new servers with SSL certificates

1. Get letsencrypt certs\
   set `.env` values
   ```properties
   NGINX_SSL_CERT_FILENAME=fullchain.pem
   NGINX_SSL_CERT_KEY_FILENAME=privkey.pem
   NGINX_ENABLE_CERTBOT_CHALLENGE=true
   CERTBOT_DOMAIN=your_domain.com
   CERTBOT_EMAIL=example@your_domain.com
   ```
   execute command:
   ```shell
   docker network prune
   docker compose --profile certbot up --force-recreate -d
   ```
   then after the containers launched:
   ```shell
   docker compose exec -it certbot /bin/sh /update-cert.sh
   ```
1. Edit `.env` file and `docker compose --profile certbot up` again.\
   set `.env` value additionally
   ```properties
   NGINX_HTTPS_ENABLED=true
   ```
   execute command:
   ```shell
   docker compose --profile certbot up -d --no-deps --force-recreate nginx
   ```
   Then you can access your serve with HTTPS.\
   [https://your_domain.com](https://your_domain.com)

## SSL certificates renewal

For SSL certificates renewal, execute commands below:

```shell
docker compose exec -it certbot /bin/sh /update-cert.sh
docker compose exec nginx nginx -s reload
```

## Options for certbot

`CERTBOT_OPTIONS` key might be helpful for testing. i.e.,

```properties
CERTBOT_OPTIONS=--dry-run
```

To apply changes to `CERTBOT_OPTIONS`, regenerate the certbot container before updating the certificates.

```shell
docker compose --profile certbot up -d --no-deps --force-recreate certbot
docker compose exec -it certbot /bin/sh /update-cert.sh
```

Then, reload the nginx container if necessary.

```shell
docker compose exec nginx nginx -s reload
```

## For legacy servers

To use cert files dir `nginx/ssl` as before, simply launch containers WITHOUT `--profile certbot` option.

```shell
docker compose up -d
```
