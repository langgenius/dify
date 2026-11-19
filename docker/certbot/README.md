# Launching new servers with SSL certificates

Run the following commands from `docker/`. The optional `certbot` profile obtains and renews certificates when you invoke its update script; it does not schedule renewals automatically.

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
   docker compose --profile certbot up -d --no-deps --force-recreate caddy
   ```
   Then you can access your server with HTTPS.\
   [https://your_domain.com](https://your_domain.com)

## SSL certificates renewal

For SSL certificates renewal, execute commands below:

```shell
docker compose exec -it certbot /bin/sh /update-cert.sh
docker compose exec caddy sh /etc/caddy/docker-entrypoint.sh reload
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

Then, reload the reverse proxy if necessary.

```shell
docker compose exec caddy sh /etc/caddy/docker-entrypoint.sh reload
```

## Without Certbot or with Nginx

Caddy can also [obtain the certificates itself](../README.md#let-caddy-obtain-https-certificates),
which makes Certbot unnecessary. When [running Nginx instead of Caddy](../README.md#run-nginx-instead-of-caddy),
replace `caddy` with `nginx` in the `up` commands above and reload with
`docker compose exec nginx nginx -s reload`.

## For legacy servers

To use cert files dir `nginx/ssl` as before, simply launch containers WITHOUT `--profile certbot` option.

```shell
docker compose up -d
```
