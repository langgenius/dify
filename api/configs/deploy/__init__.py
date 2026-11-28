from enum import StrEnum
from typing import Final, NamedTuple

from pydantic import Field
from pydantic_settings import BaseSettings

from enums import DeploymentEdition


class IMEventTransportMode(StrEnum):
    """Deployment-wide transport used for inbound IM provider events."""

    WEBHOOK = "WEBHOOK"
    STREAM = "STREAM"


class _EndUserAuthDefaults(NamedTuple):
    allow_anonymous: bool
    account_passport_enabled: bool


# Bootstrap profiles supply omitted setting values; they do not grant feature access.
_END_USER_AUTH_DEFAULTS: Final = {
    DeploymentEdition.COMMUNITY: _EndUserAuthDefaults(allow_anonymous=True, account_passport_enabled=False),
    DeploymentEdition.ENTERPRISE: _EndUserAuthDefaults(allow_anonymous=False, account_passport_enabled=False),
    DeploymentEdition.CLOUD: _EndUserAuthDefaults(allow_anonymous=False, account_passport_enabled=True),
}


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

    @property
    def _end_user_auth_defaults(self) -> _EndUserAuthDefaults:
        """Return the settings profile after validation has resolved the deployment edition."""
        return _END_USER_AUTH_DEFAULTS[self.DEPLOYMENT_EDITION]

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
