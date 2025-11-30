# base image
FROM python:3.12-slim-bookworm AS base

WORKDIR /app/api

# Install uv
ENV UV_VERSION=0.8.9

RUN pip install --no-cache-dir uv==${UV_VERSION}


FROM base AS packages

# if you located in China, you can use aliyun mirror to speed up
# RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
          # basic environment
          g++ \
          # for building gmpy2
          libmpfr-dev libmpc-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml uv.lock ./
# Export without hashes because we'll build local wheels (hashes would mismatch)
RUN uv export --locked --no-dev --format requirements.txt --no-hashes --output-file /tmp/requirements.txt \
    && pip wheel --no-cache-dir -r /tmp/requirements.txt -w /wheels \
    && uv cache prune --ci

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

WORKDIR /app/api

# Create non-root user
ARG dify_uid=1001
RUN groupadd -r -g ${dify_uid} dify && \
    useradd -r -u ${dify_uid} -g ${dify_uid} -s /bin/bash dify && \
    chown -R dify:dify /app

RUN set -eux; \
    apt-get update; \
    # Install dependencies
    apt-get install -y --no-install-recommends \
        # basic environment
        curl nodejs \
        # for gmpy2 \
        libgmp-dev libmpfr-dev libmpc-dev \
        # For Security
        expat libldap-2.5-0=2.5.13+dfsg-5 perl libsqlite3-0=3.40.1-2+deb12u2 zlib1g=1:1.2.13.dfsg-1 \
        # install fonts to support the use of tools like pypdfium2
        fonts-noto-cjk \
        # install a package to improve the accuracy of guessing mime type and file extension
        media-types \
        # install libmagic to support the use of python-magic guess MIMETYPE
        libmagic1; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

# Install Python packages from prebuilt wheels (no virtualenv to avoid copying ~1.8GB layer)
COPY --from=packages /tmp/requirements.txt /tmp/requirements.txt
COPY --from=packages /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links /wheels -r /tmp/requirements.txt \
    && rm -rf /wheels /tmp/requirements.txt

ENV TIKTOKEN_CACHE_DIR=/app/api/.tiktoken_cache

# Pre-fetch NLTK data and warm tiktoken cache before copying source to maximize layer reuse
RUN set -eux; \
    mkdir -p /usr/local/share/nltk_data; \
    NLTK_DATA=/usr/local/share/nltk_data python -c "import nltk; nltk.download('punkt'); nltk.download('averaged_perceptron_tagger'); nltk.download('stopwords')"; \
    chmod -R 755 /usr/local/share/nltk_data; \
    python -c "import tiktoken; tiktoken.encoding_for_model('gpt2')"; \
    chown -R dify:dify ${TIKTOKEN_CACHE_DIR}

# Copy source code
COPY --chown=dify:dify . /app/api/

# Prepare entrypoint script
COPY --chown=dify:dify --chmod=755 docker/entrypoint.sh /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA=${COMMIT_SHA}
ENV NLTK_DATA=/usr/local/share/nltk_data

USER dify

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
