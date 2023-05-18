FROM python:3.10.11-slim-bullseye

LABEL maintainer="takatost@gmail.com"

ENV FLASK_APP app.py
ENV EDITION SELF_HOSTED
ENV DEPLOY_ENV PRODUCTION
ENV CONSOLE_URL http://127.0.0.1:5001
ENV API_URL http://127.0.0.1:5001
ENV APP_URL http://127.0.0.1:5001

EXPOSE 5001

RUN apt-get update && \
    apt-get install -y bash curl wget vim gcc g++ python3-dev libc-dev libffi-dev postgresql python-psycopg2 libpq-dev

RUN pip3 install gunicorn

WORKDIR /app/api

COPY requirements.txt /app/api/requirements.txt

RUN pip install -r requirements.txt

COPY . /app/api/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA ${COMMIT_SHA}

ENTRYPOINT ["/entrypoint.sh"]