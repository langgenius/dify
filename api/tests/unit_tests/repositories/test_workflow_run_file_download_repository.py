import json
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.file_reference import build_file_reference
from extensions.storage.storage_type import StorageType
from graphon.enums import WorkflowExecutionStatus
from models.base import Base, TypeBase
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.human_input import HumanInputForm, HumanInputFormUploadFile
from models.model import EndUser, UploadFile
from models.tools import ToolFile
from models.workflow import WorkflowRun, WorkflowType
from repositories.workflow_run_file_download_repository import WorkflowRunFileDownloadQueryRepository
from services.workflow_run_file_download_service import (
    WorkflowRunFileAccessDeniedError,
    WorkflowRunFileNotFoundError,
    WorkflowRunFileNotReferencedError,
    WorkflowRunFileNotRetainedError,
)


@pytest.fixture
def repository(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> WorkflowRunFileDownloadQueryRepository:
    base_tables = [
        Base.metadata.tables[name]
        for name in ("end_users", "human_input_forms", "human_input_form_upload_files", "workflow_runs")
    ]
    type_tables = [TypeBase.metadata.tables[name] for name in ("upload_files", "tool_files")]
    Base.metadata.create_all(sqlite_engine, tables=base_tables)
    TypeBase.metadata.create_all(sqlite_engine, tables=type_tables)
    return WorkflowRunFileDownloadQueryRepository(session_factory=sqlite_session_factory)


def _end_user(*, user_id: str, app_id: str = "app-1", tenant_id: str = "tenant-1") -> EndUser:
    return EndUser(
        id=user_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=EndUserType.SERVICE_API,
        session_id=f"session-{user_id}",
    )


def _run(
    *,
    run_id: str = "run-1",
    app_id: str = "app-1",
    tenant_id: str = "tenant-1",
    creator_id: str = "user-1",
    inputs: dict[str, object] | None = None,
    outputs: dict[str, object] | None = None,
) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        workflow_id="workflow-1",
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        graph="{}",
        inputs=json.dumps(inputs or {}),
        outputs=json.dumps(outputs or {}),
        error=None,
        elapsed_time=0,
        total_tokens=0,
        total_steps=0,
        created_by_role=CreatorUserRole.END_USER,
        created_by=creator_id,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        finished_at=None,
    )


def _upload(*, file_id: str, creator_id: str = "user-1", tenant_id: str = "tenant-1") -> UploadFile:
    upload = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{tenant_id}/{file_id}.pdf",
        name="report.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.END_USER,
        created_by=creator_id,
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    upload.id = file_id
    return upload


def _human_input_file(
    *, file_id: str, run_id: str = "run-1", app_id: str = "app-1", tenant_id: str = "tenant-1"
) -> tuple[HumanInputForm, HumanInputFormUploadFile]:
    form = HumanInputForm(
        id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_run_id=run_id,
        node_id="human-input",
        form_definition="{}",
        rendered_content="Review the attachment",
        expiration_time=datetime.now(UTC) + timedelta(days=1),
    )
    association = HumanInputFormUploadFile(
        tenant_id=tenant_id,
        app_id=app_id,
        form_id=form.id,
        upload_file_id=file_id,
        upload_token_id=str(uuid4()),
    )
    return form, association


