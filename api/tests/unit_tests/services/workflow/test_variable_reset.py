"""Reset/delete transactions end before object storage is accessed."""

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from functools import partial

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from extensions.application_services.workflow_variables import build_workflow_variable_service
from extensions.ext_storage import storage
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.variables import StringSegment, StringVariable
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from models import UploadFile, Workflow
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from repositories.workflow.draft_variable_repository import WorkflowDraftVariableRepository
from services.file_service import FileService
from services.workflow.draft_variable_service import VariableResetError
from services.workflow.variable_contracts import DraftVariableChangedError
from tasks.workflow_draft_var_tasks import cleanup_draft_variable_files_task, recover_draft_variable_file_cleanup_task
from tests.unit_tests.model_factories import make_account, make_workflow


@dataclass
class VariableCase:
    factory: sessionmaker[Session]
    workflow: Workflow
    variable: WorkflowDraftVariable
    sessions: list[Session] = field(default_factory=list)
    contents: dict[str, bytes] = field(default_factory=dict)
    deleted: list[str] = field(default_factory=list)

    def assert_no_transaction(self) -> None:
        assert all(not session.in_transaction() for session in self.sessions)

    def upload(self, key: str, data: bytes) -> None:
        self.assert_no_transaction()
        self.contents[key] = data

    def download(self, key: str) -> bytes:
        self.assert_no_transaction()
        return self.contents[key]

    def delete(self, key: str) -> None:
        self.assert_no_transaction()
        self.contents.pop(key, None)
        self.deleted.append(key)

    def attach_file(self, *, execution: bool) -> tuple[str, str]:
        content = json.dumps({"text": "full output"}).encode() if execution else b"old variable value"
        upload = FileService(self.factory).upload_file(
            filename="output.json",
            content=content,
            mimetype="application/json",
            user=make_account(),
            tenant_id=self.workflow.tenant_id,
        )
        with self.factory.begin() as session:
            if execution:
                metadata = WorkflowNodeExecutionOffload(
                    tenant_id=self.workflow.tenant_id,
                    app_id=self.workflow.app_id,
                    node_execution_id=self.variable.node_execution_id,
                    type_=ExecutionOffLoadType.OUTPUTS,
                    file_id=upload.id,
                )
            else:
                assert self.variable.user_id is not None
                metadata = WorkflowDraftVariableFile(
                    tenant_id=self.workflow.tenant_id,
                    app_id=self.workflow.app_id,
                    user_id=self.variable.user_id,
                    upload_file_id=upload.id,
                    size=len(content),
                    length=len(content),
                    value_type=SegmentType.STRING,
                )
                variable = session.get(WorkflowDraftVariable, self.variable.id)
                assert variable is not None
                variable.file_id = metadata.id
            session.add(metadata)
        assert self.variable.user_id is not None
        variable = WorkflowDraftVariableRepository(sessions=self.factory).get_variable(
            self.variable.id, app_id=self.variable.app_id, user_id=self.variable.user_id
        )
        assert variable is not None
        self.variable = variable
        return metadata.id, upload.key


