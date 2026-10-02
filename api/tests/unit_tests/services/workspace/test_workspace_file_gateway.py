"""File adapter keeps admitted identity explicit across the FileService boundary."""

from unittest.mock import Mock

from machinery.context import RequestContext
from models.account import Account
from services.file_service import FileService
from services.workspace.gateways import WorkspaceFileGateway


def test_upload_uses_admitted_account_and_explicit_workspace() -> None:
    files = Mock(spec=FileService)
    files.upload_file.return_value = Mock(id="file-id")
    gateway = WorkspaceFileGateway(files=files)
    context = RequestContext("request", None, "account", "workspace")

    assert gateway.upload(context, filename="logo.png", content=b"image", mimetype="image/png") == "file-id"

    kwargs = files.upload_file.call_args.kwargs
    assert isinstance(kwargs["user"], Account)
    assert kwargs["user"].id == "account"
    assert kwargs["tenant_id"] == "workspace"
    assert kwargs["content"] == b"image"
