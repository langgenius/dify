"""Configuration for the optional single-workspace KnowledgeFS bridge."""

from urllib.parse import urlsplit

from pydantic import Field, PositiveFloat, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings


class KnowledgeFSConfig(BaseSettings):
    """Server-only settings for the static single-workspace KnowledgeFS bridge."""

    KNOWLEDGE_FS_BASE_URL: str | None = Field(default=None, description="KnowledgeFS gateway base URL.")
    KNOWLEDGE_FS_API_TOKEN: SecretStr | None = Field(default=None, description="KnowledgeFS bearer token.")
    KNOWLEDGE_FS_STATIC_TENANT_ID: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Dify workspace bound to the static KnowledgeFS credential.",
    )
    KNOWLEDGE_FS_TIMEOUT_SECONDS: PositiveFloat = Field(default=10.0, le=60.0, allow_inf_nan=False)

    @field_validator(
        "KNOWLEDGE_FS_BASE_URL",
        "KNOWLEDGE_FS_API_TOKEN",
        "KNOWLEDGE_FS_STATIC_TENANT_ID",
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

    @field_validator("KNOWLEDGE_FS_BASE_URL")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must be an absolute HTTP(S) URL")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_complete_connection(self) -> "KnowledgeFSConfig":
        connection = (
            self.KNOWLEDGE_FS_BASE_URL,
            self.KNOWLEDGE_FS_API_TOKEN,
            self.KNOWLEDGE_FS_STATIC_TENANT_ID,
        )
        if any(connection) and not all(connection):
            raise ValueError(
                "KNOWLEDGE_FS_BASE_URL, KNOWLEDGE_FS_API_TOKEN, and KNOWLEDGE_FS_STATIC_TENANT_ID "
                "must be configured together"
            )
        return self
