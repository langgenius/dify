# base image
FROM node:18.17.0-alpine AS base

# install packages
FROM base as packages
LABEL maintainer="takatost@gmail.com"

WORKDIR /app/web

COPY package.json .
COPY yarn.lock .

RUN yarn --only=prod


# build resources
FROM base as builder
WORKDIR /app/web
COPY --from=packages /app/web/ .
COPY . .

RUN yarn build


# production stage
FROM base as production

ENV NODE_ENV production
ENV EDITION SELF_HOSTED
ENV DEPLOY_ENV PRODUCTION
ENV CONSOLE_API_URL http://127.0.0.1:5001
ENV APP_API_URL http://127.0.0.1:5001
ENV PORT 3000


WORKDIR /app/web
COPY --from=builder /app/web/public ./public
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static


COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ARG COMMIT_SHA
ENV COMMIT_SHA ${COMMIT_SHA}

EXPOSE 3000
ENTRYPOINT ["/bin/sh", "./entrypoint.sh"]