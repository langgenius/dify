"""File adapter keeps admitted identity explicit across the FileService boundary."""

from unittest.mock import Mock, create_autospec

from enums.creator import CreatorUserRole
from machinery.context import RequestContext
from services.file_service import FileService
from services.workspace.gateways import WorkspaceFileGateway


def test_upload_uses_admitted_account_and_explicit_workspace() -> None:
    files = create_autospec(FileService, instance=True)
    files.upload_file.return_value = Mock(id="file-id")
    gateway = WorkspaceFileGateway(files=files)
    context = RequestContext("request", None, "account", "workspace")

    assert gateway.upload(context, filename="logo.png", content=b"image", mimetype="image/png") == "file-id"

    kwargs = files.upload_file.call_args.kwargs
    assert kwargs["actor"].id == "account"
    assert kwargs["actor"].creator_role == CreatorUserRole.ACCOUNT
    assert kwargs["tenant_id"] == "workspace"
    assert kwargs["content"] == b"image"
