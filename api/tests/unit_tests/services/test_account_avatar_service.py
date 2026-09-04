from unittest.mock import Mock

import pytest

from machinery.context import RequestContext
from services.account_avatar_service import AccountAvatarService
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarFileGateway


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def test_resolve_passes_through_external_avatar_without_calling_gateway() -> None:
    files = Mock(spec=AccountAvatarFileGateway)
    service = AccountAvatarService(files=files)

    result = service.resolve(_context(), "https://cdn.example/avatar.png")

    assert result == "https://cdn.example/avatar.png"
    files.get_owned_signed_url.assert_not_called()


def test_resolve_returns_owned_signed_url() -> None:
    files = Mock(spec=AccountAvatarFileGateway)
    files.get_owned_signed_url.return_value = "https://signed.example/avatar"
    service = AccountAvatarService(files=files)

    result = service.resolve(_context(), "file-1")

    assert result == "https://signed.example/avatar"
    files.get_owned_signed_url.assert_called_once_with(account_id="account-1", upload_file_id="file-1")


def test_resolve_rejects_missing_or_unowned_file() -> None:
    files = Mock(spec=AccountAvatarFileGateway)
    files.get_owned_signed_url.return_value = None
    service = AccountAvatarService(files=files)

    with pytest.raises(AvatarFileNotFoundError):
        service.resolve(_context(), "file-1")
