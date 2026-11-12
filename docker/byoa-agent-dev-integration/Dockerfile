# QA only: prepare this minimal context with prepare_overlay.py from a committed
# integration revision. BASE_IMAGE must be an immutable local alias of the
# inspected live a69 image, never a moving deploy-agent tag.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=${SOURCE_REVISION} \
    dify.byoa.base-revision="a69a8fa067c8f476bf5f507ba47c390e0b02daf7" \
    dify.byoa.feature-revision="3aaed770679471596d0f02ff102491ddfb928361"

USER root
COPY validate_environment.py /app/byoa-dev-integration/validate_environment.py
RUN /app/api/.venv/bin/python /app/byoa-dev-integration/validate_environment.py snapshot

# This context's api/ contains only reviewed changed files, not the full tree.
# Existing source files outside the overlay and the venv remain in the base.
COPY --chown=dify:dify api/ /app/api/
COPY --chown=dify:dify packages/graphon/ /app/packages/graphon/
COPY overlay-manifest.json /app/byoa-dev-integration/overlay-manifest.json
# Inherit /entrypoint.sh byte-for-byte. Only the new worker may explicitly
# select /app/api/docker/entrypoint.sh through its own Compose entrypoint.

# Reinstall the same local versions so editable paths and the ten SDK provider
# entrypoints are real installed metadata. Do not resolve runtime dependencies,
# re-sync the project, or rebuild the base's existing litellm/native packages.
RUN /usr/local/bin/uv pip install --python /app/api/.venv/bin/python \
      --no-deps --no-build-isolation --reinstall \
      --editable /app/api/providers/trace/trace-sdk \
      --editable /app/api/providers/trace/trace-aliyun \
      --editable /app/api/providers/trace/trace-arize-phoenix \
      --editable /app/api/providers/trace/trace-langfuse \
      --editable /app/api/providers/trace/trace-langsmith \
      --editable /app/api/providers/trace/trace-mlflow \
      --editable /app/api/providers/trace/trace-opik \
      --editable /app/api/providers/trace/trace-tencent \
      --editable /app/api/providers/trace/trace-weave

# uv_build is absent from the live venv. Its isolated build environment is
# temporary; --no-deps still prevents any framework dependency installation.
RUN /usr/local/bin/uv pip install --python /app/api/.venv/bin/python \
      --no-deps --reinstall --editable /app/packages/graphon

RUN PYTHONPATH=/app/api /app/api/.venv/bin/python /app/byoa-dev-integration/validate_environment.py validate
ENV MIGRATION_ENABLED=false
USER dify
WORKDIR /app/api

