from pydantic import Field, PositiveFloat
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

    ENTERPRISE_API_TIMEOUT: PositiveFloat = Field(
        description="Timeout in seconds for requests to the enterprise inner API.",
        default=90.0,
    )
