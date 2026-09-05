from pydantic import Field
from pydantic_settings import BaseSettings


class AwsKmsConfig(BaseSettings):
    """
    Configuration settings for AWS KMS, used as a tenant credential encryption key provider
    """

    AWS_KMS_KEY_ID: str | None = Field(
        description="Identifier of the symmetric KMS key used to wrap tenant data keys. Accepts a key id,"
        " key ARN, alias name ('alias/dify') or alias ARN. Required when KEY_PROVIDER_TYPE is set to"
        " 'aws-kms'. One key serves every tenant; tenants are separated by a KMS encryption context"
        " rather than by separate keys, so enabling automatic key rotation on it is safe and requires"
        " no re-encryption. Repointing an alias at a *different* key is not rotation in that sense:"
        " decryption is pinned to this configured identifier, so existing credentials would have to"
        " be re-encrypted first. Credentials are only ever wrapped with a data key, so the KMS key"
        " material never leaves KMS. Authentication uses the standard boto3 credential chain"
        " (instance role, environment variables, shared profile). Dify needs kms:GenerateDataKey and"
        " kms:Decrypt, and the policy granting them should name this key rather than Resource '*',"
        " so that a compromised database cannot point decryption at an attacker-supplied key.",
        default=None,
    )

    AWS_KMS_REGION: str | None = Field(
        description="AWS region hosting the KMS key. Leave unset to use the region boto3 resolves from the"
        " environment (AWS_REGION / AWS_DEFAULT_REGION, shared config, or instance metadata).",
        default=None,
    )

    AWS_KMS_ENDPOINT_URL: str | None = Field(
        description="Custom KMS endpoint URL. Leave unset for the public AWS endpoint. Set it to target a"
        " VPC interface endpoint, or a local KMS emulator when developing.",
        default=None,
    )
