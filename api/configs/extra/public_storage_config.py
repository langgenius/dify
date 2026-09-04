import urllib.parse
from collections.abc import Mapping
from typing import Any, Literal, override

from pydantic import BaseModel, Field, PositiveInt, model_validator
from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

from enums.storage_type import StorageType

type PublicStorageDownloadMode = Literal["proxy", "presigned", "cf_waf_hmac"]
type PublicStoragePolicies = dict[str, dict[StorageType, "PublicStoragePolicyConfig"]]

PUBLIC_STORAGE_POLICIES_FIELD = "PUBLIC_STORAGE_POLICIES"
PUBLIC_STORAGE_POLICY_PREFIX = "PUBLIC_STORAGE_"
PUBLIC_STORAGE_POLICY_OPTIONS = {
    "BUCKET": "bucket",
    "DOWNLOAD_MODE": "download_mode",
    "DOWNLOAD_URL_EXPIRES_IN": "download_url_expires_in",
    "CF_WAF_HMAC_BASE_URL": "cf_waf_hmac_base_url",
    "CF_WAF_HMAC_SECRET": "cf_waf_hmac_secret",
}


class PublicStoragePolicyConfig(BaseModel):
    bucket: str | None = None
    download_mode: PublicStorageDownloadMode = "proxy"
    download_url_expires_in: PositiveInt = 300
    cf_waf_hmac_base_url: str | None = None
    cf_waf_hmac_secret: str | None = None

    def validate_policy(self) -> None:
        if self.download_mode == "cf_waf_hmac" and not all((self.cf_waf_hmac_base_url, self.cf_waf_hmac_secret)):
            raise ValueError("Cloudflare WAF HMAC download configuration is incomplete")

        if self.cf_waf_hmac_base_url:
            parsed_base_url = urllib.parse.urlsplit(self.cf_waf_hmac_base_url)
            if (
                parsed_base_url.scheme not in {"http", "https"}
                or not parsed_base_url.netloc
                or parsed_base_url.query
                or parsed_base_url.fragment
            ):
                raise ValueError("Cloudflare WAF HMAC base URL must be an HTTP(S) URL without a query or fragment")


def parse_public_storage_policy_settings(values: Mapping[str, Any]) -> dict[str, Any]:
    """Parse PUBLIC_STORAGE_<PURPOSE>_<STORAGE_TYPE>_<OPTION> settings."""
    policies: dict[str, dict[StorageType, dict[str, Any]]] = {}
    storage_types = sorted(StorageType, key=lambda item: len(item.name), reverse=True)
    options = sorted(PUBLIC_STORAGE_POLICY_OPTIONS.items(), key=lambda item: len(item[0]), reverse=True)

    for raw_name, value in values.items():
        name = raw_name.upper()
        if not name.startswith(PUBLIC_STORAGE_POLICY_PREFIX):
            continue

        policy_name = name.removeprefix(PUBLIC_STORAGE_POLICY_PREFIX)
        option_name: str | None = None
        option_field: str | None = None
        for candidate_name, candidate_field in options:
            suffix = f"_{candidate_name}"
            if policy_name.endswith(suffix):
                policy_name = policy_name.removesuffix(suffix)
                option_name = candidate_name
                option_field = candidate_field
                break
        if option_name is None or option_field is None:
            continue

        storage_type: StorageType | None = None
        purpose_name: str | None = None
        for candidate in storage_types:
            suffix = f"_{candidate.name}"
            if policy_name.endswith(suffix):
                storage_type = candidate
                purpose_name = policy_name.removesuffix(suffix)
                break
        if storage_type is None or not purpose_name:
            continue

        storage_policies = policies.setdefault(purpose_name, {})
        policy = storage_policies.setdefault(storage_type, {})
        policy[option_field] = value

    if not policies:
        return {}
    return {PUBLIC_STORAGE_POLICIES_FIELD: policies}


class PublicStoragePolicySettingsSource(PydanticBaseSettingsSource):
    def __init__(self, settings_cls: type[BaseSettings], values: Mapping[str, Any]):
        super().__init__(settings_cls)
        self._values = values

    @override
    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise NotImplementedError

    @override
    def __call__(self) -> dict[str, Any]:
        return parse_public_storage_policy_settings(self._values)


class PublicStorageConfig(BaseSettings):
    """Configuration for optional public S3-compatible upload storage."""

    PUBLIC_STORAGE_ENABLED: bool = Field(
        default=False,
        description=(
            "Store public upload purposes in dedicated S3-compatible buckets. Enabling, disabling, or changing an "
            "active policy requires an operational data migration for affected files."
        ),
    )
    PUBLIC_STORAGE_ENDPOINT: str | None = Field(
        default=None,
        description="S3-compatible endpoint for public uploads.",
    )
    PUBLIC_STORAGE_REGION: str = Field(
        default="auto",
        description="Region for public upload storage.",
    )
    PUBLIC_STORAGE_ACCESS_KEY: str | None = Field(
        default=None,
        description="Access key for public upload storage.",
    )
    PUBLIC_STORAGE_SECRET_KEY: str | None = Field(
        default=None,
        description="Secret key for public upload storage.",
    )
    PUBLIC_STORAGE_ADDRESS_STYLE: Literal["auto", "virtual", "path"] = Field(
        default="path",
        description="S3 addressing style for public upload storage.",
    )
    PUBLIC_STORAGE_POLICIES: PublicStoragePolicies = Field(
        default_factory=dict,
        description="Upload storage policies keyed by purpose and storage type.",
    )

    @model_validator(mode="after")
    def validate_public_storage_policies(self) -> "PublicStorageConfig":
        if not self.PUBLIC_STORAGE_ENABLED:
            return self
        if not self.PUBLIC_STORAGE_POLICIES:
            raise ValueError("PUBLIC_STORAGE_ENABLED requires at least one public storage policy")
        for storage_policies in self.PUBLIC_STORAGE_POLICIES.values():
            for policy in storage_policies.values():
                policy.validate_policy()
        return self
