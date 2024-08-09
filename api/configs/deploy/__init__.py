from pydantic import Field
from pydantic_settings import BaseSettings


class DeploymentConfig(BaseSettings):
    """
    Deployment configs
    """
    APPLICATION_NAME: str = Field(
        description='application name',
        default='ChatBot',
    )

    TESTING: bool = Field(
        description='',
        default=False,
    )

    EDITION: str = Field(
        description='deployment edition',
        default='CLOUD',
    )

    DEPLOY_ENV: str = Field(
        description='deployment environment, default to PRODUCTION.',
        default='PRODUCTION',
    )
