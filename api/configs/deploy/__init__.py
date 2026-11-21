from enum import StrEnum

from pydantic import Field
from pydantic_settings import BaseSettings

from enums import DeploymentEdition


class IMEventTransportMode(StrEnum):
    """Deployment-wide transport used for inbound IM provider events."""

    WEBHOOK = "WEBHOOK"
    STREAM = "STREAM"


class DeploymentConfig(BaseSettings):
    """
    Configuration settings for application deployment
    """

    APPLICATION_NAME: str = Field(
        description="Name of the application, used for identification and logging purposes",
        default="langgenius/dify",
    )

    DEBUG: bool = Field(
        description="Enable debug mode for additional logging and development features",
        default=False,
    )

    # Request logging configuration
    ENABLE_REQUEST_LOGGING: bool = Field(
        description="Enable request and response body logging",
        default=False,
    )

    DEPLOYMENT_EDITION: DeploymentEdition = Field(
        description="Product edition of the application.",
        default=DeploymentEdition.COMMUNITY,
    )

    HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE: IMEventTransportMode = Field(
        IMEventTransportMode.WEBHOOK,
        description="Required deployment-wide transport for Human Input IM provider events.",
    )

    INIT_PASSWORD: str = Field(
        description="Password required before initializing a self-hosted deployment",
        default="",
    )

    DEPLOY_ENV: str = Field(
        description="Deployment environment (e.g., 'PRODUCTION', 'DEVELOPMENT'), default to PRODUCTION",
        default="PRODUCTION",
    )

    GC_FREEZE_AFTER_STARTUP: bool = Field(
        description="Freeze the objects alive once an API or worker process has started. Each full garbage "
        "collection then scans request state instead of the whole process, so the longest collector pauses "
        "get shorter, but full collections run more often and total collector time is not lower",
        default=False,
    )
