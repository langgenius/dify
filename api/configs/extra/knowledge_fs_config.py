"""Configuration for the optional KnowledgeFS control-plane integration."""

from ipaddress import ip_address
from urllib.parse import urlsplit

from pydantic import Field, PositiveFloat, PositiveInt, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings


class KnowledgeFSConfig(BaseSettings):
    """Server-only KnowledgeFS connection and rollout settings."""

    KNOWLEDGE_FS_ENABLED: bool = Field(
        default=False,
        description="Enable the private KnowledgeFS Console bridge.",
    )
    KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED: bool = Field(
        default=False,
        description="Enable delivery of durable KnowledgeFS lifecycle commands after every rollout gate is ready.",
    )
    KNOWLEDGE_FS_INTEGRATED_PROVISION_READY: bool = Field(
        default=False,
        description="Confirm that the Capability-v2 integrated provision route is deployed and verified.",
    )
    KNOWLEDGE_FS_LEGACY_ACL_FREEZE_READY: bool = Field(
        default=False,
        description="Confirm that legacy KFS ACL mutation is frozen for integrated mode.",
    )
    KNOWLEDGE_FS_LIFECYCLE_POLL_INTERVAL_SECONDS: PositiveInt = Field(default=15, le=300)
    KNOWLEDGE_FS_LIFECYCLE_LEASE_SECONDS: PositiveInt = Field(default=60, le=600)
    KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE: PositiveInt = Field(default=25, le=1_000)
    KNOWLEDGE_FS_BASE_URL: str | None = Field(default=None, description="KnowledgeFS gateway base URL.")
    KNOWLEDGE_FS_DIRECT_ORIGIN: str | None = Field(
        default=None,
        description="Public KnowledgeFS origin returned with direct upload capabilities.",
    )
    KNOWLEDGE_FS_CAPABILITY_V2_ENABLED: bool = Field(
        default=False,
        description="Prepare resource-scoped Capability v2 issuance; disabled until rollout approval.",
    )
    KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID: str | None = Field(
        default=None,
        description="Identifier for the current asymmetric Capability v2 signing key.",
    )
    KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM: SecretStr | None = Field(
        default=None,
        description="Server-only PEM for the current Capability v2 RSA signing key.",
    )
    KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS: str | None = Field(
        default=None,
        description="Optional public-only JWKS JSON retained during key rotation overlap.",
    )
    KNOWLEDGE_FS_CAPABILITY_V2_ISSUER: str = Field(default="dify-control-plane", min_length=1)
    KNOWLEDGE_FS_CAPABILITY_V2_AUDIENCE: str = Field(default="knowledge-fs", min_length=1)
    KNOWLEDGE_FS_CAPABILITY_V2_MAX_TTL_SECONDS: PositiveInt = Field(default=60, le=60)
    KNOWLEDGE_FS_JWKS_CACHE_MAX_AGE_SECONDS: PositiveInt = Field(default=300, le=86_400)
    KNOWLEDGE_FS_PRODUCT_MAX_RESPONSE_BYTES: PositiveInt = Field(default=4 * 1024 * 1024, le=16 * 1024 * 1024)
    KNOWLEDGE_FS_TIMEOUT_SECONDS: PositiveFloat = Field(default=10.0, le=60.0, allow_inf_nan=False)

    @field_validator(
        "KNOWLEDGE_FS_BASE_URL",
        "KNOWLEDGE_FS_DIRECT_ORIGIN",
        "KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID",
        "KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM",
        "KNOWLEDGE_FS_CAPABILITY_V2_PREVIOUS_PUBLIC_JWKS",
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
        return cls._validate_origin(value, name="KNOWLEDGE_FS_BASE_URL")

    @field_validator("KNOWLEDGE_FS_DIRECT_ORIGIN")
    @classmethod
    def validate_direct_origin(cls, value: str | None) -> str | None:
        return cls._validate_origin(value, name="KNOWLEDGE_FS_DIRECT_ORIGIN")

    @classmethod
    def _validate_origin(cls, value: str | None, *, name: str) -> str | None:
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"{name} must be an absolute HTTP(S) URL")
        try:
            _ = parsed.port
        except ValueError as exc:
            raise ValueError(f"{name} must include a valid port") from exc
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            raise ValueError(f"{name} must be an origin without credentials, path, query, or fragment")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_enabled_connection(self) -> "KnowledgeFSConfig":
        if str(getattr(self, "DEPLOY_ENV", "")).strip().upper() == "PRODUCTION":
            for name, value in (
                ("KNOWLEDGE_FS_BASE_URL", self.KNOWLEDGE_FS_BASE_URL),
                ("KNOWLEDGE_FS_DIRECT_ORIGIN", self.KNOWLEDGE_FS_DIRECT_ORIGIN),
            ):
                if value and not self._is_secure_or_loopback_origin(value):
                    raise ValueError(f"{name} must use HTTPS in production unless it targets loopback")
        if self.KNOWLEDGE_FS_ENABLED:
            if not self.KNOWLEDGE_FS_BASE_URL:
                raise ValueError("KnowledgeFS base URL is required when the integration is enabled")
            if not self.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED:
                raise ValueError("KnowledgeFS product routes require Capability v2 when enabled")
        if self.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED and not (
            self.KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID and self.KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM
        ):
            raise ValueError("Capability v2 signing kid and private key are required when issuance is enabled")
        return self

    @staticmethod
    def _is_secure_or_loopback_origin(value: str) -> bool:
        parsed = urlsplit(value)
        if parsed.scheme == "https":
            return True
        hostname = (parsed.hostname or "").rstrip(".").lower()
        if hostname == "localhost":
            return True
        try:
            return ip_address(hostname).is_loopback
        except ValueError:
            return False