@pytest.fixture
def case(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[VariableCase]:
    workflow = make_workflow(graph={"nodes": [{"id": "node", "data": {"type": "llm"}}], "edges": []})
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=workflow.app_id,
        node_id="node",
        name="text",
        value=StringSegment(value="edited"),
        node_execution_id="execution",
        user_id="account-1",
        editable=True,
    )
    variable.last_edited_at = naive_utc_now()
    execution = WorkflowNodeExecutionModel(
        id="execution",
        tenant_id=workflow.tenant_id,
        app_id=workflow.app_id,
        workflow_id=workflow.id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
        index=1,
        node_id="node",
        node_type="llm",
        title="LLM",
        outputs=json.dumps({"text": "original", "sys.query": "original query", "sys.files": []}),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    result = VariableCase(sqlite_session_factory, workflow, variable)

    def track(session: Session, _transaction: object, _connection: object) -> None:
        result.sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", track)
    monkeypatch.setattr(storage, "save", result.upload)
    monkeypatch.setattr(storage, "load", result.download)
    monkeypatch.setattr(storage, "delete", result.delete)
    with sqlite_session_factory.begin() as session:
        session.add_all([workflow, variable, execution])
    yield result
    event.remove(sqlite_session_factory, "after_begin", track)


def test_reset_offloaded_output_reads_after_sessions_close(case: VariableCase) -> None:
    _, output_key = case.attach_file(execution=True)
    metadata_id, old_key = case.attach_file(execution=False)
    service = build_workflow_variable_service(database_client=case.factory)
    result = service.reset_variable(case.workflow, case.variable)
    assert result is not None
    assert result.get_value().value == "full output"
    assert result.last_edited_at is None
    assert result.file_id is None
    assert case.deleted == [old_key]
    assert output_key in case.contents
    case.assert_no_transaction()
    with case.factory() as session:
        persisted = session.get(WorkflowDraftVariable, case.variable.id)
        assert persisted is not None
        assert persisted.get_value().value == "full output"
        assert persisted.file_id is None
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None


@pytest.mark.parametrize("operation", ["reset", "delete", "update", "node-delete", "all-delete"])
def test_commit_failure_never_deletes_variable_file(case: VariableCase, operation: str) -> None:
    metadata_id, key = case.attach_file(execution=False)
    service = build_workflow_variable_service(database_client=case.factory)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(case.factory, "before_commit", fail_commit)
    assert case.variable.user_id is not None
    mutate = {
        "reset": partial(service.reset_variable, case.workflow, case.variable),
        "delete": partial(service.delete_variable, case.variable),
        "update": partial(service.update_variable, case.variable, value=StringSegment(value="new value")),
        "node-delete": partial(
            service.delete_node_variables, case.variable.app_id, case.variable.node_id, case.variable.user_id
        ),
        "all-delete": partial(service.delete_user_workflow_variables, case.variable.app_id, case.variable.user_id),
    }[operation]
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            mutate()
    finally:
        event.remove(case.factory, "before_commit", fail_commit)
    assert not case.deleted
    assert key in case.contents
    case.assert_no_transaction()
    with case.factory() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        assert variable.file_id == metadata_id
        assert variable.get_value().value == "edited"
        assert session.get(WorkflowDraftVariableFile, metadata_id) is not None


@pytest.mark.parametrize("operation", ["update", "delete", "reset"])
def test_all_single_variable_mutations_reject_stale_snapshots(case: VariableCase, operation: str) -> None:
    metadata_id, key = case.attach_file(execution=False)
    with case.factory.begin() as session:
        current = session.get(WorkflowDraftVariable, case.variable.id)
        assert current is not None
        current.set_value(StringSegment(value="concurrent edit"))
    service = build_workflow_variable_service(database_client=case.factory)
    mutate = {
        "reset": partial(service.reset_variable, case.workflow, case.variable),
        "delete": partial(service.delete_variable, case.variable),
        "update": partial(service.update_variable, case.variable, name="renamed"),
    }[operation]
    with pytest.raises(DraftVariableChangedError):
        mutate()
    assert key in case.contents
    assert not case.deleted
    case.assert_no_transaction()
    with case.factory() as session:
        current = session.get(WorkflowDraftVariable, case.variable.id)
        assert current is not None
        assert current.get_value().value == "concurrent edit"
        assert current.name == "text"
        assert session.get(WorkflowDraftVariableFile, metadata_id) is not None


@pytest.mark.parametrize("replace_value", [False, True])
def test_update_commits_detached_result_and_only_reclaims_replaced_files(
    case: VariableCase, replace_value: bool
) -> None:
    metadata_id, key = case.attach_file(execution=False)
    service = build_workflow_variable_service(database_client=case.factory)
    result = service.update_variable(
        case.variable, name="renamed", value=StringSegment(value="new value") if replace_value else None
    )
    assert result.name == "renamed"
    assert result.get_selector() == ["node", "renamed"]
    assert result.last_edited_at is not None
    assert case.variable.name == "text"
    assert case.deleted == ([key] if replace_value else [])
    assert result.file_id == (None if replace_value else metadata_id)
    assert (result.variable_file is None) == replace_value
    case.assert_no_transaction()
    with case.factory() as session:
        persisted = session.get(WorkflowDraftVariable, result.id)
        assert persisted is not None
        assert persisted.name == "renamed"
        assert persisted.get_value().value == ("new value" if replace_value else "edited")


@pytest.mark.parametrize("operation", ["node-delete", "all-delete"])
def test_bulk_delete_scopes_rows_and_cleans_files_after_commit(case: VariableCase, operation: str) -> None:
    metadata_id, key = case.attach_file(execution=False)
    assert case.variable.user_id is not None
    foreign = WorkflowDraftVariable.new_node_variable(
        app_id=case.variable.app_id,
        user_id="other-user",
        node_id="node",
        name="text",
        value=StringSegment(value="foreign"),
        node_execution_id="foreign-execution",
    )
    with case.factory.begin() as session:
        session.add(foreign)
    service = build_workflow_variable_service(database_client=case.factory)
    assert service.get_variable(case.variable.id, app_id="other-app", user_id=case.variable.user_id) is None
    assert service.get_variable(case.variable.id, app_id=case.variable.app_id, user_id="other-user") is None
    if operation == "node-delete":
        service.delete_node_variables(case.variable.app_id, "node", case.variable.user_id)
    else:
        service.delete_user_workflow_variables(case.variable.app_id, case.variable.user_id)
    assert case.deleted == [key]
    case.assert_no_transaction()
    with case.factory() as session:
        assert session.get(WorkflowDraftVariable, case.variable.id) is None
        assert session.get(WorkflowDraftVariable, foreign.id) is not None
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None


def test_delete_cleans_storage_only_after_variable_commit(case: VariableCase, monkeypatch: pytest.MonkeyPatch) -> None:
    metadata_id, key = case.attach_file(execution=False)

    def delete(key: str) -> None:
        case.assert_no_transaction()
        with case.factory() as session:
            assert session.get(WorkflowDraftVariable, case.variable.id) is None
        case.delete(key)

    monkeypatch.setattr(storage, "delete", delete)
    service = build_workflow_variable_service(database_client=case.factory)
    service.delete_variable(case.variable)
    assert case.deleted == [key]
    with case.factory() as session:
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None
    # A repeated deletion is harmless.
    service.delete_variable(case.variable)
    assert case.deleted == [key]


@pytest.mark.parametrize("operation", ["reset", "delete"])
def test_cleanup_failure_keeps_metadata_and_task_retries(
    case: VariableCase, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    metadata_id, key = case.attach_file(execution=False)
    queued: list[list[str]] = []

    def fail_delete(_key: str) -> None:
        case.assert_no_transaction()
        raise OSError("storage unavailable")

    monkeypatch.setattr(storage, "delete", fail_delete)
    monkeypatch.setattr(cleanup_draft_variable_files_task, "delay", queued.append)
    service = build_workflow_variable_service(database_client=case.factory)
    if operation == "reset":
        service.reset_variable(case.workflow, case.variable)
    else:
        service.delete_variable(case.variable)
    assert case.variable.variable_file is not None
    assert queued == [[case.variable.variable_file.upload_file_id]]
    with case.factory() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is None if operation == "delete" else variable is not None and variable.file_id is None
        metadata = session.get(WorkflowDraftVariableFile, metadata_id)
        assert metadata is not None
        upload_id = metadata.upload_file_id
        assert session.get(UploadFile, upload_id) is not None
    monkeypatch.setattr(storage, "delete", case.delete)
    cleanup_draft_variable_files_task.run(queued[0])
    cleanup_draft_variable_files_task.run(queued[0])
    assert case.deleted == [key]
    with case.factory() as session:
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None
        assert session.get(UploadFile, upload_id) is None


def test_cleanup_does_not_delete_referenced_file(case: VariableCase) -> None:
    metadata_id, key = case.attach_file(execution=False)
    assert case.variable.variable_file is not None
    cleanup_draft_variable_files_task.run([case.variable.variable_file.upload_file_id])
    assert not case.deleted
    assert key in case.contents


def test_cleanup_commit_failure_can_retry_an_already_deleted_object(
    case: VariableCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    metadata_id, key = case.attach_file(execution=False)
    queued: list[list[str]] = []
    monkeypatch.setattr(cleanup_draft_variable_files_task, "delay", queued.append)

    def fail_metadata_commit(session: Session) -> None:
        if any(isinstance(item, WorkflowDraftVariableFile) for item in session.deleted):
            raise RuntimeError("metadata commit failed")

    event.listen(case.factory, "before_commit", fail_metadata_commit)
    try:
        build_workflow_variable_service(database_client=case.factory).delete_variable(case.variable)
    finally:
        event.remove(case.factory, "before_commit", fail_metadata_commit)
    assert case.deleted == [key]
    assert case.variable.variable_file is not None
    assert queued == [[case.variable.variable_file.upload_file_id]]
    with case.factory() as session:
        assert session.get(WorkflowDraftVariable, case.variable.id) is None
        assert session.get(WorkflowDraftVariableFile, metadata_id) is not None
    cleanup_draft_variable_files_task.run(queued[0])
    with case.factory() as session:
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None


def test_storage_read_failure_preserves_variable(case: VariableCase, monkeypatch: pytest.MonkeyPatch) -> None:
    case.attach_file(execution=True)

    def fail_load(_key: str) -> bytes:
        case.assert_no_transaction()
        raise OSError("cannot read output")

    monkeypatch.setattr(storage, "load", fail_load)
    with pytest.raises(OSError, match="cannot read output"):
        build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, case.variable)
    with case.factory() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        assert variable.get_value().value == "edited"
        assert variable.last_edited_at is not None


def test_reset_rejects_concurrent_edit_during_storage_read(case: VariableCase, monkeypatch: pytest.MonkeyPatch) -> None:
    case.attach_file(execution=True)

    def edit_during_load(key: str) -> bytes:
        contents = case.download(key)
        with case.factory.begin() as session:
            variable = session.get(WorkflowDraftVariable, case.variable.id)
            assert variable is not None
            variable.set_value(StringSegment(value="concurrent edit"))
        return contents

    monkeypatch.setattr(storage, "load", edit_during_load)
    with pytest.raises(DraftVariableChangedError):
        build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, case.variable)
    with case.factory() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        assert variable.get_value().value == "concurrent edit"


@pytest.mark.parametrize(
    ("node_id", "name", "expected"),
    [("node", "text", "original"), ("sys", "query", "original query"), ("sys", "files", [])],
)
def test_reset_inline_output(case: VariableCase, node_id: str, name: str, expected: object) -> None:
    with case.factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        variable.node_id = node_id
        variable.set_name(name)
        if name == "files":
            variable.value_type = SegmentType.ARRAY_FILE
        session.flush()
        session.refresh(variable)
    result = build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, variable)
    assert result is not None
    assert result.get_value().value == expected
    assert result.last_edited_at is None


