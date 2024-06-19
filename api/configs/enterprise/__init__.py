from pydantic import BaseModel, Field


class EnterpriseFeatureConfigs(BaseModel):
    """
    Enterprise feature configs.
    **Before using, please contact business@dify.ai by email to inquire about licensing matters.**
    """
    ENTERPRISE_ENABLED: bool = Field(
        description='whether to enable enterprise features.'
                    'Before using, please contact business@dify.ai by email to inquire about licensing matters.',
        default=False,
    )

    CAN_REPLACE_LOGO: bool = Field(
        description='whether to allow replacing enterprise logo.',
        default=False,
    )
