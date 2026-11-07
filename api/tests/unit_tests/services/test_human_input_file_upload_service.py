from __future__ import annotations

from collections.abc import Callable
from datetime import timedelta
from types import SimpleNamespace
from typing import cast, override
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

import services.human_input_file_upload_service as service_module
from core.workflow.human_input_adapter import DeliveryMethodType
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import EndUserType
from models.human_input import (
    HumanInputDelivery,
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    RecipientType,
)
from models.model import App, AppMode, EndUser, UploadFile
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.workflow.human_input.file_upload_repository import SQLAlchemyHumanInputFileUploadRepository
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.file_service import FileService
from services.human_input_file_upload_service import (
    HITL_UPLOAD_TOKEN_PREFIX,
    HumanInputFileUploadRepository,
    HumanInputFileUploadService,
    HumanInputUploadContext,
    HumanInputUploadFormRecord,
    InvalidUploadTokenError,
)
from services.human_input_service import FormNotFoundError, FormSubmittedError
from services.remote_file_service import RemoteFileService, RemoteFileUploadResult


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


type UploadRepositoryFactory = Callable[[HumanInputUploadFormRecord | None], SQLAlchemyHumanInputFileUploadRepository]


class _RecordingFiles(FileService):
    def __init__(self, upload: UploadFileRecord) -> None:
        self.upload = upload
        self.deleted: list[tuple[str, str]] = []

    @override
    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> UploadFileRecord:
        del actor, tenant_id, filename, content, mimetype, allowed_extensions, source_url, default_file_size_limit
        return self.upload

    @override
    def delete_file(self, *, tenant_id: str, file_id: str) -> None:
        self.deleted.append((tenant_id, file_id))


class _RecordingRemoteFiles(RemoteFileService):
    def __init__(self, upload: RemoteFileUploadResult) -> None:
        self.upload = upload

    @override
    def upload_from_url(
        self,
        *,
        url: str,
        actor: FileUploadActor,
        tenant_id: str,
    ) -> RemoteFileUploadResult:
        del url, actor, tenant_id
        return self.upload


class _CommitUnknownUploads:
    def get_form_by_recipient_token(self, form_token: str) -> HumanInputUploadFormRecord | None:
        raise AssertionError(f"unexpected form token lookup: {form_token}")

    def create_upload_token(self, *, form: HumanInputUploadFormRecord, upload_token: str) -> None:
        raise AssertionError(f"unexpected upload token creation: {form.form_id}, {upload_token}")

    def get_upload_grant(self, upload_token: str) -> None:
        raise AssertionError(f"unexpected upload grant lookup: {upload_token}")

    def get_upload_owner(
        self,
        *,
        owner_id: str,
        owner_role: CreatorUserRole,
        tenant_id: str,
        app_id: str,
    ) -> None:
        raise AssertionError(f"unexpected upload owner lookup: {owner_id}, {owner_role}, {tenant_id}, {app_id}")

    def get_delivery_test_upload_owner(self, *, tenant_id: str, app_id: str) -> None:
        raise AssertionError(f"unexpected delivery owner lookup: {tenant_id}, {app_id}")

    def add_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        form_id: str,
        recipient_id: str,
        upload_token_id: str,
        file_id: str,
        validate_form: Callable[[HumanInputUploadFormRecord], None],
    ) -> None:
        del tenant_id, app_id, form_id, recipient_id, upload_token_id, file_id, validate_form
        raise SQLAlchemyError("commit outcome unknown")


def _upload_record(file_id: str = "file-1") -> UploadFileRecord:
    return UploadFileRecord(
        id=file_id,
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="sample.txt",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="owner-1",
        created_at=naive_utc_now(),
        hash=None,
        source_url="",
    )