@pytest.mark.parametrize("has_default", [True, False])
def test_reset_conversation_default_or_delete(case: VariableCase, has_default: bool) -> None:
    case.workflow.conversation_variables = [StringVariable(name="text", value="default")] if has_default else []
    with case.factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        variable.node_id = "conversation"
        session.flush()
        session.refresh(variable)
    result = build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, variable)
    if has_default:
        assert result is not None
        assert result.get_value().value == "default"
    else:
        assert result is None
    with case.factory() as session:
        assert (session.get(WorkflowDraftVariable, variable.id) is not None) == has_default


@pytest.mark.parametrize("reason", ["missing_id", "missing_execution", "missing_output", "other_tenant", "other_app"])
def test_reset_missing_execution_value_deletes_variable(case: VariableCase, reason: str) -> None:
    with case.factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        execution = session.get(WorkflowNodeExecutionModel, "execution")
        assert variable is not None
        assert execution is not None
        if reason == "missing_id":
            variable.node_execution_id = None
        elif reason == "missing_execution":
            session.delete(execution)
        elif reason == "missing_output":
            execution.outputs = "{}"
        elif reason == "other_tenant":
            execution.tenant_id = "other-tenant"
        else:
            execution.app_id = "other-app"
        session.flush()
        session.refresh(variable)
    assert build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, variable) is None
    with case.factory() as session:
        assert session.get(WorkflowDraftVariable, variable.id) is None


