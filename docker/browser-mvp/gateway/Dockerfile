FROM python:3.13-slim-bookworm
RUN pip install --no-cache-dir aiohttp==3.14.4
COPY docker/browser-mvp/gateway/cdp_gateway.py /app/cdp_gateway.py
USER 1000:1000
ENTRYPOINT ["python", "/app/cdp_gateway.py"]
