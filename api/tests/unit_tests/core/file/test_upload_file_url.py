from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.file import upload_file_url
from extensions.storage.storage_type import StorageType
from models.enums import UploadFilePurpose


def test_build_icon_url_uses_specialized_icon_file_resolver(monkeypatch: pytest.MonkeyPatch) -> None:
    resolve_url = MagicMock(return_value="https://icons.example.com/icon.png")
    monkeypatch.setattr(upload_file_url, "resolve_icon_file_url", resolve_url)

    result = upload_file_url.build_icon_url("image", "file-id")

    assert result == "https://icons.example.com/icon.png"
    resolve_url.assert_called_once_with("file-id")


def test_resolve_icon_file_url_uses_proxy_without_direct_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    has_direct_policy = MagicMock(return_value=False)
    proxy_url = MagicMock(return_value="https://api.example.com/files/icon/file-preview")
    create_session = MagicMock()
    monkeypatch.setattr(upload_file_url, "has_direct_upload_file_download_policy", has_direct_policy)
    monkeypatch.setattr(upload_file_url.file_helpers, "get_signed_file_url", proxy_url)
    monkeypatch.setattr(upload_file_url.session_factory, "create_session", create_session)

    result = upload_file_url.resolve_icon_file_url("icon-id")

    assert result == "https://api.example.com/files/icon/file-preview"
    has_direct_policy.assert_called_once_with(UploadFilePurpose.ICON)
    proxy_url.assert_called_once_with(upload_file_id="icon-id")
    create_session.assert_not_called()


def test_resolve_icon_file_url_uses_matching_direct_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    upload_file = SimpleNamespace(
        purpose=UploadFilePurpose.ICON,
        storage_type=StorageType.S3,
        key="public/upload_files/tenant/icon.png",
        mime_type="image/png",
    )
    policy = MagicMock()
    policy.generate_download_url.return_value = "https://icons.example.com/icon.png?verify=token"
    resolve_policy = MagicMock(return_value=policy)
    access_controller = MagicMock()
    access_controller.get_upload_file.return_value = upload_file
    proxy_url = MagicMock()
    monkeypatch.setattr(upload_file_url, "has_direct_upload_file_download_policy", lambda _: True)
    monkeypatch.setattr(upload_file_url, "resolve_upload_file_storage_policy", resolve_policy)
    monkeypatch.setattr(upload_file_url, "_file_access_controller", access_controller)
    monkeypatch.setattr(upload_file_url.session_factory, "create_session", lambda: nullcontext(session))
    monkeypatch.setattr(upload_file_url.file_helpers, "get_signed_file_url", proxy_url)

    result = upload_file_url.resolve_icon_file_url("icon-id")

    assert result == "https://icons.example.com/icon.png?verify=token"
    access_controller.get_upload_file.assert_called_once_with(session=session, file_id="icon-id")
    resolve_policy.assert_called_once_with(
        UploadFilePurpose.ICON,
        storage_type=StorageType.S3,
        key="public/upload_files/tenant/icon.png",
    )
    policy.generate_download_url.assert_called_once_with(
        "public/upload_files/tenant/icon.png",
        content_type="image/png",
    )
    proxy_url.assert_not_called()


def test_resolve_icon_file_url_keeps_non_icon_file_on_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    upload_file = SimpleNamespace(
        purpose=None,
        storage_type=StorageType.LOCAL,
        key="upload_files/tenant/file.png",
        mime_type="image/png",
    )
    access_controller = MagicMock()
    access_controller.get_upload_file.return_value = upload_file
    proxy_url = MagicMock(return_value="https://api.example.com/files/file/file-preview")
    monkeypatch.setattr(upload_file_url, "has_direct_upload_file_download_policy", lambda _: True)
    monkeypatch.setattr(upload_file_url, "_file_access_controller", access_controller)
    monkeypatch.setattr(upload_file_url.session_factory, "create_session", lambda: nullcontext(session))
    monkeypatch.setattr(upload_file_url.file_helpers, "get_signed_file_url", proxy_url)

    result = upload_file_url.resolve_icon_file_url("file-id")

    assert result == "https://api.example.com/files/file/file-preview"
    proxy_url.assert_called_once_with(upload_file_id="file-id")
