# base image
FROM node:20-alpine3.20 AS base
LABEL maintainer="takatost@gmail.com"

# if you located in China, you can use aliyun mirror to speed up
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

RUN apk add --no-cache tzdata


# install packages
FROM base AS packages

WORKDIR /app/web

COPY package.json .
COPY yarn.lock .

# if you located in China, you can use taobao registry to speed up
# RUN yarn install --frozen-lockfile --registry https://registry.npmmirror.com/

RUN yarn install --frozen-lockfile

# build resources
FROM base AS builder
WORKDIR /app/web
COPY --from=packages /app/web/ .
COPY . .

RUN yarn build


# production stage
FROM base AS production

ENV NODE_ENV=production
ENV EDITION=SELF_HOSTED
ENV DEPLOY_ENV=PRODUCTION
ENV CONSOLE_API_URL=http://127.0.0.1:5001
ENV APP_API_URL=http://127.0.0.1:5001
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

# set timezone
ENV TZ=UTC
RUN ln -s /usr/share/zoneinfo/${TZ} /etc/localtime \
    && echo ${TZ} > /etc/timezone


WORKDIR /app/web
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static

COPY docker/pm2.json ./pm2.json
COPY docker/entrypoint.sh ./entrypoint.sh


# global runtime packages
RUN yarn global add pm2 \
    && yarn cache clean \
    && mkdir /.pm2 \
    && chown -R 1001:0 /.pm2 /app/web \
    && chmod -R g=u /.pm2 /app/web


ARG COMMIT_SHA
ENV COMMIT_SHA=${COMMIT_SHA}

USER 1001
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]
