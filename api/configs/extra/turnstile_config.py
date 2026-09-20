from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings


class TurnstileConfig(BaseSettings):
    """Server-side Cloudflare Turnstile settings for Cloud sign-in."""

    TURNSTILE_SECRET_KEY: SecretStr | None = Field(
        default=None,
        description="Secret key used to validate Cloudflare Turnstile tokens.",
    )
    TURNSTILE_ALLOWED_HOSTNAMES: str = Field(
        default="",
        description="Comma-separated parent or exact hostnames accepted from Turnstile.",
    )
    TURNSTILE_EMAIL_CODE_VERIFY_REQUIRED: bool = Field(
        default=False,
        description=(
            "Require a separate Turnstile challenge when verifying email login codes on Dify Cloud. "
            "Enable after the compatible web client has been deployed."
        ),
    )

    @field_validator("TURNSTILE_SECRET_KEY", mode="before")
    @classmethod
    def normalize_secret_key(cls, value: object) -> object:
        if isinstance(value, SecretStr):
            normalized = value.get_secret_value().strip()
            return SecretStr(normalized) if normalized else None
        if isinstance(value, str):
            normalized = value.strip()
            return normalized or None
        return value

    @property
    def TURNSTILE_ALLOWED_HOSTNAME_SET(self) -> frozenset[str]:
        return frozenset(
            hostname.strip().lower().strip(".")
            for hostname in self.TURNSTILE_ALLOWED_HOSTNAMES.split(",")
            if hostname.strip().strip(".")
        )
