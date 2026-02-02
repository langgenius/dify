from pydantic import Field
from pydantic_settings import BaseSettings


class EnterpriseFeatureConfig(BaseSettings):
    """
    Configuration for enterprise-level features.
    **Before using, please contact business@dify.ai by email to inquire about licensing matters.**
    """

    ENTERPRISE_ENABLED: bool = Field(
        description="Enable or disable enterprise-level features."
        "Before using, please contact business@dify.ai by email to inquire about licensing matters.",
        default=False,
    )

    CAN_REPLACE_LOGO: bool = Field(
        description="Allow customization of the enterprise logo.",
        default=False,
    )


class EnterpriseTelemetryConfig(BaseSettings):
    """
    Configuration for enterprise telemetry.
    """

    ENTERPRISE_TELEMETRY_ENABLED: bool = Field(
        description="Enable enterprise telemetry collection (also requires ENTERPRISE_ENABLED=true).",
        default=False,
    )

    ENTERPRISE_OTLP_ENDPOINT: str = Field(
        description="Enterprise OTEL collector endpoint.",
        default="",
    )

    ENTERPRISE_OTLP_HEADERS: str = Field(
        description="Auth headers for OTLP export (key=value,key2=value2).",
        default="",
    )

    ENTERPRISE_INCLUDE_CONTENT: bool = Field(
        description="Include input/output content in traces (privacy toggle).",
        default=True,
    )

    ENTERPRISE_SERVICE_NAME: str = Field(
        description="Service name for OTEL resource.",
        default="dify",
    )

    ENTERPRISE_OTEL_SAMPLING_RATE: float = Field(
        description="Sampling rate for enterprise traces (0.0 to 1.0, default 1.0 = 100%).",
        default=1.0,
    )
