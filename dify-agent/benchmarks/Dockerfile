# Harness image shared by both local Runtime modes.
FROM python:3.12-slim-bookworm AS base

WORKDIR /app/dify-agent

ENV UV_VERSION=0.8.9
RUN pip install --no-cache-dir uv==${UV_VERSION}

COPY dify-agent/pyproject.toml dify-agent/uv.lock dify-agent/README.md ./
COPY dify-agent/src ./src
RUN uv sync --frozen --no-dev --no-editable --extra server

COPY dify-agent/benchmarks ./benchmarks

ENV VIRTUAL_ENV=/app/dify-agent/.venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"
ENV PYTHONPATH=/app/dify-agent
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "benchmarks.capacity_driver"]
