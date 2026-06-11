FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tmux \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir \
        shell-session-manager==2.2.0 \
        uv

RUN useradd --create-home --shell /bin/sh dify

USER dify
WORKDIR /home/dify

EXPOSE 5004

CMD ["shellctl", "serve", "--listen", "0.0.0.0:5004"]
