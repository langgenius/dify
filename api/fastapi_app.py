"""ASGI entrypoint for the standalone FastAPI/API v2 app."""

from api_fastapi.factory import create_fastapi_app

app = create_fastapi_app()
