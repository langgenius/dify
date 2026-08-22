ARG BENCH_RUNTIME_BASE_IMAGE
FROM ${BENCH_RUNTIME_BASE_IMAGE}

USER root
RUN mkdir -p /state && chown -R dify:dify /state
USER dify
