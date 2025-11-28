# syntax=docker/dockerfile:1
# check=error=true

####################################################################################
# base image
FROM python:3.12-slim-bookworm AS base

WORKDIR /app/api

# Install uv
ENV UV_VERSION=0.8.9

RUN pip install --no-cache-dir uv==${UV_VERSION}

####################################################################################
FROM base AS packages

# if you located in China, you can use aliyun mirror to speed up
# RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources

RUN <<EOF
    apt-get update
    apt-get install -y --no-install-recommends \
        # basic environment
        g++ \
        libmpfr-dev libmpc-dev
EOF

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

####################################################################################
# production stage
FROM base AS production

ENV FLASK_APP=app.py
ENV EDITION=SELF_HOSTED
ENV DEPLOY_ENV=PRODUCTION
ENV CONSOLE_API_URL=http://127.0.0.1:5001
ENV CONSOLE_WEB_URL=http://127.0.0.1:3000
ENV SERVICE_API_URL=http://127.0.0.1:5001
ENV APP_WEB_URL=http://127.0.0.1:3000

EXPOSE 5001

# set timezone
ENV TZ=UTC

# Set UTF-8 locale
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV PYTHONIOENCODING=utf-8
# NLTK_DATA environment variable for NLTK data, refering to https://www.nltk.org/data.html#interactive-installer
ENV NLTK_DATA=/usr/local/share/nltk_data
ENV TIKTOKEN_CACHE_DIR=/app/api/.tiktoken_cache

WORKDIR /app/api

# Create non-root user
ARG dify_uid=1001
RUN <<EOF
    groupadd -r -g ${dify_uid} dify
    useradd -r -u ${dify_uid} -g ${dify_uid} -s /bin/bash dify
    chown -R dify:dify /app
EOF

RUN <<EOF
    set -ex
    apt-get update
    # Install dependencies
    apt-get install -y --no-install-recommends \
        curl nodejs \
        libgmp-dev libmpfr-dev libmpc-dev \
        expat libldap-2.5-0=2.5.13+dfsg-5 perl libsqlite3-0=3.40.1-2+deb12u2 zlib1g=1:1.2.13.dfsg-1 \
        fonts-noto-cjk \
        media-types \
        libmagic1
    apt-get autoremove -y
    rm -rf /var/lib/apt/lists/*
EOF

# Copy Python environment and packages
ENV VIRTUAL_ENV=/app/api/.venv
COPY --from=packages --chown=dify:dify ${VIRTUAL_ENV} ${VIRTUAL_ENV}
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

RUN <<EOF
    set -ex

    # Download nltk data
    mkdir -p ${NLTK_DATA}
    python -c "import nltk; nltk.download('punkt'); nltk.download('averaged_perceptron_tagger'); nltk.download('stopwords')"
    chmod -R 755 ${NLTK_DATA}

    # Preload tiktoken encodings
    python -c "import tiktoken; tiktoken.encoding_for_model('gpt2')"
    chown -R dify:dify ${TIKTOKEN_CACHE_DIR}
EOF

# Copy source code
COPY --chown=dify:dify . /app/api/

# Prepare entrypoint script
COPY --chown=dify:dify --chmod=755 docker/entrypoint.sh /entrypoint.sh


ARG COMMIT_SHA
ENV COMMIT_SHA=${COMMIT_SHA}

# Switch to non-root user
USER dify

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
