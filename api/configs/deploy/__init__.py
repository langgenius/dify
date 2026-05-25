from pydantic import Field
from pydantic_settings import BaseSettings


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

    EDITION: str = Field(
        description="Deployment edition of the application (e.g., 'SELF_HOSTED', 'CLOUD')",
        default="SELF_HOSTED",
    )

    DEPLOY_ENV: str = Field(
        description="Deployment environment (e.g., 'PRODUCTION', 'DEVELOPMENT'), default to PRODUCTION",
        default="PRODUCTION",
    )

    # Blueprint registration toggles for independent Studio / Console deployment.
    # Both default to True so existing installations are unchanged.

    ENABLE_CONSOLE_API: bool = Field(
        description="Register the /console/api blueprint (Explore, billing, datasets, auth, workspace).",
        default=True,
    )

    ENABLE_STUDIO_API: bool = Field(
        description="Register the /studio/api blueprint (app management, workflow editor, agent).",
        default=True,
    )
