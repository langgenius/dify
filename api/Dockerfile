# base image
FROM python:3.12-slim-bookworm AS base

WORKDIR /app/api

# Install uv
ENV UV_VERSION=0.6.14

RUN pip install --no-cache-dir uv==${UV_VERSION}


FROM base AS packages

# if you located in China, you can use aliyun mirror to speed up
# RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libc-dev libffi-dev libgmp-dev libmpfr-dev libmpc-dev libfreetype6-dev

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --locked

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

WORKDIR /app/api

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    curl \
    nodejs \
    libgmp-dev \
    libmpfr-dev \
    libmpc-dev \
    libglib2.0-0 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libpangocairo-1.0-0 \
    libharfbuzz0b \
    libharfbuzz-gobject0 \
    libharfbuzz-icu0 \
    libharfbuzz-subset0 \
    libcairo2 \
    libcairo-gobject2 \
    libcairo-script-interpreter2 \
    libcairo2-dev \
    libpango1.0-dev \
    libpangocairo-1.0-0 \
    libpangoxft-1.0-0 \
    # if you located in China, you can use aliyun mirror to speed up
    # && echo "deb http://mirrors.aliyun.com/debian testing main" > /etc/apt/sources.list \
    # Don't replace the sources.list file, create a separate testing.list file
    && echo "deb http://deb.debian.org/debian testing main" > /etc/apt/sources.list.d/testing.list \
    # Create apt preferences to prioritize main repository
    && echo 'Package: *\nPin: release a=bookworm\nPin-Priority: 900\n\nPackage: *\nPin: release a=testing\nPin-Priority: 400' > /etc/apt/preferences.d/priority \
    && apt-get update \
    # For Security
    && apt-get install -y --no-install-recommends expat libldap-2.5-0 perl libsqlite3-0 zlib1g \
    # install a chinese font to support the use of tools like matplotlib
    && apt-get install -y fonts-noto-cjk \
    # Add libmagic1 installation - specify version from bookworm
    && apt-get install -y -t bookworm libmagic1 libmagic-mgc \
    # Install dependencies
    && apt-get install -y --no-install-recommends \
    # basic environment
    curl nodejs libgmp-dev libmpfr-dev libmpc-dev \
    # For Security
    expat libldap-2.5-0 perl libsqlite3-0 zlib1g \
    # install a chinese font to support the use of tools like matplotlib
    fonts-noto-cjk \
    # install a package to improve the accuracy of guessing mime type and file extension
    media-types \
    # install libmagic to support the use of python-magic guess MIMETYPE
    libmagic1 \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy Python environment and packages
ENV VIRTUAL_ENV=/app/api/.venv
COPY --from=packages ${VIRTUAL_ENV} ${VIRTUAL_ENV}
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

# Download nltk data
RUN python -c "import nltk; nltk.download('punkt'); nltk.download('averaged_perceptron_tagger')"

ENV TIKTOKEN_CACHE_DIR=/app/api/.tiktoken_cache

RUN python -c "import tiktoken; tiktoken.encoding_for_model('gpt2')"

# Copy source code
COPY . /app/api/

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA=${COMMIT_SHA}

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]
