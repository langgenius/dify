"""Configuration for the optional KnowledgeFS Console bridge."""

from urllib.parse import urlsplit

from pydantic import Field, PositiveFloat, PositiveInt, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings


class KnowledgeFSConfig(BaseSettings):
    """Server-only settings for JWT production auth or static local auth."""

    KNOWLEDGE_FS_BASE_URL: str | None = Field(default=None, description="KnowledgeFS gateway base URL.")
    KNOWLEDGE_FS_API_TOKEN: SecretStr | None = Field(default=None, description="KnowledgeFS bearer token.")
    KNOWLEDGE_FS_STATIC_TENANT_ID: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Dify workspace bound to the static KnowledgeFS credential.",
    )
    KNOWLEDGE_FS_JWT_SECRET: SecretStr | None = Field(
        default=None,
        min_length=32,
        description="Shared secret used only to sign short-lived KnowledgeFS service JWTs.",
    )
    KNOWLEDGE_FS_JWT_ISSUER: str = Field(default="dify", min_length=1, max_length=255)
    KNOWLEDGE_FS_JWT_AUDIENCE: str = Field(default="knowledge-fs", min_length=1, max_length=255)
    KNOWLEDGE_FS_JWT_TTL_SECONDS: PositiveInt = Field(default=60, le=300)
    KNOWLEDGE_FS_TIMEOUT_SECONDS: PositiveFloat = Field(default=10.0, le=60.0, allow_inf_nan=False)

    @field_validator(
        "KNOWLEDGE_FS_BASE_URL",
        "KNOWLEDGE_FS_API_TOKEN",
        "KNOWLEDGE_FS_STATIC_TENANT_ID",
        "KNOWLEDGE_FS_JWT_SECRET",
        mode="before",
    )
    @classmethod
    def normalize_optional_string(cls, value: object) -> object:
        if isinstance(value, SecretStr):
            normalized = value.get_secret_value().strip()
            return SecretStr(normalized) if normalized else None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @field_validator("KNOWLEDGE_FS_JWT_ISSUER", "KNOWLEDGE_FS_JWT_AUDIENCE", mode="before")
    @classmethod
    def normalize_required_string(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("KNOWLEDGE_FS_BASE_URL")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must be an absolute HTTP(S) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must not include credentials, query, or fragment")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_complete_connection(self) -> "KnowledgeFSConfig":
        static_auth = (self.KNOWLEDGE_FS_API_TOKEN, self.KNOWLEDGE_FS_STATIC_TENANT_ID)
        if any(static_auth) and not all(static_auth):
            raise ValueError("KNOWLEDGE_FS_API_TOKEN and KNOWLEDGE_FS_STATIC_TENANT_ID must be configured together")
        if self.KNOWLEDGE_FS_JWT_SECRET is not None and any(static_auth):
            raise ValueError("KnowledgeFS JWT and static authentication modes must not be configured together")
        auth_configured = self.KNOWLEDGE_FS_JWT_SECRET is not None or all(static_auth)
        if bool(self.KNOWLEDGE_FS_BASE_URL) != bool(auth_configured):
            raise ValueError(
                "KNOWLEDGE_FS_BASE_URL and one complete KnowledgeFS authentication mode must be configured together"
            )
        return self