@pytest.fixture
def upload_repository(sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> UploadRepositoryFactory:
    def build(record: HumanInputUploadFormRecord | None) -> SQLAlchemyHumanInputFileUploadRepository:
        """Persist upload authorization and owners; None leaves the database empty."""
        if record is not None:
            account = Account(name="Upload owner", email="owner@example.com")
            account.id = "owner-1"
            tenant = Tenant(name="Upload tenant")
            tenant.id = record.tenant_id
            with sqlite_session_factory.begin() as session:
                session.add_all(
                    [
                        account,
                        tenant,
                        TenantAccountJoin(tenant_id=record.tenant_id, account_id=account.id),
                        App(
                            id=record.app_id,
                            tenant_id=record.tenant_id,
                            name="Upload app",
                            mode=AppMode.WORKFLOW,
                            enable_site=True,
                            enable_api=True,
                            created_by=account.id,
                        ),
                        EndUser(
                            id="owner-1",
                            tenant_id=record.tenant_id,
                            app_id=record.app_id,
                            type=EndUserType.BROWSER,
                            session_id="session-1",
                        ),
                        HumanInputForm(
                            id=record.form_id,
                            tenant_id=record.tenant_id,
                            app_id=record.app_id,
                            workflow_run_id=record.workflow_run_id,
                            form_kind=record.form_kind,
                            status=record.status,
                            node_id="node-1",
                            form_definition="{}",
                            rendered_content="Upload a file",
                            submitted_at=record.submitted_at,
                            expiration_time=record.expiration_time,
                            created_at=record.created_at,
                        ),
                        HumanInputDelivery(
                            id="delivery-1",
                            form_id=record.form_id,
                            delivery_method_type=DeliveryMethodType.WEBAPP,
                            channel_payload="{}",
                        ),
                        HumanInputFormRecipient(
                            id=record.recipient_id,
                            form_id=record.form_id,
                            delivery_id="delivery-1",
                            recipient_type=RecipientType.STANDALONE_WEB_APP,
                            recipient_payload='{"TYPE":"standalone_web_app"}',
                            access_token="form-token-1",
                        ),
                        HumanInputFormUploadToken(
                            id="token-1",
                            tenant_id=record.tenant_id,
                            app_id=record.app_id,
                            form_id=record.form_id,
                            recipient_id=record.recipient_id,
                            token="upload-token-1",
                        ),
                    ]
                )
        repository = SQLAlchemyHumanInputFileUploadRepository(session_factory=sqlite_session_factory)
        for method in (
            "get_form_by_recipient_token",
            "create_upload_token",
            "get_upload_owner",
            "get_delivery_test_upload_owner",
            "add_file",
        ):
            mocker.spy(repository, method)
        return repository

    return build


def _assert_file_link(session_factory: sessionmaker[Session]) -> None:
    with session_factory() as session:
        link = session.scalars(select(HumanInputFormUploadFile)).one()
        assert (link.tenant_id, link.app_id, link.form_id, link.upload_token_id, link.upload_file_id) == (
            "tenant-1",
            "app-1",
            "form-1",
            "token-1",
            "file-1",
        )


def _persist_upload(
    session_factory: sessionmaker[Session],
    upload_file: UploadFile,
) -> None:
    with session_factory.begin() as session:
        session.add(upload_file)


def _upload_context() -> HumanInputUploadContext:
    return HumanInputUploadContext(
        tenant_id="tenant-1",
        app_id="app-1",
        form_id="form-1",
        recipient_id="recipient-1",
        upload_token_id="token-1",
        owner=Account(name="Upload owner", email="owner@example.com"),
    )


def _create_service(
    *,
    uploads: HumanInputFileUploadRepository,
    workflow_runs: APIWorkflowRunRepository | None = None,
    files: FileService | None = None,
    remote_files: RemoteFileService | None = None,
) -> HumanInputFileUploadService:
    return HumanInputFileUploadService(
        uploads=uploads,
        workflow_run_repository=workflow_runs if workflow_runs is not None else MagicMock(),
        files=files if files is not None else MagicMock(),
        remote_files=remote_files if remote_files is not None else MagicMock(),
    )


def _upload_created_file(
    service: HumanInputFileUploadService,
    *,
    context: HumanInputUploadContext,
    remote: bool,
) -> None:
    if remote:
        service.upload_remote_file(context=context, url="https://example.com/sample.txt")
    else:
        service.upload_local_file(
            context=context,
            filename="sample.txt",
            content=b"content",
            mimetype="text/plain",
        )


def test_issue_upload_token_persists_repository_record(
    upload_repository: UploadRepositoryFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    form = _active_form()
    uploads = upload_repository(form)
    monkeypatch.setattr(service_module.secrets, "token_urlsafe", lambda _bytes: "random-value")

    token = _create_service(uploads=uploads).issue_upload_token("form-token-1")

    assert token.upload_token == f"{HITL_UPLOAD_TOKEN_PREFIX}random-value"
    assert token.expires_at == form.expiration_time
    cast(MagicMock, uploads.get_form_by_recipient_token).assert_called_once_with("form-token-1")
    cast(MagicMock, uploads.create_upload_token).assert_called_once_with(form=form, upload_token=token.upload_token)
    grant = uploads.get_upload_grant(token.upload_token)
    assert grant is not None
    assert grant.form == form


def test_issue_upload_token_rejects_unknown_form_token(upload_repository: UploadRepositoryFactory) -> None:
    uploads = upload_repository(None)

    with pytest.raises(FormNotFoundError):
        _create_service(uploads=uploads).issue_upload_token("missing-form-token")

    cast(MagicMock, uploads.create_upload_token).assert_not_called()


@pytest.mark.parametrize("owner_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_validate_upload_token_resolves_workflow_run_owner(
    upload_repository: UploadRepositoryFactory, owner_role: CreatorUserRole
) -> None:
    form = _active_form()
    uploads = upload_repository(form)
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
        owner=context.owner,
    )
    assert isinstance(context.owner, Account if owner_role == CreatorUserRole.ACCOUNT else EndUser)
    assert context.owner.id == "owner-1"
    workflow_runs.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        run_id="run-1",
    )
    cast(MagicMock, uploads.get_upload_owner).assert_called_once_with(
        owner_id="owner-1",
        owner_role=owner_role,
        tenant_id="tenant-1",
        app_id="app-1",
    )


