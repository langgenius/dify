"""Gunicorn configuration tuned for asyncio workers."""

worker_class = "uvicorn.workers.UvicornWorker"
