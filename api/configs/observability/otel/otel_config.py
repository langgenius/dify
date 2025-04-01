
from pydantic import Field
from pydantic_settings import BaseSettings


class OTelConfig(BaseSettings):
    """
    OpenTelemetry configuration settings
    """

    ENABLE_OTEL: bool = Field(
        description="Whether to enable OpenTelemetry",
        default=False,
    )


    OTLP_BASE_ENDPOINT: str = Field(
        description="OTLP base endpoint",
        default="http://localhost:4318",
    )

    OTLP_API_KEY: str = Field(
        description="OTLP API key",
        default="",
    )
    
    OTEL_EXPORTER_TYPE: str = Field(
        description="OTEL exporter type",
        default="console",
    )