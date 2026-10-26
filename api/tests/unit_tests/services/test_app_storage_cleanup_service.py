import json
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError
from sqlalchemy.orm import Session

from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY
from extensions.storage.clickzetta_volume.clickzetta_volume_storage import ClickZettaVolumeStorage
from extensions.storage.huawei_obs_storage import HuaweiObsStorage
from extensions.storage.storage_type import StorageType
from graphon.entities.pause_reason import PauseReasonType
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.file import FileTransferMethod, FileType
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    ExecutionOffLoadType,
    WorkflowRunTriggeredFrom,
)
from models.model import AppMode, Conversation, EndUser, Message, MessageFile, UploadFile
from models.tools import ToolFile
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowPause,
    WorkflowPauseReason,
    WorkflowRun,
)
from models.workflow import WorkflowType as ModelWorkflowType
from services import app_storage_cleanup_service as cleanup


def _offload(
    session: Session,
    app_id: str,
    key: str,
    tenant_id: str = "tenant-1",
    *,
    node_execution_id: str | None = None,
) -> tuple[str, str]:
    file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name="node_execution_outputs.json",
        size=2,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime.now(UTC),
        used=True,
    )
    session.add(file)
    session.flush()
    offload = WorkflowNodeExecutionOffload(
        tenant_id=tenant_id,
        app_id=app_id,
        node_execution_id=node_execution_id,
        type_=ExecutionOffLoadType.OUTPUTS,
        file_id=file.id,
    )
    session.add(offload)
    session.commit()
    return file.id, offload.id


def _tool_execution(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    app_id: str = "source-app",
    root_app_id: str | None = "app-1",
    origin: WorkflowNodeExecutionTriggeredFrom = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
) -> WorkflowNodeExecutionModel:
    execution = WorkflowNodeExecutionModel(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="source-workflow",
        workflow_run_id="run-1",
        node_id="nested-node",
        node_type="code",
        title="Nested code",
        index=1,
        triggered_from=origin,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        process_data=json.dumps({WORKFLOW_TOOL_ROOT_APP_ID_KEY: root_app_id}) if root_app_id else None,
    )
    session.add(execution)
    session.flush()
    return execution


