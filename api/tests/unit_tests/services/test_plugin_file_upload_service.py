import io
from unittest.mock import Mock, patch

import pytest

from services.errors.file import FileTooLargeError
from services.plugin_file_upload_service import (
    PluginFileUploadAccessDeniedError,
    PluginFileUploadFiles,
    PluginFileUploadOwnerQuery,
    PluginFileUploadResult,
    PluginFileUploadService,
    PluginUploadUserFrom,
)


def _result() -> PluginFileUploadResult:
    return PluginFileUploadResult(
        id="file-id",
        reference="reference",
        name="report.pdf",
        size=4,
        extension=".pdf",
        mime_type="application/pdf",
        preview_url="signed-url",
        source_url=None,
        original_url=None,
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id=None,
        file_key="file-key",
    )


@pytest.fixture
def owners() -> Mock:
    query = Mock(spec=PluginFileUploadOwnerQuery)
    query.owner_exists.return_value = True
    return query


@pytest.fixture
def files() -> Mock:
    gateway = Mock(spec=PluginFileUploadFiles)
    gateway.store.return_value = _result()
    return gateway


@pytest.fixture
def service(owners: Mock, files: Mock) -> PluginFileUploadService:
    return PluginFileUploadService(owners=owners, files=files)


def _upload(
    service: PluginFileUploadService,
    *,
    stream: io.BytesIO | Mock | None = None,
    user_id: str = "user-id",
    user_from: PluginUploadUserFrom = None,
    max_size: int | None = None,
) -> PluginFileUploadResult:
    return service.upload(
        stream=stream or io.BytesIO(b"data"),
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id=user_id,
        user_from=user_from,
        conversation_id="conversation-id",
        timestamp="123",
        nonce="nonce",
        sign="signature",
        max_size=max_size,
    )


@pytest.mark.parametrize("user_from", [None, "end-user", "account"])
def test_valid_ticket_authorizes_owner_then_stores_file(
    service: PluginFileUploadService,
    owners: Mock,
    files: Mock,
    user_from: PluginUploadUserFrom,
) -> None:
    stream = io.BytesIO(b"data")

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True) as verify:
        result = _upload(service, stream=stream, user_from=user_from)

    assert result == _result()
    verify.assert_called_once_with(
        filename="report.pdf",
        mimetype="application/pdf",
        tenant_id="tenant-id",
        user_id="user-id",
        conversation_id="conversation-id",
        user_from=user_from,
        timestamp="123",
        nonce="nonce",
        sign="signature",
        max_size=None,
    )
    owners.owner_exists.assert_called_once_with(
        tenant_id="tenant-id",
        user_id="user-id",
        user_from=user_from,
    )
    files.store.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        content=b"data",
        mimetype="application/pdf",
        filename="report.pdf",
    )


def test_invalid_signature_has_no_database_or_stream_side_effect(
    service: PluginFileUploadService,
    owners: Mock,
    files: Mock,
) -> None:
    stream = Mock()

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=False):
        with pytest.raises(PluginFileUploadAccessDeniedError):
            _upload(service, stream=stream)

    owners.owner_exists.assert_not_called()
    stream.read.assert_not_called()
    files.store.assert_not_called()


def test_unknown_owner_is_rejected_before_reading_or_storing(
    service: PluginFileUploadService,
    owners: Mock,
    files: Mock,
) -> None:
    stream = Mock()
    owners.owner_exists.return_value = False

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        with pytest.raises(PluginFileUploadAccessDeniedError):
            _upload(service, stream=stream, user_from="account")

    stream.read.assert_not_called()
    files.store.assert_not_called()


def test_signed_size_reads_only_one_byte_beyond_the_limit(
    service: PluginFileUploadService,
    files: Mock,
) -> None:
    stream = Mock()
    stream.read.return_value = b"data"

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        _upload(service, stream=stream, max_size=4)

    stream.read.assert_called_once_with(5)
    assert files.store.call_args.kwargs["content"] == b"data"


def test_zero_signed_size_accepts_an_empty_file(
    service: PluginFileUploadService,
    files: Mock,
) -> None:
    stream = Mock()
    stream.read.return_value = b""

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        _upload(service, stream=stream, max_size=0)

    stream.read.assert_called_once_with(1)
    assert files.store.call_args.kwargs["content"] == b""


@pytest.mark.parametrize(
    ("max_size", "content"),
    [
        pytest.param(4, b"12345", id="positive-limit"),
        pytest.param(0, b"1", id="zero-limit"),
    ],
)
def test_signed_size_rejects_oversized_content_before_storage(
    service: PluginFileUploadService,
    files: Mock,
    max_size: int,
    content: bytes,
) -> None:
    stream = Mock()
    stream.read.return_value = content

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        with pytest.raises(FileTooLargeError, match="signed upload limit"):
            _upload(service, stream=stream, max_size=max_size)

    stream.read.assert_called_once_with(max_size + 1)
    files.store.assert_not_called()
