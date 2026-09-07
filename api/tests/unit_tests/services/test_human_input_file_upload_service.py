from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import services.human_input_file_upload_service as service_module
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.enums import CreatorUserRole
from services.human_input_file_upload_service import (
    HITL_UPLOAD_TOKEN_PREFIX,
    HumanInputFileUploadRepository,
    HumanInputFileUploadService,
    HumanInputUploadContext,
    HumanInputUploadFormRecord,
    HumanInputUploadGrantRecord,
    InvalidUploadTokenError,
)
from services.human_input_service import FormNotFoundError, FormSubmittedError


def _active_form(
    *,
    workflow_run_id: str | None = "run-1",
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME,
    status: HumanInputFormStatus = HumanInputFormStatus.WAITING,
) -> HumanInputUploadFormRecord:
    now = naive_utc_now()
    return HumanInputUploadFormRecord(
        form_id="form-1",
        recipient_id="recipient-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_run_id=workflow_run_id,
        form_kind=form_kind,
        status=status,
        submitted_at=None,
        expiration_time=now + timedelta(hours=1),
        created_at=now,
    )


def _upload_context() -> HumanInputUploadContext:
    return HumanInputUploadContext(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        recipient_id="recipient-1",
        upload_token_id="token-1",
        owner=MagicMock(spec=Account),
    )


def _create_service(
    *,
    uploads: MagicMock | None = None,
    workflow_runs: MagicMock | None = None,
    files: MagicMock | None = None,
    remote_files: MagicMock | None = None,
) -> HumanInputFileUploadService:
    return HumanInputFileUploadService(
        uploads=uploads if uploads is not None else MagicMock(spec=HumanInputFileUploadRepository),
        workflow_run_repository=workflow_runs if workflow_runs is not None else MagicMock(),
        files=files if files is not None else MagicMock(),
        remote_files=remote_files if remote_files is not None else MagicMock(),
    )


def test_issue_upload_token_persists_repository_record(monkeypatch: pytest.MonkeyPatch) -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    form = _active_form()
    uploads.get_form_by_recipient_token.return_value = form
    monkeypatch.setattr(service_module.secrets, "token_urlsafe", lambda _bytes: "random-value")

    token = _create_service(uploads=uploads).issue_upload_token("form-token-1")

    assert token.upload_token == f"{HITL_UPLOAD_TOKEN_PREFIX}random-value"
    assert token.expires_at == form.expiration_time
    uploads.get_form_by_recipient_token.assert_called_once_with("form-token-1")
    uploads.create_upload_token.assert_called_once_with(form=form, upload_token=token.upload_token)


def test_issue_upload_token_rejects_unknown_form_token() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    uploads.get_form_by_recipient_token.return_value = None

    with pytest.raises(FormNotFoundError):
        _create_service(uploads=uploads).issue_upload_token("missing-form-token")

    uploads.create_upload_token.assert_not_called()


@pytest.mark.parametrize("owner_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_validate_upload_token_resolves_workflow_run_owner(owner_role: CreatorUserRole) -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    form = _active_form()
    uploads.get_upload_grant.return_value = HumanInputUploadGrantRecord(upload_token_id="token-1", form=form)
    owner = MagicMock()
    uploads.get_upload_owner.return_value = owner
    workflow_runs = MagicMock()
    workflow_runs.get_workflow_run_by_id.return_value = SimpleNamespace(
        created_by="owner-1",
        created_by_role=owner_role,
        tenant_id="tenant-1",
        app_id="app-1",
    )

    context = _create_service(uploads=uploads, workflow_runs=workflow_runs).validate_upload_token("upload-token-1")

    assert context == HumanInputUploadContext(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        recipient_id="recipient-1",
        upload_token_id="token-1",
        owner=owner,
    )
    workflow_runs.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        run_id="run-1",
    )
    uploads.get_upload_owner.assert_called_once_with(
        owner_id="owner-1",
        owner_role=owner_role,
        tenant_id="tenant-1",
        app_id="app-1",
    )


def test_validate_upload_token_resolves_delivery_test_owner() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    form = _active_form(workflow_run_id=None, form_kind=HumanInputFormKind.DELIVERY_TEST)
    uploads.get_upload_grant.return_value = HumanInputUploadGrantRecord(upload_token_id="token-1", form=form)
    owner = MagicMock(spec=Account)
    uploads.get_delivery_test_upload_owner.return_value = owner
    workflow_runs = MagicMock()

    context = _create_service(uploads=uploads, workflow_runs=workflow_runs).validate_upload_token("upload-token-1")

    assert context.owner is owner
    uploads.get_delivery_test_upload_owner.assert_called_once_with(tenant_id="tenant-1", app_id="app-1")
    workflow_runs.get_workflow_run_by_id.assert_not_called()


def test_validate_upload_token_rejects_unknown_upload_token() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    uploads.get_upload_grant.return_value = None

    with pytest.raises(InvalidUploadTokenError):
        _create_service(uploads=uploads).validate_upload_token("missing-upload-token")


def test_validate_upload_token_rejects_submitted_form() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    form = _active_form(status=HumanInputFormStatus.SUBMITTED)
    uploads.get_upload_grant.return_value = HumanInputUploadGrantRecord(upload_token_id="token-1", form=form)

    with pytest.raises(FormSubmittedError):
        _create_service(uploads=uploads).validate_upload_token("upload-token-1")

    uploads.get_upload_owner.assert_not_called()


def test_upload_local_file_records_the_form_file_link() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    files = MagicMock()
    upload_file = MagicMock(id="file-1")
    files.upload_file.return_value = upload_file
    context = _upload_context()

    result = _create_service(uploads=uploads, files=files).upload_local_file(
        context=context,
        filename="sample.txt",
        content=b"content",
        mimetype="text/plain",
    )

    assert result is upload_file
    files.upload_file.assert_called_once_with(
        filename="sample.txt",
        content=b"content",
        mimetype="text/plain",
        user=context.owner,
        source=None,
    )
    uploads.add_file.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        upload_token_id="token-1",
        file_id="file-1",
    )


def test_upload_remote_file_records_the_form_file_link() -> None:
    uploads = MagicMock(spec=HumanInputFileUploadRepository)
    remote_files = MagicMock()
    upload_file = MagicMock(id="file-1")
    remote_files.upload_from_url.return_value = upload_file
    context = _upload_context()

    result = _create_service(uploads=uploads, remote_files=remote_files).upload_remote_file(
        context=context,
        url="https://example.com/sample.txt",
    )

    assert result is upload_file
    remote_files.upload_from_url.assert_called_once_with(
        url="https://example.com/sample.txt",
        user=context.owner,
    )
    uploads.add_file.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        upload_token_id="token-1",
        file_id="file-1",
    )