def test_validate_upload_token_resolves_delivery_test_owner(upload_repository: UploadRepositoryFactory) -> None:
    form = _active_form(workflow_run_id=None, form_kind=HumanInputFormKind.DELIVERY_TEST)
    uploads = upload_repository(form)
    workflow_runs = MagicMock()

    context = _create_service(uploads=uploads, workflow_runs=workflow_runs).validate_upload_token("upload-token-1")

    assert isinstance(context.owner, Account)
    assert context.owner.id == "owner-1"
    assert context.owner.current_tenant_id == "tenant-1"
    cast(MagicMock, uploads.get_delivery_test_upload_owner).assert_called_once_with(
        tenant_id="tenant-1", app_id="app-1"
    )
    workflow_runs.get_workflow_run_by_id.assert_not_called()


def test_validate_upload_token_rejects_unknown_upload_token(upload_repository: UploadRepositoryFactory) -> None:
    uploads = upload_repository(None)

    with pytest.raises(InvalidUploadTokenError):
        _create_service(uploads=uploads).validate_upload_token("missing-upload-token")


def test_validate_upload_token_rejects_submitted_form(upload_repository: UploadRepositoryFactory) -> None:
    form = _active_form(status=HumanInputFormStatus.SUBMITTED)
    uploads = upload_repository(form)

    with pytest.raises(FormSubmittedError):
        _create_service(uploads=uploads).validate_upload_token("upload-token-1")

    cast(MagicMock, uploads.get_upload_owner).assert_not_called()


