import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.account_avatar_service import AccountAvatarService
from services.account_errors import AvatarFileNotFoundError
from tests.unit_tests.model_factories import make_upload_file


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


@pytest.fixture
def files(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyAccountAvatarFileGateway:
    return SQLAlchemyAccountAvatarFileGateway(session_factory=sqlite_session_factory)


def test_resolve_passes_through_external_avatar_without_calling_gateway(
    files: SQLAlchemyAccountAvatarFileGateway,
    mocker: MockerFixture,
) -> None:
    get_owned_url = mocker.spy(files, "get_owned_signed_url")
    service = AccountAvatarService(files=files)

    result = service.resolve(_context(), "https://cdn.example/avatar.png")

    assert result == "https://cdn.example/avatar.png"
    get_owned_url.assert_not_called()


def test_resolve_returns_owned_signed_url(
    files: SQLAlchemyAccountAvatarFileGateway,
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id="file-1"))
    get_owned_url = mocker.spy(files, "get_owned_signed_url")
    sign_url = mocker.patch(
        "services.account_avatar_file_gateway.file_helpers.get_signed_file_url",
        return_value="https://signed.example/avatar",
    )
    service = AccountAvatarService(files=files)

    result = service.resolve(_context(), "file-1")

    assert result == "https://signed.example/avatar"
    sign_url.assert_called_once_with(upload_file_id="file-1")
    get_owned_url.assert_called_once_with(account_id="account-1", upload_file_id="file-1")


@pytest.mark.parametrize("exists", [False, True])
def test_resolve_rejects_missing_or_unowned_file(
    files: SQLAlchemyAccountAvatarFileGateway,
    sqlite_session_factory: sessionmaker[Session],
    exists: bool,
) -> None:
    if exists:
        with sqlite_session_factory.begin() as session:
            session.add(make_upload_file(file_id="file-1", created_by="another-account"))
    service = AccountAvatarService(files=files)

    with pytest.raises(AvatarFileNotFoundError):
        service.resolve(_context(), "file-1")
