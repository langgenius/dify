FROM langgenius/base:1.0.0-bullseye-slim as langgenius-api

LABEL maintainer="takatost@gmail.com"

ENV FLASK_APP app.py
ENV EDITION SELF_HOSTED
ENV DEPLOY_ENV PRODUCTION
ENV CONSOLE_URL http://127.0.0.1:5001
ENV API_URL http://127.0.0.1:5001
ENV APP_URL http://127.0.0.1:5001

EXPOSE 5001

WORKDIR /app/api

COPY requirements.txt /app/api/requirements.txt

RUN pip install -r requirements.txt

COPY . /app/api/

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA ${COMMIT_SHA}

ENTRYPOINT ["/entrypoint.sh"]