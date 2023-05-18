FROM node:18-bullseye-slim

LABEL maintainer="takatost@gmail.com"

ENV EDITION SELF_HOSTED
ENV DEPLOY_ENV PRODUCTION
ENV CONSOLE_URL http://127.0.0.1:5001
ENV APP_URL http://127.0.0.1:5001

EXPOSE 3000

RUN apt-get update && \
    apt-get install -y bash curl wget vim

RUN npm install pm2 -g

WORKDIR /app/web

COPY package.json /app/web/package.json

RUN npm install

COPY . /app/web/

RUN npm run build

COPY docker/pm2.json /app/web/pm2.json
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA ${COMMIT_SHA}

ENTRYPOINT ["/entrypoint.sh"]