def test_cannot_reset_immutable_system_variable(case: VariableCase) -> None:
    with case.factory.begin() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        assert variable is not None
        variable.node_id = "sys"
        variable.set_name("workflow_id")
        session.flush()
        session.refresh(variable)
    with pytest.raises(VariableResetError, match="cannot reset system variable"):
        build_workflow_variable_service(database_client=case.factory).reset_variable(case.workflow, variable)


@pytest.mark.parametrize("operation", ["update", "reset", "delete", "node-delete", "all-delete"])
@pytest.mark.parametrize("interrupted", [False, True])
def test_committed_mutation_recovers_cleanup_without_successful_task_delivery(
    case: VariableCase, monkeypatch: pytest.MonkeyPatch, operation: str, interrupted: bool
) -> None:
    metadata_id, key = case.attach_file(execution=False)
    assert case.variable.variable_file is not None
    upload_id = case.variable.variable_file.upload_file_id
    attempted: list[list[str]] = []

    def unavailable_storage(_key: str) -> None:
        case.assert_no_transaction()
        raise OSError("storage unavailable")

    def unavailable_queue(ids: list[str]) -> None:
        case.assert_no_transaction()
        attempted.append(ids)
        raise OSError("broker unavailable")

    monkeypatch.setattr(storage, "delete", unavailable_storage)
    monkeypatch.setattr(cleanup_draft_variable_files_task, "delay", unavailable_queue)
    service = build_workflow_variable_service(database_client=case.factory)
    if interrupted:
        # Simulate a worker that dies after commit and never starts immediate cleanup.
        monkeypatch.setattr(service, "_cleanup_or_defer", lambda _ids: None)
    assert case.variable.user_id is not None
    mutate = {
        "update": partial(service.update_variable, case.variable, value=StringSegment(value="new")),
        "reset": partial(service.reset_variable, case.workflow, case.variable),
        "delete": partial(service.delete_variable, case.variable),
        "node-delete": partial(
            service.delete_node_variables, case.variable.app_id, case.variable.node_id, case.variable.user_id
        ),
        "all-delete": partial(service.delete_user_workflow_variables, case.variable.app_id, case.variable.user_id),
    }[operation]
    mutate()  # The committed result must remain successful when both I/O paths fail.
    assert attempted == ([] if interrupted else [[upload_id]])
    with case.factory() as session:
        variable = session.get(WorkflowDraftVariable, case.variable.id)
        if operation in {"update", "reset"}:
            assert variable is not None
            assert variable.file_id is None
            assert variable.get_value().value == ("new" if operation == "update" else "original")
        else:
            assert variable is None
        assert session.get(WorkflowDraftVariableFile, metadata_id) is not None
        assert session.get(UploadFile, upload_id) is not None
    # Recovery discovers the request from the database; no in-memory ID list or
    # successfully delivered original Celery message is needed.
    monkeypatch.setattr(storage, "delete", case.delete)
    recover_draft_variable_file_cleanup_task.run()
    recover_draft_variable_file_cleanup_task.run()
    assert case.deleted == [key]
    with case.factory() as session:
        assert session.get(WorkflowDraftVariableFile, metadata_id) is None
        assert session.get(UploadFile, upload_id) is None
