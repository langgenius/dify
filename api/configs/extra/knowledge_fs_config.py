"""Configuration for the optional KnowledgeFS service integration."""

import base64
import binascii
from typing import Literal
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from pydantic import Field, PositiveFloat, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings


class KnowledgeFSConfig(BaseSettings):
    """Server-side KnowledgeFS connection settings.

    The integration is disabled when all connection and authentication fields
    are absent. Enabled deployments must choose exactly one explicit auth
    profile so production cannot silently fall back to a shared tenant token.
    The development token is bound to one explicit Dify workspace tenant.
    """

    KNOWLEDGE_FS_AUTH_MODE: Literal["dify-jwt", "dev-static"] | None = Field(
        description="Authentication profile: per-request Dify JWT or explicit single-tenant development token.",
        default=None,
    )
    KNOWLEDGE_FS_BASE_URL: str | None = Field(
        description="Base URL of the KnowledgeFS gateway.",
        default=None,
    )
    KNOWLEDGE_FS_API_TOKEN: SecretStr | None = Field(
        description="Server-only bearer token used to authenticate to KnowledgeFS.",
        default=None,
    )
    KNOWLEDGE_FS_STATIC_TENANT_ID: str | None = Field(
        description="Dify workspace tenant id bound to the single-tenant development token.",
        default=None,
        min_length=1,
        max_length=255,
    )
    KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN: bool = Field(
        description=(
            "Allow one process-level token for the explicitly configured static tenant. "
            "This is only safe for local development or an explicitly single-workspace deployment."
        ),
        default=False,
    )
    KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64: SecretStr | None = Field(
        description="Base64-encoded PKCS#8 PEM RSA private key dedicated to KnowledgeFS JWT signing.",
        default=None,
    )
    KNOWLEDGE_FS_JWT_KEY_ID: str | None = Field(
        description="Key identifier matching a public key in the KnowledgeFS local JWKS.",
        default=None,
    )
    KNOWLEDGE_FS_JWT_ISSUER: str | None = Field(
        description="Issuer bound to this Dify deployment.",
        default=None,
    )
    KNOWLEDGE_FS_JWT_AUDIENCE: str = Field(
        description="Audience accepted by KnowledgeFS for Dify tenant assertions.",
        default="knowledge-fs",
        min_length=1,
        max_length=256,
    )
    KNOWLEDGE_FS_JWT_TTL_SECONDS: int = Field(
        description="Lifetime of each request-scoped KnowledgeFS JWT.",
        default=60,
        ge=10,
        le=60,
    )
    KNOWLEDGE_FS_TIMEOUT_SECONDS: PositiveFloat = Field(
        description="Finite timeout of at most 60 seconds for KnowledgeFS list and create requests.",
        default=10.0,
        le=60.0,
        allow_inf_nan=False,
    )

    @field_validator(
        "KNOWLEDGE_FS_AUTH_MODE",
        "KNOWLEDGE_FS_BASE_URL",
        "KNOWLEDGE_FS_API_TOKEN",
        "KNOWLEDGE_FS_STATIC_TENANT_ID",
        "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64",
        "KNOWLEDGE_FS_JWT_KEY_ID",
        "KNOWLEDGE_FS_JWT_ISSUER",
        mode="before",
    )
    @classmethod
    def normalize_optional_string(cls, value: object) -> object:
        """Treat blank optional values as absent and trim configured values."""
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
        """Require an explicit HTTP(S) origin before the integration is enabled."""
        if value is None:
            return None
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("KNOWLEDGE_FS_BASE_URL must be an absolute HTTP(S) URL")
        return value.rstrip("/")

    @field_validator("KNOWLEDGE_FS_JWT_AUDIENCE")
    @classmethod
    def normalize_audience(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("KNOWLEDGE_FS_JWT_AUDIENCE must not be blank")
        return normalized

    @field_validator("KNOWLEDGE_FS_JWT_KEY_ID")
    @classmethod
    def validate_key_id(cls, value: str | None) -> str | None:
        has_invalid_character = value is not None and not all(
            character.isalnum() or character in "._-" for character in value
        )
        if value is not None and (len(value) > 128 or has_invalid_character):
            raise ValueError("KNOWLEDGE_FS_JWT_KEY_ID must use 1-128 letters, digits, dot, underscore, or hyphen")
        return value

    @field_validator("KNOWLEDGE_FS_JWT_ISSUER")
    @classmethod
    def validate_issuer(cls, value: str | None) -> str | None:
        if value is not None and len(value) > 256:
            raise ValueError("KNOWLEDGE_FS_JWT_ISSUER must not exceed 256 characters")
        return value

    @field_validator("KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64")
    @classmethod
    def validate_private_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        encoded = value.get_secret_value()
        if len(encoded) > 32_768:
            raise ValueError("KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64 exceeds the 32 KiB configuration limit")
        try:
            pem = base64.b64decode(encoded, validate=True)
            private_key = serialization.load_pem_private_key(pem, password=None)
        except (ValueError, TypeError, binascii.Error) as exc:
            raise ValueError("KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64 must contain an unencrypted PKCS#8 PEM key") from exc
        if not isinstance(private_key, RSAPrivateKey):
            raise ValueError("KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64 must contain an RSA private key")
        if private_key.key_size < 2048:
            raise ValueError("KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64 requires an RSA key of at least 2048 bits")
        return value

    @model_validator(mode="after")
    def validate_auth_profile(self) -> "KnowledgeFSConfig":
        auth_fields_present = any(
            (
                self.KNOWLEDGE_FS_AUTH_MODE,
                self.KNOWLEDGE_FS_BASE_URL,
                self.KNOWLEDGE_FS_API_TOKEN,
                self.KNOWLEDGE_FS_STATIC_TENANT_ID,
                self.KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64,
                self.KNOWLEDGE_FS_JWT_KEY_ID,
                self.KNOWLEDGE_FS_JWT_ISSUER,
            )
        )
        if not auth_fields_present:
            if self.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN:
                raise ValueError("KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN requires the dev-static auth profile")
            return self

        if self.KNOWLEDGE_FS_BASE_URL is None:
            raise ValueError("KNOWLEDGE_FS_BASE_URL is required when KnowledgeFS authentication is configured")
        if self.KNOWLEDGE_FS_AUTH_MODE is None:
            raise ValueError("KNOWLEDGE_FS_AUTH_MODE is required when KnowledgeFS is enabled")

        jwt_fields = {
            "KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64": self.KNOWLEDGE_FS_JWT_PRIVATE_KEY_B64,
            "KNOWLEDGE_FS_JWT_KEY_ID": self.KNOWLEDGE_FS_JWT_KEY_ID,
            "KNOWLEDGE_FS_JWT_ISSUER": self.KNOWLEDGE_FS_JWT_ISSUER,
        }
        if self.KNOWLEDGE_FS_AUTH_MODE == "dify-jwt":
            missing = next((name for name, value in jwt_fields.items() if value is None), None)
            if missing is not None:
                raise ValueError(f"{missing} is required for the dify-jwt auth profile")
            if self.KNOWLEDGE_FS_API_TOKEN is not None:
                raise ValueError("KNOWLEDGE_FS_API_TOKEN cannot be combined with the dify-jwt auth profile")
            if self.KNOWLEDGE_FS_STATIC_TENANT_ID is not None:
                raise ValueError("KNOWLEDGE_FS_STATIC_TENANT_ID cannot be combined with the dify-jwt auth profile")
            if self.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN:
                raise ValueError("KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN cannot be enabled for dify-jwt")
            return self

        if self.KNOWLEDGE_FS_API_TOKEN is None:
            raise ValueError("KNOWLEDGE_FS_API_TOKEN is required for the dev-static auth profile")
        if self.KNOWLEDGE_FS_STATIC_TENANT_ID is None:
            raise ValueError("KNOWLEDGE_FS_STATIC_TENANT_ID is required for the dev-static auth profile")
        if not self.KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN:
            raise ValueError("KNOWLEDGE_FS_ALLOW_SHARED_TENANT_TOKEN must be enabled for dev-static")
        configured_jwt_field = next((name for name, value in jwt_fields.items() if value is not None), None)
        if configured_jwt_field is not None:
            raise ValueError(f"{configured_jwt_field} cannot be combined with the dev-static auth profile")
        return self
