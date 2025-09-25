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

    UPLOAD_KNOWLEDGE_PIPELINE_TEMPLATE_TOKEN: str = Field(
        description="Token for uploading knowledge pipeline template.",
        default="",
    )

    KNOWLEDGE_PIPELINE_TEMPLATE_COPYRIGHT: str = Field(
        description="Knowledge pipeline template copyright.",
        default="Copyright 2023 Dify",
    )

    KNOWLEDGE_PIPELINE_TEMPLATE_PRIVACY_POLICY: str = Field(
        description="Knowledge pipeline template privacy policy.",
        default="https://dify.ai",
    )
