import base64
import hashlib
import hmac
import time
import urllib.parse
from dataclasses import dataclass
from typing import Literal

from configs import dify_config
from extensions.ext_storage import Storage, public_storage
from extensions.storage.storage_type import StorageType
from models.enums import UploadFilePurpose

type UploadFileDownloadMode = Literal["proxy", "presigned", "cf_waf_hmac"]

PUBLIC_UPLOAD_FILE_KEY_PREFIX = "public/upload_files/"


@dataclass(frozen=True, slots=True)
class UploadFileStoragePolicy:
    purpose: UploadFilePurpose
    storage_type: StorageType
    storage: Storage
    key_prefix: str
    enabled: bool
    download_mode: UploadFileDownloadMode
    download_url_expires_in: int
    cf_waf_hmac_base_url: str | None = None
    cf_waf_hmac_secret: str | None = None

    def owns_key(self, key: str) -> bool:
        return key.startswith(self.key_prefix)

    def generate_download_url(self, key: str, *, content_type: str | None = None) -> str | None:
        if self.download_mode == "proxy":
            return None
        if self.download_mode == "presigned":
            return self.storage.generate_presigned_url(
                key,
                expires_in=self.download_url_expires_in,
                content_type=content_type,
            )
        return self._generate_cf_waf_hmac_url(key)

    def _generate_cf_waf_hmac_url(self, key: str) -> str:
        if self.cf_waf_hmac_base_url is None or self.cf_waf_hmac_secret is None:
            raise RuntimeError("Cloudflare WAF HMAC download mode is not configured")

        encoded_key = urllib.parse.quote(key.lstrip("/"), safe="/")
        unsigned_url = f"{self.cf_waf_hmac_base_url.rstrip('/')}/{encoded_key}"
        parsed_url = urllib.parse.urlsplit(unsigned_url)
        # Cloudflare interprets this as the issue time; the WAF rule owns expiration.
        timestamp = str(int(time.time()))
        digest = hmac.new(
            self.cf_waf_hmac_secret.encode(),
            f"{parsed_url.path}{timestamp}".encode(),
            hashlib.sha256,
        ).digest()
        token = base64.b64encode(digest).decode()
        query = urllib.parse.urlencode({"verify": f"{timestamp}-{token}"})
        return urllib.parse.urlunsplit(parsed_url._replace(query=query))


def _configured_upload_file_storage_policies() -> tuple[UploadFileStoragePolicy, ...]:
    return (
        UploadFileStoragePolicy(
            purpose=UploadFilePurpose.ICON,
            storage_type=StorageType.S3,
            storage=public_storage,
            key_prefix=PUBLIC_UPLOAD_FILE_KEY_PREFIX,
            enabled=public_storage.enabled,
            download_mode=dify_config.PUBLIC_STORAGE_ICON_S3_DOWNLOAD_MODE,
            download_url_expires_in=dify_config.PUBLIC_STORAGE_ICON_S3_DOWNLOAD_URL_EXPIRES_IN,
            cf_waf_hmac_base_url=dify_config.PUBLIC_STORAGE_ICON_S3_CF_WAF_HMAC_BASE_URL,
            cf_waf_hmac_secret=dify_config.PUBLIC_STORAGE_ICON_S3_CF_WAF_HMAC_SECRET,
        ),
    )


def resolve_upload_file_storage_policy(
    purpose: UploadFilePurpose | None,
    *,
    storage_type: StorageType | None = None,
    key: str | None = None,
    include_disabled: bool = False,
) -> UploadFileStoragePolicy | None:
    if purpose is None:
        return None

    for policy in _configured_upload_file_storage_policies():
        if policy.purpose != purpose:
            continue
        if not include_disabled and not policy.enabled:
            continue
        if storage_type is not None and policy.storage_type != storage_type:
            continue
        if key is not None and not policy.owns_key(key):
            continue
        return policy
    return None


def has_direct_upload_file_download_policy() -> bool:
    return any(
        policy.enabled and policy.download_mode != "proxy" for policy in _configured_upload_file_storage_policies()
    )