def test_get_for_run_downloads_upload_input_owned_by_app_and_run_creator(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(inputs={"attachment": {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}})
    sqlite_session.add_all([_end_user(user_id="user-1"), run, _upload(file_id=file_id)])
    sqlite_session.commit()

    result = repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")

    assert result.key == f"upload_files/tenant-1/{file_id}.pdf"
    assert result.name == "report.pdf"


def test_get_for_run_resolves_local_file_reference_inside_nested_input_list(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(
        inputs={
            "attachments": [
                [
                    {
                        "type": "document",
                        "transfer_method": "local_file",
                        "reference": build_file_reference(record_id=file_id),
                    }
                ]
            ]
        }
    )
    sqlite_session.add_all([_end_user(user_id="user-1"), run, _upload(file_id=file_id)])
    sqlite_session.commit()

    result = repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")

    assert result.key == f"upload_files/tenant-1/{file_id}.pdf"


@pytest.mark.parametrize(
    "file_mapping",
    [
        pytest.param(
            {"type": "document", "transfer_method": "local_file", "reference": ""}, id="empty-local-reference"
        ),
        pytest.param({"type": "document", "transfer_method": "tool_file", "reference": ""}, id="empty-tool-reference"),
        pytest.param({"type": "document", "transfer_method": "remote_url", "tool_file_id": None}, id="null-tool-id"),
    ],
)
def test_get_for_run_does_not_treat_empty_or_invalid_references_as_file_ids(
    file_mapping: dict[str, object],
    repository: WorkflowRunFileDownloadQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    sqlite_session.add_all([_end_user(user_id="user-1"), _run(inputs={"attachment": file_mapping})])
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileNotReferencedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")


def test_get_for_run_downloads_tool_output_only_for_owning_run_user(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(outputs={"report": {"type": "document", "transfer_method": "tool_file", "tool_file_id": file_id}})
    tool_file = ToolFile(
        user_id="user-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tool_files/tenant-1/report.pdf",
        mimetype="application/pdf",
        name="report.pdf",
        size=42,
    )
    tool_file.id = file_id
    sqlite_session.add_all([_end_user(user_id="user-1"), run, tool_file])
    sqlite_session.commit()

    result = repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")

    assert result.key == tool_file.file_key
    assert result.extension == "pdf"


def test_get_for_run_resolves_tool_file_reference_in_nested_output_list(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(
        outputs={
            "reports": [
                {
                    "type": "document",
                    "transfer_method": "tool_file",
                    "reference": build_file_reference(record_id=file_id),
                }
            ]
        }
    )
    tool_file = ToolFile(
        user_id="user-1",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tool_files/tenant-1/report.pdf",
        mimetype="application/pdf",
        name="report.pdf",
        size=42,
    )
    tool_file.id = file_id
    sqlite_session.add_all([_end_user(user_id="user-1"), run, tool_file])
    sqlite_session.commit()

    result = repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")

    assert result.key == tool_file.file_key


def test_get_for_run_downloads_human_input_upload_by_form_run_app_and_tenant_link(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    form, association = _human_input_file(file_id=file_id)
    sqlite_session.add_all([_run(), form, association, _upload(file_id=file_id, creator_id="different-submitter")])
    sqlite_session.commit()

    result = repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")

    assert result.name == "report.pdf"


def test_get_for_run_rejects_tool_file_from_another_end_user(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(outputs={"report": {"type": "document", "transfer_method": "tool_file", "tool_file_id": file_id}})
    tool_file = ToolFile(
        user_id="another-user",
        tenant_id="tenant-1",
        conversation_id=None,
        file_key="tool_files/tenant-1/report.pdf",
        mimetype="application/pdf",
        name="report.pdf",
        size=42,
    )
    tool_file.id = file_id
    sqlite_session.add_all([_end_user(user_id="user-1"), run, tool_file])
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileAccessDeniedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")


def test_get_for_run_rejects_upload_owned_by_another_tenant(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(inputs={"file": {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}})
    sqlite_session.add_all(
        [
            _end_user(user_id="user-1"),
            run,
            _upload(file_id=file_id, tenant_id="tenant-2"),
        ]
    )
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileAccessDeniedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")


def test_get_for_run_does_not_accept_human_input_upload_linked_to_another_run(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    form, association = _human_input_file(file_id=file_id, run_id="run-2")
    sqlite_session.add_all([_run(), _run(run_id="run-2"), form, association, _upload(file_id=file_id)])
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileNotReferencedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")


@pytest.mark.parametrize(
    ("request_run_id", "request_app_id", "request_tenant_id", "error"),
    [
        ("run-2", "app-1", "tenant-1", WorkflowRunFileNotReferencedError),
        ("run-1", "app-2", "tenant-1", WorkflowRunFileNotFoundError),
        ("run-1", "app-1", "tenant-2", WorkflowRunFileNotFoundError),
    ],
)
def test_get_for_run_rejects_cross_run_and_cross_app_requests(
    repository: WorkflowRunFileDownloadQueryRepository,
    sqlite_session: Session,
    request_run_id: str,
    request_app_id: str,
    request_tenant_id: str,
    error: type[Exception],
) -> None:
    file_id = str(uuid4())
    sqlite_session.add_all(
        [
            _end_user(user_id="user-1"),
            _run(inputs={"file": {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}}),
            _run(run_id="run-2", inputs={}),
            _upload(file_id=file_id),
        ]
    )
    sqlite_session.commit()

    with pytest.raises(error):
        repository.get_for_run(
            file_id=file_id,
            run_id=request_run_id,
            app_id=request_app_id,
            tenant_id=request_tenant_id,
        )


def test_get_for_run_rejects_upload_created_by_another_app_user(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    run = _run(inputs={"file": {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}})
    sqlite_session.add_all(
        [
            _end_user(user_id="user-1"),
            _end_user(user_id="other-app-user", app_id="app-2"),
            run,
            _upload(file_id=file_id, creator_id="other-app-user"),
        ]
    )
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileAccessDeniedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")


def test_get_for_run_reports_referenced_file_without_database_row_as_not_retained(
    repository: WorkflowRunFileDownloadQueryRepository, sqlite_session: Session
) -> None:
    file_id = str(uuid4())
    sqlite_session.add(
        _run(inputs={"file": {"type": "document", "transfer_method": "local_file", "upload_file_id": file_id}})
    )
    sqlite_session.commit()

    with pytest.raises(WorkflowRunFileNotRetainedError):
        repository.get_for_run(file_id=file_id, run_id="run-1", app_id="app-1", tenant_id="tenant-1")
