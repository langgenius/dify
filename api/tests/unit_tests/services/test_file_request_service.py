from contextlib import nullcontext
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope
from core.workflow.file_reference import build_file_reference
from services.file_request_service import FileRequestService


@pytest.mark.parametrize(
    ("user_from", "invoke_from", "expected_user_from", "expected_invoke_from"),
    [
        (UserFrom.ACCOUNT, InvokeFrom.DEBUGGER, UserFrom.ACCOUNT, InvokeFrom.DEBUGGER),
        ("end-user", "service-api", UserFrom.END_USER, InvokeFrom.SERVICE_API),
    ],
)
def test_request_download_url_builds_file_under_bound_scope(
    user_from: UserFrom | str,
    invoke_from: InvokeFrom | str,
    expected_user_from: UserFrom,
    expected_invoke_from: InvokeFrom,
) -> None:
    fake_file = MagicMock(filename="report.pdf", mime_type="application/pdf", size=123)
    access_controller = MagicMock()
    service = FileRequestService(access_controller=access_controller)
    reference = build_file_reference(record_id="tool-file-1")

    with (
        patch("services.file_request_service.bind_file_access_scope", return_value=nullcontext()) as bind_scope,
        patch.object(service, "_build_file", return_value=fake_file) as build_file,
        patch(
            "services.file_request_service.file_helpers.resolve_file_url", return_value="https://files.example.com/x"
        ),
    ):
        result = service.request_download_url(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from=user_from,
            invoke_from=invoke_from,
            file_mapping={"transfer_method": "tool_file", "reference": reference},
        )

    bind_scope.assert_called_once()
    bound_scope = bind_scope.call_args.args[0]
    assert isinstance(bound_scope, FileAccessScope)
    assert bound_scope.tenant_id == "tenant-1"
    assert bound_scope.user_id == "user-1"
    assert bound_scope.user_from == expected_user_from
    assert bound_scope.invoke_from == expected_invoke_from
    build_file.assert_called_once_with(
        mapping={"transfer_method": "tool_file", "reference": reference}, tenant_id="tenant-1"
    )
    assert result.filename == "report.pdf"
    assert result.mime_type == "application/pdf"
    assert result.size == 123
    assert result.download_url == "https://files.example.com/x"


def test_request_download_url_rejects_unsupported_files() -> None:
    service = FileRequestService(access_controller=MagicMock())

    with (
        patch("services.file_request_service.bind_file_access_scope", return_value=nullcontext()),
        patch.object(service, "_build_file", return_value=MagicMock(filename="report.pdf", mime_type=None, size=1)),
        patch("services.file_request_service.file_helpers.resolve_file_url", return_value=None),
    ):
        with pytest.raises(ValueError, match="file does not support signed download"):
            service.request_download_url(
                tenant_id="tenant-1",
                user_id="user-1",
                user_from="account",
                invoke_from="debugger",
                file_mapping={"transfer_method": "unknown"},
            )
