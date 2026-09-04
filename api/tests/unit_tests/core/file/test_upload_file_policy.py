import base64
import hashlib
import hmac
from collections.abc import Callable
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest

from configs import dify_config
from configs.extra.public_storage_config import PublicStorageDownloadMode, PublicStoragePolicyConfig
from core.file import upload_file_policy
from core.file.upload_file_policy import UploadFileStoragePolicy
from extensions.storage.storage_type import StorageType
from models.enums import UploadFilePurpose


def _configure_icon_s3_policy(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    *,
    enabled: bool = True,
    download_mode: PublicStorageDownloadMode = "proxy",
) -> None:
    policy_config = PublicStoragePolicyConfig(
        download_mode=download_mode,
        download_url_expires_in=300,
        cf_waf_hmac_base_url="https://icons.example.com",
        cf_waf_hmac_secret="unit-secret",
    )
    config_overrides(PUBLIC_STORAGE_POLICIES={"ICON": {StorageType.S3: policy_config}})
    policy_storage = MagicMock() if enabled else None
    monkeypatch.setattr(upload_file_policy.public_storage, "get", lambda *_: policy_storage)


def test_resolve_upload_file_storage_policy_matches_purpose_storage_type_and_key(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    _configure_icon_s3_policy(monkeypatch, config_overrides, download_mode="presigned")

    policy = upload_file_policy.resolve_upload_file_storage_policy(
        UploadFilePurpose.ICON,
        storage_type=StorageType.S3,
        key="public/upload_files/tenant/icon.png",
    )

    assert policy is not None
    assert policy.purpose == UploadFilePurpose.ICON
    assert policy.storage_type == StorageType.S3
    assert policy.download_mode == "presigned"
    assert (
        upload_file_policy.resolve_upload_file_storage_policy(
            UploadFilePurpose.ICON,
            storage_type=StorageType.LOCAL,
            key="public/upload_files/tenant/icon.png",
        )
        is None
    )
    assert (
        upload_file_policy.resolve_upload_file_storage_policy(
            UploadFilePurpose.ICON,
            storage_type=StorageType.S3,
            key="upload_files/tenant/icon.png",
        )
        is None
    )
    assert upload_file_policy.resolve_upload_file_storage_policy(None) is None


def test_resolve_upload_file_storage_policy_excludes_disabled_policy(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> None:
    _configure_icon_s3_policy(monkeypatch, config_overrides, enabled=False)

    assert upload_file_policy.resolve_upload_file_storage_policy(UploadFilePurpose.ICON) is None
    assert (
        upload_file_policy.resolve_upload_file_storage_policy(
            UploadFilePurpose.ICON,
            include_disabled=True,
        )
        is not None
    )


def test_upload_file_storage_policy_generates_presigned_url() -> None:
    storage = MagicMock()
    storage.generate_presigned_url.return_value = "https://signed.example.com/icon.png"
    policy = UploadFileStoragePolicy(
        purpose=UploadFilePurpose.ICON,
        storage_type=StorageType.S3,
        storage=storage,
        key_prefix="public/upload_files/",
        enabled=True,
        download_mode="presigned",
        download_url_expires_in=600,
    )

    result = policy.generate_download_url("public/upload_files/tenant/icon.png", content_type="image/png")

    assert result == "https://signed.example.com/icon.png"
    storage.generate_presigned_url.assert_called_once_with(
        "public/upload_files/tenant/icon.png",
        expires_in=600,
        content_type="image/png",
    )


def test_upload_file_storage_policy_generates_cloudflare_waf_hmac_url() -> None:
    policy = UploadFileStoragePolicy(
        purpose=UploadFilePurpose.ICON,
        storage_type=StorageType.S3,
        storage=MagicMock(),
        key_prefix="public/upload_files/",
        enabled=True,
        download_mode="cf_waf_hmac",
        download_url_expires_in=300,
        cf_waf_hmac_base_url="https://icons.example.com/assets",
        cf_waf_hmac_secret="unit-secret",
    )

    with patch("core.file.upload_file_policy.time.time", return_value=1700000000):
        result = policy.generate_download_url("public/upload_files/tenant/icon name.png")

    assert result is not None
    parsed = urlparse(result)
    assert parsed.path == "/assets/public/upload_files/tenant/icon%20name.png"
    expected_mac = base64.b64encode(
        hmac.new(
            b"unit-secret",
            f"{parsed.path}1700000000".encode(),
            hashlib.sha256,
        ).digest()
    ).decode()
    assert parse_qs(parsed.query) == {"verify": [f"1700000000-{expected_mac}"]}


def test_has_direct_upload_file_download_policy(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    _configure_icon_s3_policy(monkeypatch, config_overrides, download_mode="proxy")
    assert upload_file_policy.has_direct_upload_file_download_policy(UploadFilePurpose.ICON) is False

    dify_config.PUBLIC_STORAGE_POLICIES["ICON"][StorageType.S3].download_mode = "presigned"
    assert upload_file_policy.has_direct_upload_file_download_policy(UploadFilePurpose.ICON) is True
