from pydantic import BaseModel, Field

from controllers.fastopenapi import console_router


class PingResponse(BaseModel):
    result: str = Field(description="Health check result", examples=["pong"])


@console_router.get(
    "/ping",
    response_model=PingResponse,
    tags=["console"],
)
def ping() -> PingResponse:
    """Health check endpoint for connection testing."""
    return PingResponse(result="pong")
