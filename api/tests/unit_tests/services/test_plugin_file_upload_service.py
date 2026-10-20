import io
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.tools.tool_file_manager import ToolFileManager
from core.workflow.file_reference import build_file_reference
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from models.account import TenantAccountJoin, TenantAccountRole
from models.tools import ToolFile
from repositories.plugin_file_upload_repository import SQLAlchemyPluginFileUploadOwnerRepository
from services.errors.file import FileTooLargeError
from services.plugin_file_upload_gateway import ToolFilePluginUploadGateway
from services.plugin_file_upload_service import (
    PluginFileUploadAccessDeniedError,
    PluginFileUploadResult,
    PluginFileUploadService,
    PluginUploadUserFrom,
)
from tests.unit_tests.model_factories import make_account, make_end_user, make_tenant


@pytest.fixture
def owners(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyPluginFileUploadOwnerRepository:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                make_tenant(tenant_id="tenant-id"),
                make_account(account_id="user-id"),
                make_end_user(end_user_id="user-id", tenant_id="tenant-id"),
                TenantAccountJoin(tenant_id="tenant-id", account_id="user-id", role=TenantAccountRole.NORMAL),
            ]
        )
    return SQLAlchemyPluginFileUploadOwnerRepository(session_factory=sqlite_session_factory)


@pytest.fixture(autouse=True)
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("core.tools.tool_file_manager.storage", storage)
    return storage


@pytest.fixture
def files(mocker: MockerFixture) -> ToolFilePluginUploadGateway:
    mocker.patch("services.plugin_file_upload_gateway.sign_tool_file", return_value="signed-url")
    tool_files = ToolFileManager()
    return ToolFilePluginUploadGateway(tool_files=tool_files)


@pytest.fixture
def service(
    owners: SQLAlchemyPluginFileUploadOwnerRepository, files: ToolFilePluginUploadGateway
) -> PluginFileUploadService:
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
    owners: SQLAlchemyPluginFileUploadOwnerRepository,
    files: ToolFilePluginUploadGateway,
    user_from: PluginUploadUserFrom,
    storage: Storage,
    sqlite_session: Session,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    owner_exists = mocker.spy(owners, "owner_exists")
    stream = io.BytesIO(b"data")

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True) as verify:
        result = _upload(service, stream=stream, user_from=user_from)

    persisted = sqlite_session.get(ToolFile, result.id)
    assert persisted is not None
    assert result == PluginFileUploadResult(
        id=persisted.id,
        reference=build_file_reference(record_id=persisted.id),
        name="report.pdf",
        size=4,
        extension=".pdf",
        mime_type="application/pdf",
        preview_url="signed-url",
        source_url=None,
        original_url=None,
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        file_key=persisted.file_key,
    )
    assert storage.load_once(persisted.file_key) == b"data"
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
    owner_exists.assert_called_once_with(
        tenant_id="tenant-id",
        user_id="user-id",
        user_from=user_from,
    )
    store.assert_called_once_with(
        user_id="user-id",
        tenant_id="tenant-id",
        conversation_id="conversation-id",
        content=b"data",
        mimetype="application/pdf",
        filename="report.pdf",
    )


def test_invalid_signature_has_no_database_or_stream_side_effect(
    service: PluginFileUploadService,
    owners: SQLAlchemyPluginFileUploadOwnerRepository,
    files: ToolFilePluginUploadGateway,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    owner_exists = mocker.spy(owners, "owner_exists")
    stream = Mock()

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=False):
        with pytest.raises(PluginFileUploadAccessDeniedError):
            _upload(service, stream=stream)

    owner_exists.assert_not_called()
    stream.read.assert_not_called()
    store.assert_not_called()


def test_unknown_owner_is_rejected_before_reading_or_storing(
    service: PluginFileUploadService,
    files: ToolFilePluginUploadGateway,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    stream = Mock()

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        with pytest.raises(PluginFileUploadAccessDeniedError):
            _upload(service, stream=stream, user_id="unknown-user", user_from="account")

    stream.read.assert_not_called()
    store.assert_not_called()


def test_signed_size_reads_only_one_byte_beyond_the_limit(
    service: PluginFileUploadService,
    files: ToolFilePluginUploadGateway,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    stream = Mock()
    stream.read.return_value = b"data"

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        _upload(service, stream=stream, max_size=4)

    stream.read.assert_called_once_with(5)
    assert store.call_args.kwargs["content"] == b"data"


def test_zero_signed_size_accepts_an_empty_file(
    service: PluginFileUploadService,
    files: ToolFilePluginUploadGateway,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    stream = Mock()
    stream.read.return_value = b""

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        _upload(service, stream=stream, max_size=0)

    stream.read.assert_called_once_with(1)
    assert store.call_args.kwargs["content"] == b""


@pytest.mark.parametrize(
    ("max_size", "content"),
    [
        pytest.param(4, b"12345", id="positive-limit"),
        pytest.param(0, b"1", id="zero-limit"),
    ],
)
def test_signed_size_rejects_oversized_content_before_storage(
    service: PluginFileUploadService,
    files: ToolFilePluginUploadGateway,
    max_size: int,
    content: bytes,
    mocker: MockerFixture,
) -> None:
    store = mocker.spy(files, "store")
    stream = Mock()
    stream.read.return_value = content

    with patch("services.plugin_file_upload_service.verify_plugin_file_signature", return_value=True):
        with pytest.raises(FileTooLargeError, match="signed upload limit"):
            _upload(service, stream=stream, max_size=max_size)

    stream.read.assert_called_once_with(max_size + 1)
    store.assert_not_called()
