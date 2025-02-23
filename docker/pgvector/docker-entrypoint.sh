#!/bin/bash

PG_MAJOR=16

if [ "${PG_BIGM}" = "true" ]; then
  # install pg_bigm
  apt-get update
  apt-get install -y curl make gcc postgresql-server-dev-${PG_MAJOR}

  curl -LO https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz
  tar xf v${PG_BIGM_VERSION}.tar.gz
  cd pg_bigm-${PG_BIGM_VERSION} || exit 1
  make USE_PGXS=1 PG_CONFIG=/usr/bin/pg_config
  make USE_PGXS=1 PG_CONFIG=/usr/bin/pg_config install

  cd - || exit 1
  rm -rf v${PG_BIGM_VERSION}.tar.gz pg_bigm-${PG_BIGM_VERSION}

  # enable pg_bigm
  sed -i -e 's/^#\s*shared_preload_libraries.*/shared_preload_libraries = '\''pg_bigm'\''/' /var/lib/postgresql/data/pgdata/postgresql.conf
fi

# Run the original entrypoint script
exec /usr/local/bin/docker-entrypoint.sh postgres