def test_upload_local_file_records_the_form_file_link(
    upload_repository: UploadRepositoryFactory, sqlite_session_factory: sessionmaker[Session]
) -> None:
    uploads = upload_repository(_active_form())
    files = MagicMock()
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="sample.txt",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="owner-1",
        created_at=naive_utc_now(),
        used=False,
    )
    upload_file.id = "file-1"
    files.upload_file.return_value = upload_file
    _persist_upload(sqlite_session_factory, upload_file)
    context = _upload_context()

    service = _create_service(uploads=uploads, files=files)
    result = service.upload_local_file(
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
        actor=FileUploadActor(id=context.owner.id, creator_role=CreatorUserRole.ACCOUNT),
        tenant_id="tenant-1",
    )
    _assert_file_link(sqlite_session_factory)


def test_upload_remote_file_records_the_form_file_link(
    upload_repository: UploadRepositoryFactory, sqlite_session_factory: sessionmaker[Session]
) -> None:
    uploads = upload_repository(_active_form())
    remote_files = MagicMock()
    upload_file = RemoteFileUploadResult(
        id="file-1",
        name="sample.txt",
        size=7,
        extension="txt",
        url="https://example.com/sample.txt",
        mime_type="text/plain",
        created_by="owner-1",
        created_at=naive_utc_now(),
    )
    remote_files.upload_from_url.return_value = upload_file
    persisted_upload = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="sample.txt",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="owner-1",
        created_at=upload_file.created_at,
        used=False,
    )
    persisted_upload.id = upload_file.id
    _persist_upload(sqlite_session_factory, persisted_upload)
    context = _upload_context()

    service = _create_service(uploads=uploads, remote_files=remote_files)
    result = service.upload_remote_file(
        context=context,
        url="https://example.com/sample.txt",
    )

    assert result is upload_file
    remote_files.upload_from_url.assert_called_once_with(
        url="https://example.com/sample.txt",
        actor=FileUploadActor(id=context.owner.id, creator_role=CreatorUserRole.ACCOUNT),
        tenant_id="tenant-1",
    )
    _assert_file_link(sqlite_session_factory)


@pytest.mark.parametrize("remote", [False, True], ids=["local", "remote"])
def test_upload_reclaims_file_when_final_owner_check_definitively_rejects(
    upload_repository: UploadRepositoryFactory,
    sqlite_session_factory: sessionmaker[Session],
    remote: bool,
) -> None:
    uploads = upload_repository(_active_form())
    files = _RecordingFiles(_upload_record())
    remote_files = _RecordingRemoteFiles(
        RemoteFileUploadResult(
            id="file-1",
            name="sample.txt",
            size=7,
            extension="txt",
            url="https://example.com/sample.txt",
            mime_type="text/plain",
            created_by="owner-1",
            created_at=naive_utc_now(),
        )
    )
    context = _upload_context()

    with sqlite_session_factory.begin() as session:
        token = session.get_one(HumanInputFormUploadToken, "token-1")
        session.delete(token)

    service = _create_service(uploads=uploads, files=files, remote_files=remote_files)
    with pytest.raises(InvalidUploadTokenError):
        _upload_created_file(service, context=context, remote=remote)

    assert files.deleted == [("tenant-1", "file-1")]


@pytest.mark.parametrize("remote", [False, True], ids=["local", "remote"])
def test_upload_does_not_reclaim_after_unknown_database_failure(remote: bool) -> None:
    uploads = _CommitUnknownUploads()
    files = _RecordingFiles(_upload_record())
    remote_files = _RecordingRemoteFiles(
        RemoteFileUploadResult(
            id="file-1",
            name="sample.txt",
            size=7,
            extension="txt",
            url="https://example.com/sample.txt",
            mime_type="text/plain",
            created_by="owner-1",
            created_at=naive_utc_now(),
        )
    )
    context = _upload_context()

    service = _create_service(uploads=uploads, files=files, remote_files=remote_files)
    with pytest.raises(SQLAlchemyError, match="commit outcome unknown"):
        _upload_created_file(service, context=context, remote=remote)

    assert files.deleted == []