@pytest.fixture
def deleted_keys(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    keys: list[str] = []
    monkeypatch.setattr(cleanup.storage, "delete", keys.append)
    monkeypatch.setattr(cleanup.storage, "scan", lambda _prefix: [])
    return keys


@pytest.mark.parametrize("legacy_owner", [False, True])
def test_nested_offload_cleanup_preserves_retry_references(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, deleted_keys: list[str], legacy_owner: bool
) -> None:
    sqlite_session.add(
        WorkflowRun(
            id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            type=ModelWorkflowType.CHAT,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
    )
    execution = _tool_execution(sqlite_session, root_app_id=None if legacy_owner else "app-1")
    file_id, offload_id = _offload(sqlite_session, "source-app", "nested.json", node_execution_id=execution.id)

    def fail_delete(_key: str) -> None:
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(cleanup.storage, "delete", fail_delete)
    with pytest.raises(RuntimeError, match="storage unavailable"):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None

    monkeypatch.setattr(cleanup.storage, "delete", deleted_keys.append)
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert deleted_keys == ["nested.json"]
    assert sqlite_session.get(UploadFile, file_id) is None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is None


@pytest.mark.parametrize(
    ("tenant_id", "root_app_id", "origin"),
    [
        ("tenant-1", "other-root", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
        ("tenant-2", "app-1", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL),
        ("tenant-1", None, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
        ("tenant-1", "app-1", WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN),
    ],
)
def test_nested_offload_cleanup_preserves_other_owners(
    sqlite_session: Session,
    deleted_keys: list[str],
    tenant_id: str,
    root_app_id: str | None,
    origin: WorkflowNodeExecutionTriggeredFrom,
) -> None:
    execution = _tool_execution(sqlite_session, tenant_id=tenant_id, root_app_id=root_app_id, origin=origin)
    file_id, offload_id = _offload(
        sqlite_session, "source-app", "foreign.json", tenant_id, node_execution_id=execution.id
    )

    cleanup.cleanup_app_storage("tenant-1", "app-1")

    sqlite_session.expire_all()
    assert deleted_keys == []
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None


@pytest.mark.parametrize("shared_owner", ["same-root", "other-root", "other-source", "other-tenant", "orphan"])
def test_nested_offload_cleanup_checks_all_shared_references(
    sqlite_session: Session, deleted_keys: list[str], shared_owner: str
) -> None:
    execution = _tool_execution(sqlite_session)
    file_id, offload_id = _offload(sqlite_session, "source-app", "shared.json", node_execution_id=execution.id)
    shared_execution = None
    if shared_owner in {"same-root", "other-root"}:
        shared_execution = _tool_execution(
            sqlite_session,
            app_id="other-source",
            root_app_id="app-1" if shared_owner == "same-root" else "other-app",
        )
    shared = WorkflowNodeExecutionOffload(
        tenant_id="tenant-2" if shared_owner == "other-tenant" else "tenant-1",
        app_id="other-source" if shared_owner in {"same-root", "other-root", "other-source"} else "source-app",
        node_execution_id=shared_execution.id if shared_execution is not None else None,
        type_=ExecutionOffLoadType.INPUTS,
        file_id=file_id,
    )
    sqlite_session.add(shared)
    sqlite_session.commit()
    shared_id = shared.id

    cleanup.cleanup_app_storage("tenant-1", "app-1")

    sqlite_session.expire_all()
    retained = shared_owner != "same-root"
    assert set(deleted_keys) == (set() if retained else {"shared.json"})
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is None
    assert (sqlite_session.get(WorkflowNodeExecutionOffload, shared_id) is not None) == retained
    assert (sqlite_session.get(UploadFile, file_id) is not None) == retained


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    mock = MagicMock()
    mock.scan.return_value = list[str]()
    monkeypatch.setattr(cleanup, "storage", mock)
    return mock


def test_cleanup_removes_owned_offloads_and_preserves_other_owners(sqlite_session: Session, storage: MagicMock) -> None:
    owned = _offload(sqlite_session, "app-1", "owned.json")
    other_app = _offload(sqlite_session, "app-2", "other-app.json")
    other_tenant = _offload(sqlite_session, "app-1", "other-tenant.json", "tenant-2")

    cleanup.cleanup_app_storage("tenant-1", "app-1")
    cleanup.cleanup_app_storage("tenant-1", "app-1")

    storage.delete.assert_called_once_with("owned.json")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, owned[0]) is None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, owned[1]) is None
    for file_id, offload_id in (other_app, other_tenant):
        assert sqlite_session.get(UploadFile, file_id) is not None
        assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None


def test_storage_failure_retains_references_for_retry(sqlite_session: Session, storage: MagicMock) -> None:
    file_id, offload_id = _offload(sqlite_session, "app-1", "owned.json")
    storage.delete.side_effect = RuntimeError("storage unavailable")
    storage.exists.return_value = True

    with pytest.raises(RuntimeError, match="storage unavailable"):
        cleanup.cleanup_app_storage("tenant-1", "app-1")

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None

    storage.delete.side_effect = None
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is None


def test_missing_object_allows_redelivery(sqlite_session: Session, storage: MagicMock) -> None:
    file_id, _ = _offload(sqlite_session, "app-1", "owned.json")
    storage.delete.side_effect = FileNotFoundError()
    storage.exists.return_value = False

    cleanup.cleanup_app_storage("tenant-1", "app-1")

    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is None


def test_access_denied_retains_references_even_if_exists_returns_false(
    sqlite_session: Session, storage: MagicMock
) -> None:
    file_id, offload_id = _offload(sqlite_session, "app-1", "owned.json")
    storage.delete.side_effect = ClientError({"Error": {"Code": "AccessDenied"}}, "DeleteObject")
    storage.exists.return_value = False
    with pytest.raises(ClientError):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None
    storage.exists.assert_not_called()


def test_obs_delete_failure_preserves_retry_references(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    file_id, offload_id = _offload(sqlite_session, "app-1", "owned.json")
    backend = HuaweiObsStorage.__new__(HuaweiObsStorage)
    backend.bucket_name = "bucket"
    backend.client = MagicMock()
    backend.client.deleteObject.return_value = SimpleNamespace(status=403, errorCode="AccessDenied")
    monkeypatch.setattr(cleanup, "storage", backend)
    with pytest.raises(RuntimeError, match="403"):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None


def test_clickzetta_failed_existence_check_preserves_retry_references(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    file_id, offload_id = _offload(sqlite_session, "app-1", "owned.json")
    backend = ClickZettaVolumeStorage.__new__(ClickZettaVolumeStorage)
    monkeypatch.setattr(backend, "_config", SimpleNamespace(volume_type="user", dify_prefix="dify"), raising=False)
    monkeypatch.setattr(backend, "_execute_sql", MagicMock(side_effect=RuntimeError("backend unavailable")))
    monkeypatch.setattr(cleanup, "storage", backend)
    with pytest.raises(RuntimeError, match="backend unavailable"):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None


def test_shared_offload_file_is_retained(sqlite_session: Session, storage: MagicMock) -> None:
    file_id, offload_id = _offload(sqlite_session, "app-1", "shared.json")
    shared = WorkflowNodeExecutionOffload(
        tenant_id="tenant-1",
        app_id="app-2",
        node_execution_id=None,
        type_=ExecutionOffLoadType.INPUTS,
        file_id=file_id,
    )
    sqlite_session.add(shared)
    sqlite_session.commit()

    cleanup.cleanup_app_storage("tenant-1", "app-1")

    storage.delete.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, file_id) is not None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is None
    assert sqlite_session.get(WorkflowNodeExecutionOffload, shared.id) is not None


def test_trace_cleanup_stays_within_app_prefix(sqlite_session: Session, storage: MagicMock) -> None:
    _end_user(sqlite_session)
    storage.scan.return_value = ["ops_trace/app-1/trace.json"]
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    storage.delete.assert_called_once_with("ops_trace/app-1/trace.json")

    storage.reset_mock()
    storage.scan.return_value = ["ops_trace/app-2/trace.json"]
    with pytest.raises(ValueError, match="outside application prefix"):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    storage.delete.assert_not_called()


def _end_user(session: Session) -> EndUser:
    user = EndUser(tenant_id="tenant-1", app_id="app-1", type=EndUserType.SERVICE_API, session_id="session")
    session.add(user)
    session.commit()
    return user


def test_wrong_tenant_does_not_scan_traces(sqlite_session: Session, storage: MagicMock) -> None:
    _end_user(sqlite_session)
    cleanup.cleanup_app_storage("tenant-2", "app-1")
    storage.scan.assert_not_called()


@pytest.mark.parametrize("fails", [False, True])
def test_pause_files_and_reasons_are_removed_only_after_storage_success(
    sqlite_session: Session, storage: MagicMock, fails: bool
) -> None:
    run = WorkflowRun(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=ModelWorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    sqlite_session.add(run)
    sqlite_session.flush()
    pause = WorkflowPause(workflow_id="workflow-1", workflow_run_id=run.id, state_object_key="pause.json")
    sqlite_session.add(pause)
    sqlite_session.flush()
    reason = WorkflowPauseReason(pause_id=pause.id, type_=PauseReasonType.HITL_REQUIRED)
    sqlite_session.add(reason)
    sqlite_session.commit()
    pause_id, reason_id = pause.id, reason.id
    if fails:
        storage.delete.side_effect = RuntimeError("unavailable")
        storage.exists.return_value = True
        with pytest.raises(RuntimeError):
            cleanup.cleanup_app_storage("tenant-1", "app-1")
    else:
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert (sqlite_session.get(WorkflowPause, pause_id) is not None) == fails
    assert (sqlite_session.get(WorkflowPauseReason, reason_id) is not None) == fails
    assert sqlite_session.get(WorkflowRun, run.id) is not None


@pytest.mark.parametrize("fails", [False, True])
def test_end_user_files_are_cleaned_before_owner_records(
    sqlite_session: Session, storage: MagicMock, fails: bool
) -> None:
    user = _end_user(sqlite_session)
    tool = ToolFile(
        tenant_id="tenant-1",
        user_id=user.id,
        conversation_id=None,
        file_key="tools/owned.json",
        mimetype="application/json",
    )
    sqlite_session.add(tool)
    file_id, offload_id = _offload(sqlite_session, "app-2", "upload_files/owned.txt")
    offload = sqlite_session.get(WorkflowNodeExecutionOffload, offload_id)
    assert offload is not None
    sqlite_session.delete(offload)
    upload = sqlite_session.get(UploadFile, file_id)
    assert upload is not None
    upload.created_by_role = CreatorUserRole.END_USER
    upload.created_by = user.id
    sqlite_session.commit()
    tool_id = tool.id
    if fails:
        storage.delete.side_effect = RuntimeError("unavailable")
        storage.exists.return_value = True
        with pytest.raises(RuntimeError):
            cleanup.cleanup_app_storage("tenant-1", "app-1")
    else:
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    assert (sqlite_session.get(ToolFile, tool_id) is not None) == fails
    assert (sqlite_session.get(UploadFile, file_id) is not None) == fails
    assert sqlite_session.get(EndUser, user.id) is not None


def test_shared_message_files_are_retained(sqlite_session: Session, storage: MagicMock) -> None:
    user = _end_user(sqlite_session)
    tool = ToolFile(
        tenant_id="tenant-1",
        user_id=user.id,
        conversation_id=None,
        file_key="tools/shared.json",
        mimetype="application/json",
    )
    sqlite_session.add(tool)
    file_id, _ = _offload(sqlite_session, "app-2", "upload_files/shared.txt")
    upload = sqlite_session.get(UploadFile, file_id)
    assert upload is not None
    upload.created_by_role = CreatorUserRole.END_USER
    upload.created_by = user.id
    conversation = Conversation(
        app_id="app-2", mode=AppMode.CHAT, name="other app", _inputs={}, from_source=ConversationFromSource.API
    )
    sqlite_session.add(conversation)
    sqlite_session.flush()
    message = Message(
        app_id="app-2",
        conversation_id=conversation.id,
        _inputs={},
        query="q",
        message={},
        message_unit_price=Decimal(0),
        answer="a",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    sqlite_session.add(message)
    sqlite_session.flush()
    for record_id, method in ((tool.id, FileTransferMethod.TOOL_FILE), (file_id, FileTransferMethod.LOCAL_FILE)):
        sqlite_session.add(
            MessageFile(
                message_id=message.id,
                type=FileType.DOCUMENT,
                transfer_method=method,
                upload_file_id=record_id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=user.id,
            )
        )
    sqlite_session.commit()
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    storage.delete.assert_not_called()
    sqlite_session.expire_all()
    assert sqlite_session.get(ToolFile, tool.id) is not None
    assert sqlite_session.get(UploadFile, file_id) is not None


def test_partial_batch_failure_can_retry_already_deleted_objects(sqlite_session: Session, storage: MagicMock) -> None:
    first = _offload(sqlite_session, "app-1", "first.json")
    second = _offload(sqlite_session, "app-1", "second.json")
    storage.delete.side_effect = [None, RuntimeError("unavailable")]
    storage.exists.return_value = True
    with pytest.raises(RuntimeError):
        cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    for file_id, offload_id in (first, second):
        assert sqlite_session.get(UploadFile, file_id) is not None
        assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is not None
    storage.delete.side_effect = [FileNotFoundError(), None]
    storage.exists.return_value = False
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    sqlite_session.expire_all()
    for file_id, offload_id in (first, second):
        assert sqlite_session.get(UploadFile, file_id) is None
        assert sqlite_session.get(WorkflowNodeExecutionOffload, offload_id) is None


def test_conversation_owned_tools_are_cleaned_and_account_assets_retained(
    sqlite_session: Session, storage: MagicMock
) -> None:
    conversation = Conversation(
        app_id="app-1", mode=AppMode.CHAT, name="owned", _inputs={}, from_source=ConversationFromSource.CONSOLE
    )
    sqlite_session.add(conversation)
    sqlite_session.flush()
    owned = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=conversation.id,
        file_key="tools/owned.json",
        mimetype="application/json",
    )
    workspace = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=None,
        file_key="tools/workspace.json",
        mimetype="application/json",
    )
    foreign = ToolFile(
        tenant_id="tenant-2",
        user_id="account-1",
        conversation_id=conversation.id,
        file_key="tools/foreign.json",
        mimetype="application/json",
    )
    sqlite_session.add_all([owned, workspace, foreign])
    sqlite_session.commit()
    owned_id, workspace_id, foreign_id = owned.id, workspace.id, foreign.id
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    storage.delete.assert_called_once_with("tools/owned.json")
    sqlite_session.expire_all()
    assert sqlite_session.get(ToolFile, owned_id) is None
    assert sqlite_session.get(ToolFile, workspace_id) is not None
    assert sqlite_session.get(ToolFile, foreign_id) is not None


def test_tool_with_conflicting_conversation_owner_is_retained(sqlite_session: Session, storage: MagicMock) -> None:
    user = _end_user(sqlite_session)
    tool = ToolFile(
        tenant_id="tenant-1",
        user_id=user.id,
        conversation_id="another-app-conversation",
        file_key="tools/shared.json",
        mimetype="application/json",
    )
    sqlite_session.add(tool)
    sqlite_session.commit()
    cleanup.cleanup_app_storage("tenant-1", "app-1")
    storage.delete.assert_not_called()
    assert sqlite_session.get(ToolFile, tool.id) is not None
