from collections.abc import Callable
from urllib.parse import urlsplit
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from services.account_avatar_file_gateway import SQLAlchemyAccountAvatarFileGateway
from services.account_avatar_service import AccountAvatarService
from services.account_errors import AvatarFileNotFoundError
from tests.helpers.unit.model_factories import make_upload_file

_ACCOUNT_ID = "11111111-1111-1111-1111-111111111111"


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id=_ACCOUNT_ID,
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


def test_resolve_still_previews_unassigned_uploads_with_a_signed_url(
    files: SQLAlchemyAccountAvatarFileGateway,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(FILES_URL="https://files.example.com", CONSOLE_API_URL="https://console.example.com")
    file_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=file_id, created_by=_ACCOUNT_ID, extension="png", mime_type="image/png"))
    service = AccountAvatarService(files=files)

    result = urlsplit(service.resolve(_context(), file_id))

    assert result.netloc == "files.example.com"
    assert result.path == f"/files/{file_id}/file-preview"
    assert "sign=" in result.query


@pytest.mark.parametrize("exists", [False, True])
def test_resolve_rejects_missing_or_unowned_file(
    files: SQLAlchemyAccountAvatarFileGateway,
    sqlite_session_factory: sessionmaker[Session],
    exists: bool,
) -> None:
    file_id = str(uuid4())
    if exists:
        with sqlite_session_factory.begin() as session:
            session.add(
                make_upload_file(file_id=file_id, created_by="another-account", extension="png", mime_type="image/png")
            )
    service = AccountAvatarService(files=files)

    with pytest.raises(AvatarFileNotFoundError):
        service.resolve(_context(), file_id)
