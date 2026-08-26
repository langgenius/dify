"""Configuration for the optional KnowledgeFS Console bridge."""

from urllib.parse import urlsplit

from pydantic import Field, PositiveFloat, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings


class KnowledgeFSConfig(BaseSettings):
    """Server-only settings for the KnowledgeFS production connection."""

    KNOWLEDGE_FS_ENABLED: bool = Field(
        default=False,
        description="Enable the private KnowledgeFS Console bridge.",
    )
    KNOWLEDGE_FS_BASE_URL: str | None = Field(default=None, description="KnowledgeFS gateway base URL.")
    KNOWLEDGE_FS_JWT_SECRET: SecretStr | None = Field(
        default=None,
        min_length=32,
        description="Shared secret used to sign short-lived KnowledgeFS service JWTs.",
    )
    KNOWLEDGE_FS_SSE_READ_TIMEOUT_SECONDS: PositiveFloat = Field(default=300.0, le=3600.0, allow_inf_nan=False)
    KNOWLEDGE_FS_TIMEOUT_SECONDS: PositiveFloat = Field(default=10.0, le=60.0, allow_inf_nan=False)

    @field_validator(
        "KNOWLEDGE_FS_BASE_URL",
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

    @field_validator("KNOWLEDGE_FS_BASE_URL")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must be an absolute HTTP(S) URL")
        try:
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must include a valid port") from exc
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must not include credentials, query, or fragment")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_enabled_connection(self) -> "KnowledgeFSConfig":
        if not self.KNOWLEDGE_FS_ENABLED:
            return self
        if bool(self.KNOWLEDGE_FS_BASE_URL) != bool(self.KNOWLEDGE_FS_JWT_SECRET):
            raise ValueError("KNOWLEDGE_FS_BASE_URL and KNOWLEDGE_FS_JWT_SECRET must be configured together")
        if not self.KNOWLEDGE_FS_BASE_URL:
            raise ValueError("KnowledgeFS connection settings are required when the integration is enabled")
        return self
