from pydantic import Field
from pydantic_settings import BaseSettings

from enums import DeploymentEdition


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

    INIT_PASSWORD: str = Field(
        description="Password required before initializing a self-hosted deployment",
        default="",
    )

    DEPLOY_ENV: str = Field(
        description="Deployment environment (e.g., 'PRODUCTION', 'DEVELOPMENT'), default to PRODUCTION",
        default="PRODUCTION",
    )
