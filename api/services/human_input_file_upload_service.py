from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from configs import dify_config
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.account import Account
from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.file_service import FileService
from services.human_input_service import FormExpiredError, FormNotFoundError, FormSubmittedError
from services.remote_file_service import RemoteFileService, RemoteFileUploadResult

HITL_UPLOAD_TOKEN_PREFIX = "hitl_upload_"
_TOKEN_RANDOM_BYTES = 32
_TOKEN_GENERATION_ATTEMPTS = 10


@dataclass(frozen=True)
class HumanInputUploadToken:
    upload_token: str
    expires_at: datetime


@dataclass(frozen=True)
class HumanInputUploadFormRecord:
    form_id: str
    recipient_id: str
    tenant_id: str
    app_id: str
    workflow_run_id: str | None
    form_kind: HumanInputFormKind
    status: HumanInputFormStatus
    submitted_at: datetime | None
    expiration_time: datetime
    created_at: datetime


@dataclass(frozen=True)
class HumanInputUploadGrantRecord:
    upload_token_id: str
    form: HumanInputUploadFormRecord


@dataclass(frozen=True)
class HumanInputUploadContext:
    tenant_id: str
    app_id: str
    form_id: str
    recipient_id: str
    upload_token_id: str
    owner: Account | EndUser


class InvalidUploadTokenError(Exception):
    pass


class HumanInputFileUploadRepository(Protocol):
    def get_form_by_recipient_token(self, form_token: str) -> HumanInputUploadFormRecord | None: ...

    def create_upload_token(self, *, form: HumanInputUploadFormRecord, upload_token: str) -> None: ...

    def get_upload_grant(self, upload_token: str) -> HumanInputUploadGrantRecord | None: ...

    def get_upload_owner(
        self,
        *,
        owner_id: str,
        owner_role: CreatorUserRole,
        tenant_id: str,
        app_id: str,
    ) -> Account | EndUser | None: ...

    def get_delivery_test_upload_owner(self, *, tenant_id: str, app_id: str) -> Account | None: ...

    def add_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        form_id: str,
        upload_token_id: str,
        file_id: str,
    ) -> None: ...


class HumanInputFileUploadService:
    """Coordinates HITL upload tokens, workflow-run owners, and form-file links.

    Standalone HITL uploads must be owned by the original workflow/chatflow
    initiator so that resume-time file restoration continues to flow through the
    normal file access checks. Delivery-test forms have no workflow run, so their
    uploads are scoped to the app creator account inside the form tenant.
    """

    _uploads: HumanInputFileUploadRepository
    _workflow_run_repository: APIWorkflowRunRepository
    _files: FileService
    _remote_files: RemoteFileService

    def __init__(
        self,
        *,
        uploads: HumanInputFileUploadRepository,
        workflow_run_repository: APIWorkflowRunRepository,
        files: FileService,
        remote_files: RemoteFileService,
    ) -> None:
        self._uploads = uploads
        self._workflow_run_repository = workflow_run_repository
        self._files = files
        self._remote_files = remote_files

    def issue_upload_token(self, form_token: str) -> HumanInputUploadToken:
        """Create an upload token for an active human input recipient token."""

        form = self._uploads.get_form_by_recipient_token(form_token)
        if form is None:
            raise FormNotFoundError()

        self._ensure_form_active(form)
        upload_token = self._generate_unique_upload_token()
        self._uploads.create_upload_token(form=form, upload_token=upload_token)
        return HumanInputUploadToken(upload_token=upload_token, expires_at=form.expiration_time)

    def validate_upload_token(self, upload_token: str) -> HumanInputUploadContext:
        """Resolve an upload token and ensure the bound form is still active."""

        grant = self._uploads.get_upload_grant(upload_token)
        if grant is None:
            raise InvalidUploadTokenError()

        form = grant.form
        self._ensure_form_active(form)
        owner = self._resolve_upload_owner(form=form)
        return HumanInputUploadContext(
            tenant_id=form.tenant_id,
            app_id=form.app_id,
            form_id=form.form_id,
            recipient_id=form.recipient_id,
            upload_token_id=grant.upload_token_id,
            owner=owner,
        )

    def record_upload_file(self, *, context: HumanInputUploadContext, file_id: str) -> None:
        """Record that a file was uploaded through a specific form upload token."""

        self._uploads.add_file(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            form_id=context.form_id,
            upload_token_id=context.upload_token_id,
            file_id=file_id,
        )

    def upload_local_file(
        self,
        *,
        context: HumanInputUploadContext,
        filename: str,
        content: bytes,
        mimetype: str,
    ) -> UploadFile:
        upload_file = self._files.upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=context.owner,
            source=None,
        )
        self.record_upload_file(context=context, file_id=upload_file.id)
        return upload_file

    def upload_remote_file(
        self,
        *,
        context: HumanInputUploadContext,
        url: str,
    ) -> RemoteFileUploadResult:
        upload_file = self._remote_files.upload_from_url(
            url=url,
            user=context.owner,
        )
        self.record_upload_file(context=context, file_id=upload_file.id)
        return upload_file

    def _generate_unique_upload_token(self) -> str:
        return f"{HITL_UPLOAD_TOKEN_PREFIX}{secrets.token_urlsafe(_TOKEN_RANDOM_BYTES)}"

    def _resolve_upload_owner(
        self,
        *,
        form: HumanInputUploadFormRecord,
    ) -> Account | EndUser:
        if form.workflow_run_id is None:
            if form.form_kind == HumanInputFormKind.DELIVERY_TEST:
                owner = self._uploads.get_delivery_test_upload_owner(
                    tenant_id=form.tenant_id,
                    app_id=form.app_id,
                )
                if owner is not None:
                    return owner
            raise InvalidUploadTokenError()

        workflow_run = self._workflow_run_repository.get_workflow_run_by_id(
            tenant_id=form.tenant_id,
            app_id=form.app_id,
            run_id=form.workflow_run_id,
        )
        if workflow_run is None:
            raise InvalidUploadTokenError()

        owner_role = workflow_run.created_by_role
        if owner_role not in {CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER}:
            raise InvalidUploadTokenError()

        owner = self._uploads.get_upload_owner(
            owner_id=workflow_run.created_by,
            owner_role=owner_role,
            tenant_id=workflow_run.tenant_id,
            app_id=workflow_run.app_id,
        )
        if owner is None:
            raise InvalidUploadTokenError()
        return owner

    @staticmethod
    def _ensure_form_active(form: HumanInputUploadFormRecord) -> None:
        if form.submitted_at is not None or form.status == HumanInputFormStatus.SUBMITTED:
            raise FormSubmittedError(form.form_id)
        if form.status in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
            raise FormExpiredError(form.form_id)

        now = naive_utc_now()
        if ensure_naive_utc(form.expiration_time) <= now:
            raise FormExpiredError(form.form_id)

        global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
        if global_timeout_seconds <= 0 or form.workflow_run_id is None:
            return
        global_deadline = ensure_naive_utc(form.created_at) + timedelta(seconds=global_timeout_seconds)
        if global_deadline <= now:
            raise FormExpiredError(form.form_id)
