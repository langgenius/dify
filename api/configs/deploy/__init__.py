from pydantic import BaseModel, Field


class DeploymentConfig(BaseModel):
    """
    Deployment configs
    """
    APPLICATION_NAME: str = Field(
        description='application name',
        default='langgenius/dify',
    )

    TESTING: bool = Field(
        description='',
        default=False,
    )

    EDITION: str = Field(
        description='deployment edition',
        default='SELF_HOSTED',
    )

    DEPLOY_ENV: str = Field(
        description='deployment environment, default to PRODUCTION.',
        default='PRODUCTION',
    )
