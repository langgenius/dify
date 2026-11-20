FROM python:3.13-slim-bookworm
WORKDIR /app
COPY docker/browser-mvp/fixture/server.py docker/browser-mvp/fixture/portal.html ./
USER 1000:1000
CMD ["python", "server.py"]
