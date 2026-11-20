FROM python:3.13-slim-bookworm AS headless
RUN apt-get update && apt-get install -y --no-install-recommends chromium chromium-sandbox socat tini fonts-noto-cjk curl && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 browser
COPY docker/browser-mvp/browser/start.sh /usr/local/bin/start-browser
USER browser
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "sh", "/usr/local/bin/start-browser"]
FROM headless AS novnc
USER root
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*
USER browser
ENV BROWSER_MODE=novnc
