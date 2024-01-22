# packages install stage
FROM python:3.10-slim AS base

LABEL maintainer="takatost@gmail.com"

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ python3-dev libc-dev libffi-dev

COPY requirements.txt /requirements.txt

RUN pip install --prefix=/pkg -r requirements.txt

# build stage
FROM python:3.10-slim AS builder


ENV FLASK_APP app.py
ENV EDITION SELF_HOSTED
ENV DEPLOY_ENV PRODUCTION
ENV CONSOLE_API_URL http://127.0.0.1:5001
ENV CONSOLE_WEB_URL http://127.0.0.1:3000
ENV SERVICE_API_URL http://127.0.0.1:5001
ENV APP_WEB_URL http://127.0.0.1:3000

EXPOSE 5001

# set timezone
ENV TZ UTC

WORKDIR /app/api

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash curl wget vim nodejs ffmpeg \
    && apt-get autoremove \
    && rm -rf /var/lib/apt/lists/*

COPY --from=base /pkg /usr/local
COPY . /app/api/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA ${COMMIT_SHA}

ENTRYPOINT ["/bin/bash", "/entrypoint.sh"]