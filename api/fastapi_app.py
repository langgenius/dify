from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(
    title="Dify Console API (FastAPI)",
    version="1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class PingResponse(BaseModel):
    result: str = Field(description="Health check result", examples=["pong"])


@app.get("/console/api/ping", response_model=PingResponse, tags=["console"])
async def ping() -> PingResponse:
    """Health check endpoint for connection testing."""
    return PingResponse(result="pong")
