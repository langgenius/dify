from pydantic import BaseModel, JsonValue


class RoutingModelConfig(BaseModel):
    """Resolved model settings required by knowledge-query planning."""

    mode: str
    parameters: dict[str, JsonValue]
    stop: list[str]
