import json
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast

import pytest
from sqlalchemy import delete, event, insert, select, update
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql import Select

from core.workflow.file_reference import build_file_reference
from graphon.file import FileTransferMethod, FileType
from graphon.variables import SegmentType, StringSegment
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigToolFileReference,
    AgentConfigUploadFileReference,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
)
from models.agent_config_entities import AgentConfigFileRefConfig, AgentConfigSkillRefConfig, AgentSoulConfig
from models.dataset import Dataset, Document, DocumentSegment, PipelineCustomizedTemplate, SegmentAttachmentBinding
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    CustomizeTokenStrategy,
    DataSourceType,
    ExecutionOffLoadType,
    SegmentStatus,
)
from models.human_input import HumanInputFormUploadFile
from models.model import (
    App,
    AppMode,
    Conversation,
    IconType,
    KnowledgeUploadFileReference,
    Message,
    MessageFile,
    Site,
    UploadFile,
)
from models.snippet import CustomizedSnippet, SnippetType
from models.tools import MCPToolProvider, ToolFile
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowDraftVariableUploadFileReference,
    WorkflowNodeExecutionOffload,
)
from repositories.knowledge.upload_file_repository import (
    AgentConfigToolFileCleanup,
    build_document_cleanup_manifest,
    build_segment_cleanup_manifest,
    claim_detached_icon_upload_references,
    claim_orphan_agent_config_tool_files,
    claim_orphan_upload_files,
    delete_orphan_upload_files,
    detach_agent_config_versions_and_claim_uploads,
    detach_workflow_draft_variable_files_and_claim_uploads,
    detach_workflow_draft_variables_and_claim_uploads,
    extract_agent_config_tool_file_ids,
    extract_document_source_file_ids,
    fence_workflow_draft_variable_upload_file_upsert,
    filter_inline_image_ids_without_active_references,
    find_orphan_upload_files,
    guard_account_avatar_upload_reference,
    guard_agent_config_normalized_tool_reference,
    guard_agent_config_normalized_upload_reference,
    guard_agent_config_upload_references,
    guard_agent_icon_upload_reference,
    guard_app_icon_upload_reference,
    guard_dataset_icon_upload_reference,
    guard_human_input_upload_reference,
    guard_knowledge_owner_upload_references,
    guard_knowledge_upload_reference,
    guard_local_message_file_upload_reference,
    guard_mcp_icon_upload_reference,
    guard_pipeline_template_icon_upload_reference,
    guard_segment_attachment_upload_reference,
    guard_site_icon_upload_reference,
    guard_snippet_icon_upload_reference,
    guard_tenant_logo_upload_reference,
    guard_workflow_draft_variable_file_upload_reference,
    guard_workflow_draft_variable_normalized_upload_reference,
    guard_workflow_draft_variable_upload_references,
    guard_workflow_node_execution_offload_upload_reference,
    prepare_agent_config_deletion,
    prepare_icon_owner_deletion,
    recheck_claimed_orphan_upload_files,
    register_upload_file_reference_guards,
    remove_agent_config_upload_references,
    remove_document_upload_file_references,
    replace_document_upload_file_references,
    replace_segment_attachment_bindings,
    replace_segment_image_upload_file_references,
    snapshot_and_detach_app_upload_files,
    sync_agent_config_upload_references,
    sync_knowledge_owner_upload_references,
    sync_workflow_draft_variable_upload_references,
    synchronize_workflow_draft_variable_upload_file_upsert,
    track_created_agent_config_tool_files,
)
from services.agent_config_service import (
    AgentConfigService,
    AgentConfigVersionKind,
    ConfigPushFileItem,
    ConfigPushPayload,
    ConfigPushSkillItem,
)
from services.knowledge.indexing.cleanup import UploadFileCleanup, UploadFilePendingDeletionError
from services.knowledge.resource_scope import DatasetRef
from services.workflow_draft_variable_service import _batch_upsert_draft_variable
from tests.unit_tests.model_factories import (
    make_account,
    make_app,
    make_conversation,
    make_message,
    make_tenant,
    make_upload_file,
    make_workflow,
)
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document


def _draft_file(*, owner_id: str, app_id: str, upload_file_id: str) -> WorkflowDraftVariableFile:
    owner = WorkflowDraftVariableFile(
        tenant_id="tenant-1",
        app_id=app_id,
        user_id="account-1",
        upload_file_id=upload_file_id,
        size=10,
        length=None,
        value_type=SegmentType.STRING,
    )
    owner.id = owner_id
    return owner


@contextmanager
def _registered_upload_reference_guards() -> Generator[None]:
    icon_owner_models = (
        App,
        Site,
        Account,
        Tenant,
        Dataset,
        PipelineCustomizedTemplate,
        Agent,
        CustomizedSnippet,
        MCPToolProvider,
    )
    before_listeners = (
        (MessageFile, guard_local_message_file_upload_reference),
        (App, guard_app_icon_upload_reference),
        (Site, guard_site_icon_upload_reference),
        (Account, guard_account_avatar_upload_reference),
        (Tenant, guard_tenant_logo_upload_reference),
        (Dataset, guard_dataset_icon_upload_reference),
        (PipelineCustomizedTemplate, guard_pipeline_template_icon_upload_reference),
        (Agent, guard_agent_icon_upload_reference),
        (CustomizedSnippet, guard_snippet_icon_upload_reference),
        (MCPToolProvider, guard_mcp_icon_upload_reference),
        (AgentConfigDraft, guard_agent_config_upload_references),
        (AgentConfigSnapshot, guard_agent_config_upload_references),
        (AgentConfigUploadFileReference, guard_agent_config_normalized_upload_reference),
        (AgentConfigToolFileReference, guard_agent_config_normalized_tool_reference),
        (WorkflowDraftVariable, guard_workflow_draft_variable_upload_references),
        (KnowledgeUploadFileReference, guard_knowledge_upload_reference),
        (SegmentAttachmentBinding, guard_segment_attachment_upload_reference),
        (
            WorkflowDraftVariableUploadFileReference,
            guard_workflow_draft_variable_normalized_upload_reference,
        ),
        (WorkflowDraftVariableFile, guard_workflow_draft_variable_file_upload_reference),
        (WorkflowNodeExecutionOffload, guard_workflow_node_execution_offload_upload_reference),
        (HumanInputFormUploadFile, guard_human_input_upload_reference),
        (Document, guard_knowledge_owner_upload_references),
        (DocumentSegment, guard_knowledge_owner_upload_references),
    )
    before_state = {
        (model, operation, listener): event.contains(model, operation, listener)
        for model, listener in before_listeners
        for operation in ("before_insert", "before_update")
    }
    after_state = {
        operation: event.contains(
            WorkflowDraftVariable,
            operation,
            sync_workflow_draft_variable_upload_references,
        )
        for operation in ("after_insert", "after_update")
    }
    agent_config_sync_state = {
        (model, operation): event.contains(model, operation, sync_agent_config_upload_references)
        for model in (AgentConfigDraft, AgentConfigSnapshot)
        for operation in ("after_insert", "after_update")
    }
    knowledge_owner_sync_state = {
        (model, operation): event.contains(model, operation, sync_knowledge_owner_upload_references)
        for model in (Document, DocumentSegment)
        for operation in ("after_insert", "after_update")
    }
    agent_config_delete_state = {
        (model, operation, listener): event.contains(model, operation, listener)
        for model in (AgentConfigDraft, AgentConfigSnapshot)
        for operation, listener in (
            ("before_delete", prepare_agent_config_deletion),
            ("after_delete", remove_agent_config_upload_references),
        )
    }
    icon_lifecycle_state = {
        (model, operation, listener): event.contains(model, operation, listener)
        for model in icon_owner_models
        for operation, listener in (
            ("before_delete", prepare_icon_owner_deletion),
            ("after_update", claim_detached_icon_upload_references),
            ("after_delete", claim_detached_icon_upload_references),
        )
    }
    register_upload_file_reference_guards()
    try:
        yield
    finally:
        for (model, operation, listener), was_registered in before_state.items():
            if not was_registered:
                event.remove(model, operation, listener)
        for operation, was_registered in after_state.items():
            if not was_registered:
                event.remove(WorkflowDraftVariable, operation, sync_workflow_draft_variable_upload_references)
        for (model, operation), was_registered in agent_config_sync_state.items():
            if not was_registered:
                event.remove(model, operation, sync_agent_config_upload_references)
        for (model, operation), was_registered in knowledge_owner_sync_state.items():
            if not was_registered:
                event.remove(model, operation, sync_knowledge_owner_upload_references)
        for (model, operation, listener), was_registered in agent_config_delete_state.items():
            if not was_registered:
                event.remove(model, operation, listener)
        for (model, operation, listener), was_registered in icon_lifecycle_state.items():
            if not was_registered:
                event.remove(model, operation, listener)


def test_detach_draft_offload_claims_only_after_last_owner_is_removed(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="offload-file", tenant_id="tenant-1", key="files/offload")
    first_owner = _draft_file(owner_id="owner-1", app_id="app-1", upload_file_id=upload.id)
    second_owner = _draft_file(owner_id="owner-2", app_id="app-2", upload_file_id=upload.id)
    sqlite_session.add_all([upload, first_owner, second_owner])
    sqlite_session.flush()

    first_claim = detach_workflow_draft_variable_files_and_claim_uploads(
        sqlite_session,
        tenant_id="tenant-1",
        draft_file_ids=(first_owner.id,),
    )
    assert first_claim == ()
    retained = sqlite_session.get_one(UploadFile, upload.id)
    assert retained.knowledge_cleanup_started_at is None

    final_claim = detach_workflow_draft_variable_files_and_claim_uploads(
        sqlite_session,
        tenant_id="tenant-1",
        draft_file_ids=(second_owner.id,),
    )
    assert final_claim == (UploadFileCleanup(id=upload.id, key=upload.key),)
    pending = sqlite_session.get_one(UploadFile, upload.id)
    assert pending.knowledge_cleanup_started_at is not None


def test_detach_ordinary_draft_variable_claims_its_serialized_upload(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="ordinary-file", tenant_id="tenant-1", key="files/ordinary")
    sqlite_session.add_all(
        [
            upload,
            make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1"),
        ]
    )
    sqlite_session.flush()
    _insert_unindexed_draft_file_variable(
        sqlite_session,
        variable_id="variable-1",
        app_id="app-1",
        node_id="node-1",
        file_id=upload.id,
        storage_key=upload.key,
    )

    claimed = detach_workflow_draft_variables_and_claim_uploads(
        sqlite_session,
        tenant_id="tenant-1",
        draft_variable_ids=("variable-1",),
    )

    assert claimed == (UploadFileCleanup(id=upload.id, key=upload.key),)
    assert sqlite_session.get(WorkflowDraftVariable, "variable-1") is None
    pending = sqlite_session.get_one(UploadFile, upload.id)
    assert pending.knowledge_cleanup_started_at is not None


def test_all_normalized_owner_writers_reject_a_claimed_upload(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="pending-file", tenant_id="tenant-1", key="files/pending")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add(upload)
    sqlite_session.commit()
    owners = (
        (
            guard_knowledge_upload_reference,
            KnowledgeUploadFileReference(
                tenant_id="tenant-1",
                upload_file_id=upload.id,
                dataset_id="dataset-1",
                document_id="document-1",
                kind="document_source",
                resource_id="document-1",
            ),
        ),
        (
            guard_segment_attachment_upload_reference,
            SegmentAttachmentBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                attachment_id=upload.id,
            ),
        ),
        (
            guard_workflow_draft_variable_normalized_upload_reference,
            WorkflowDraftVariableUploadFileReference(
                tenant_id="tenant-1",
                app_id="app-1",
                draft_variable_id="variable-1",
                node_id="node-1",
                upload_file_id=upload.id,
            ),
        ),
        (
            guard_workflow_draft_variable_file_upload_reference,
            _draft_file(owner_id="owner-1", app_id="app-1", upload_file_id=upload.id),
        ),
        (
            guard_workflow_node_execution_offload_upload_reference,
            WorkflowNodeExecutionOffload(
                tenant_id="tenant-1",
                app_id="app-1",
                node_execution_id="execution-1",
                type_=ExecutionOffLoadType.INPUTS,
                file_id=upload.id,
            ),
        ),
        (
            guard_human_input_upload_reference,
            HumanInputFormUploadFile(
                tenant_id="tenant-1",
                app_id="app-1",
                form_id="form-1",
                upload_file_id=upload.id,
                upload_token_id="token-1",
            ),
        ),
    )

    for guard, owner in owners:
        with pytest.raises(UploadFilePendingDeletionError):
            guard(cast(object, None), sqlite_session.connection(), owner)  # type: ignore[arg-type]


def _serialized_file_value(
    file_id: str,
    *,
    transfer_method: str = "local_file",
    storage_key: str | None = None,
) -> str:
    return json.dumps(
        {
            "dify_model_identity": "__dify__file__",
            "type": "image",
            "transfer_method": transfer_method,
            "reference": build_file_reference(record_id=file_id, storage_key=storage_key),
        }
    )


def _draft_file_variable(*, variable_id: str, app_id: str, node_id: str, file_id: str) -> WorkflowDraftVariable:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app_id,
        user_id="account-1",
        node_id=node_id,
        name="output",
        value=StringSegment(value="placeholder"),
        node_execution_id="execution-1",
    )
    variable.id = variable_id
    variable.value_type = SegmentType.FILE
    variable.value = _serialized_file_value(file_id)
    return variable


def _insert_unindexed_draft_file_variable(
    session: Session,
    *,
    variable_id: str,
    app_id: str,
    node_id: str,
    file_id: str,
    storage_key: str | None = None,
) -> None:
    """Emulate a rolling-upgrade worker that does not maintain normalized edges."""

    session.execute(
        insert(WorkflowDraftVariable).values(
            id=variable_id,
            app_id=app_id,
            user_id="account-1",
            node_id=node_id,
            name="output",
            description="",
            selector=json.dumps([node_id, "output"]),
            value_type=SegmentType.FILE,
            value=_serialized_file_value(file_id, storage_key=storage_key),
            visible=True,
            editable=True,
            node_execution_id="execution-1",
            is_default_value=False,
        )
    )


@pytest.mark.parametrize(
    ("source_info", "expected"),
    [
        ({"reference": build_file_reference(record_id="file-1")}, ("file-1",)),
        ({"related_id": "file-2"}, ("file-2",)),
        ({"real_file_id": "file-3"}, ("file-3",)),
    ],
)
def test_extract_local_file_sources_uses_shared_reference_format(
    source_info: dict[str, object], expected: tuple[str, ...]
) -> None:
    assert extract_document_source_file_ids("local_file", source_info) == expected


def test_workflow_draft_file_references_follow_value_replacement_and_deletion(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    first = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/first")
    second = make_upload_file(file_id="file-2", tenant_id="tenant-1", key="files/second")
    sqlite_session.add_all([workflow, first, second])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        variable = _draft_file_variable(
            variable_id="variable-1",
            app_id="app-1",
            node_id="node-1",
            file_id=first.id,
        )
        sqlite_session.add(variable)
        sqlite_session.flush()

        assert set(
            sqlite_session.scalars(
                select(WorkflowDraftVariableUploadFileReference.upload_file_id).where(
                    WorkflowDraftVariableUploadFileReference.draft_variable_id == variable.id
                )
            )
        ) == {first.id}
        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=first.id, key=first.key),),
            )
            == ()
        )

        variable.value_type = SegmentType.ARRAY_FILE
        variable.value = json.dumps(
            [
                json.loads(_serialized_file_value(second.id)),
                json.loads(_serialized_file_value("tool-file", transfer_method="tool_file")),
            ]
        )
        sqlite_session.flush()
        assert set(
            sqlite_session.scalars(
                select(WorkflowDraftVariableUploadFileReference.upload_file_id).where(
                    WorkflowDraftVariableUploadFileReference.draft_variable_id == variable.id
                )
            )
        ) == {second.id}
        assert claim_orphan_upload_files(
            sqlite_session,
            tenant_id="tenant-1",
            files=(UploadFileCleanup(id=first.id, key=first.key),),
        ) == (UploadFileCleanup(id=first.id, key=first.key),)

        sqlite_session.delete(variable)
        sqlite_session.flush()
        assert claim_orphan_upload_files(
            sqlite_session,
            tenant_id="tenant-1",
            files=(UploadFileCleanup(id=second.id, key=second.key),),
        ) == (UploadFileCleanup(id=second.id, key=second.key),)


def test_workflow_draft_file_write_rejects_pending_and_cross_tenant_uploads(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    pending = make_upload_file(file_id="pending-file", tenant_id="tenant-1", key="files/pending")
    pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    foreign = make_upload_file(file_id="foreign-file", tenant_id="tenant-2", key="files/foreign")
    sqlite_session.add_all([workflow, pending, foreign])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(
            _draft_file_variable(
                variable_id="pending-variable",
                app_id="app-1",
                node_id="node-1",
                file_id=pending.id,
            )
        )
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        sqlite_session.add(
            _draft_file_variable(
                variable_id="foreign-variable",
                app_id="app-1",
                node_id="node-1",
                file_id=foreign.id,
            )
        )
        with pytest.raises(ValueError, match="does not belong to the workflow draft variable tenant"):
            sqlite_session.flush()
        sqlite_session.rollback()

        sqlite_session.add(
            _draft_file_variable(
                variable_id="ownerless-variable",
                app_id="missing-app",
                node_id="node-1",
                file_id=pending.id,
            )
        )
        with pytest.raises(LookupError, match="owner no longer exists"):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_non_file_draft_variable_does_not_require_a_persisted_workflow(sqlite_session: Session) -> None:
    variable = WorkflowDraftVariable.new_node_variable(
        app_id="transient-app",
        user_id="account-1",
        node_id="node-1",
        name="text-output",
        value=StringSegment(value="plain text"),
        node_execution_id="execution-1",
    )

    with _registered_upload_reference_guards():
        sqlite_session.add(variable)
        sqlite_session.flush()

    fence_workflow_draft_variable_upload_file_upsert(
        sqlite_session,
        (
            WorkflowDraftVariable.new_node_variable(
                app_id="another-transient-app",
                user_id="account-1",
                node_id="node-1",
                name="bulk-text-output",
                value=StringSegment(value="plain text"),
                node_execution_id="execution-2",
            ),
        ),
        ignore_existing=False,
    )
    assert tuple(sqlite_session.scalars(select(WorkflowDraftVariableUploadFileReference.id))) == ()


def test_unrelated_draft_variable_update_does_not_revalidate_a_historical_missing_file(
    sqlite_session: Session,
) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    variable = _draft_file_variable(
        variable_id="variable-1",
        app_id="app-1",
        node_id="node-1",
        file_id="historical-missing-file",
    )
    sqlite_session.add_all([workflow, variable])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        variable.description = "updated without changing the file"
        sqlite_session.flush()

    assert variable.description == "updated without changing the file"


def test_cleanup_claim_fences_a_later_workflow_draft_file_write(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/value")
    sqlite_session.add_all([workflow, upload])
    sqlite_session.commit()

    sessions = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    with sessions.begin() as cleanup:
        assert claim_orphan_upload_files(
            cleanup,
            tenant_id="tenant-1",
            files=(UploadFileCleanup(id=upload.id, key=upload.key),),
        ) == (UploadFileCleanup(id=upload.id, key=upload.key),)

    with _registered_upload_reference_guards(), sessions() as writer:
        writer.add(
            _draft_file_variable(
                variable_id="variable-1",
                app_id="app-1",
                node_id="node-1",
                file_id=upload.id,
            )
        )
        with pytest.raises(UploadFilePendingDeletionError):
            writer.flush()


def test_stale_normalized_draft_edge_falls_back_to_the_serialized_file_value(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/value")
    sqlite_session.add_all([workflow, upload])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        variable = _draft_file_variable(
            variable_id="variable-1",
            app_id="app-1",
            node_id="node-1",
            file_id=upload.id,
        )
        sqlite_session.add(variable)
        sqlite_session.flush()
        sqlite_session.execute(
            update(WorkflowDraftVariableUploadFileReference)
            .where(WorkflowDraftVariableUploadFileReference.draft_variable_id == variable.id)
            .values(node_id="other-node")
        )
        sqlite_session.flush()

        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )
        assert (
            tuple(
                sqlite_session.scalars(
                    select(WorkflowDraftVariableUploadFileReference.id).where(
                        WorkflowDraftVariableUploadFileReference.draft_variable_id == variable.id
                    )
                )
            )
            == ()
        )


def test_workflow_draft_owner_check_is_one_mysql_locking_join(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/value")
    sqlite_session.add_all([workflow, upload])
    sqlite_session.commit()
    with _registered_upload_reference_guards():
        sqlite_session.add(
            _draft_file_variable(
                variable_id="variable-1",
                app_id="app-1",
                node_id="node-1",
                file_id=upload.id,
            )
        )
        sqlite_session.flush()

    compiled_owner_reads: list[str] = []

    def capture_workflow_owner_read(execute_state: ORMExecuteState) -> None:
        statement = cast(Select[tuple[object]], execute_state.statement)
        compiled = str(statement.compile(dialect=mysql.dialect()))
        if compiled.lstrip().startswith("SELECT") and "workflow_draft_variable_upload_file_references" in compiled:
            compiled_owner_reads.append(compiled)

    event.listen(sqlite_session, "do_orm_execute", capture_workflow_owner_read)
    try:
        assert (
            find_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", capture_workflow_owner_read)

    assert len(compiled_owner_reads) == 1
    statement = compiled_owner_reads[0]
    assert "INNER JOIN workflow_draft_variables" in statement
    assert "INNER JOIN workflows" in statement
    assert "EXISTS" not in statement
    assert "FOR UPDATE NOWAIT" in statement


def test_workflow_draft_bulk_upsert_syncs_the_persisted_conflict_winner(sqlite_session: Session) -> None:
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    existing_file = make_upload_file(file_id="existing-file", tenant_id="tenant-1", key="files/existing")
    ignored_file = make_upload_file(file_id="ignored-file", tenant_id="tenant-1", key="files/ignored")
    ignored_file.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add_all([workflow, existing_file, ignored_file])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        existing = _draft_file_variable(
            variable_id="persisted-variable",
            app_id="app-1",
            node_id="node-1",
            file_id=existing_file.id,
        )
        sqlite_session.add(existing)
        sqlite_session.flush()

    ignored = _draft_file_variable(
        variable_id="ignored-input-id",
        app_id="app-1",
        node_id="node-1",
        file_id=ignored_file.id,
    )
    fence_workflow_draft_variable_upload_file_upsert(
        sqlite_session,
        (ignored,),
        ignore_existing=True,
    )
    synchronize_workflow_draft_variable_upload_file_upsert(sqlite_session, (ignored,))
    sqlite_session.flush()

    references = sqlite_session.execute(
        select(
            WorkflowDraftVariableUploadFileReference.draft_variable_id,
            WorkflowDraftVariableUploadFileReference.upload_file_id,
        )
    ).all()
    assert references == [(existing.id, existing_file.id)]


def test_workflow_draft_bulk_replacement_claims_old_edge_and_large_offload(
    sqlite_session: Session,
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DB_TYPE="postgresql")
    ordinary_upload = make_upload_file(file_id="ordinary-old", tenant_id="tenant-1", key="files/ordinary-old")
    offload_upload = make_upload_file(file_id="offload-old", tenant_id="tenant-1", key="files/offload-old")
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    offload_owner = _draft_file(owner_id="draft-file-old", app_id="app-1", upload_file_id=offload_upload.id)
    ordinary = _draft_file_variable(
        variable_id="ordinary-variable",
        app_id="app-1",
        node_id="ordinary-node",
        file_id=ordinary_upload.id,
    )
    large = WorkflowDraftVariable.new_node_variable(
        app_id="app-1",
        user_id="account-1",
        node_id="large-node",
        name="output",
        value=StringSegment(value="truncated"),
        node_execution_id="execution-old",
        file_id=offload_owner.id,
    )
    large.id = "large-variable"
    sqlite_session.add_all([ordinary_upload, offload_upload, workflow, offload_owner, ordinary, large])
    sqlite_session.commit()

    ordinary_replacement = WorkflowDraftVariable.new_node_variable(
        app_id="app-1",
        user_id="account-1",
        node_id="ordinary-node",
        name="output",
        value=StringSegment(value="replacement"),
        node_execution_id="execution-new",
    )
    large_replacement = WorkflowDraftVariable.new_node_variable(
        app_id="app-1",
        user_id="account-1",
        node_id="large-node",
        name="output",
        value=StringSegment(value="small replacement"),
        node_execution_id="execution-new",
    )

    _batch_upsert_draft_variable(sqlite_session, (ordinary_replacement, large_replacement))
    sqlite_session.commit()

    assert sqlite_session.get(WorkflowDraftVariableFile, offload_owner.id) is None
    assert sqlite_session.get_one(UploadFile, ordinary_upload.id).knowledge_cleanup_started_at is not None
    assert sqlite_session.get_one(UploadFile, offload_upload.id).knowledge_cleanup_started_at is not None
    assert tuple(sqlite_session.scalars(select(WorkflowDraftVariableUploadFileReference.id))) == ()


def test_agent_config_push_preserves_snapshot_owner_then_claims_after_final_delete(sqlite_session: Session) -> None:
    shared_upload = make_upload_file(file_id="agent-config-shared", tenant_id="tenant-1", key="files/shared")
    exclusive_upload = make_upload_file(
        file_id="agent-config-exclusive",
        tenant_id="tenant-1",
        key="files/exclusive",
    )
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    sqlite_session.add_all([shared_upload, exclusive_upload, agent])
    sqlite_session.commit()
    snapshot_soul = AgentSoulConfig(
        config_files=[
            AgentConfigFileRefConfig(
                name="guide.txt",
                file_kind="upload_file",
                file_id=shared_upload.id,
            )
        ]
    )
    draft_soul = snapshot_soul.model_copy(deep=True)
    draft_soul.config_files.append(
        AgentConfigFileRefConfig(
            name="notes.txt",
            file_kind="upload_file",
            file_id=exclusive_upload.id,
        )
    )
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        config_snapshot=snapshot_soul,
    )
    draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        config_snapshot=draft_soul,
    )

    with _registered_upload_reference_guards():
        sqlite_session.add_all([snapshot, draft])
        sqlite_session.commit()
        service = AgentConfigService(
            session_factory=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        )
        service.push(
            tenant_id="tenant-1",
            agent_id=agent.id,
            user_id="account-1",
            config_version_id=draft.id,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            payload=ConfigPushPayload(
                files=[
                    ConfigPushFileItem(name="guide.txt", file_ref=None),
                    ConfigPushFileItem(name="notes.txt", file_ref=None),
                ]
            ),
        )

        sqlite_session.expire_all()
        assert sqlite_session.get_one(UploadFile, shared_upload.id).knowledge_cleanup_started_at is None
        assert sqlite_session.get_one(UploadFile, exclusive_upload.id).knowledge_cleanup_started_at is not None
        edges = sqlite_session.execute(
            select(
                AgentConfigUploadFileReference.owner_kind,
                AgentConfigUploadFileReference.owner_id,
                AgentConfigUploadFileReference.upload_file_id,
            )
        ).all()
        assert edges == [("snapshot", snapshot.id, shared_upload.id)]

        sqlite_session.delete(sqlite_session.get_one(AgentConfigSnapshot, snapshot.id))
        sqlite_session.commit()

    sqlite_session.expire_all()
    assert sqlite_session.get_one(UploadFile, shared_upload.id).knowledge_cleanup_started_at is not None
    assert sqlite_session.get_one(UploadFile, exclusive_upload.id).knowledge_cleanup_started_at is not None
    assert tuple(sqlite_session.scalars(select(AgentConfigUploadFileReference.id))) == ()


def test_agent_config_upload_reference_rejects_pending_and_cross_tenant_files(sqlite_session: Session) -> None:
    agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    pending = make_upload_file(file_id="pending-file", tenant_id="tenant-1", key="files/pending")
    pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    foreign = make_upload_file(file_id="foreign-file", tenant_id="tenant-2", key="files/foreign")
    sqlite_session.add_all([agent, pending, foreign])
    sqlite_session.commit()

    def config(file_id: str) -> AgentConfigDraft:
        return AgentConfigDraft(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id="account-1",
            draft_owner_key="account-1",
            config_snapshot=AgentSoulConfig(
                config_files=[
                    AgentConfigFileRefConfig(
                        name="guide.txt",
                        file_kind="upload_file",
                        file_id=file_id,
                    )
                ]
            ),
        )

    with _registered_upload_reference_guards():
        sqlite_session.add(config(pending.id))
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        sqlite_session.add(config(foreign.id))
        with pytest.raises(ValueError, match="does not belong to the Agent config tenant"):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_detach_agent_config_versions_claims_only_after_the_last_owner(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="shared-config-file", tenant_id="tenant-1", key="files/shared-config")
    tool_file = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=None,
        file_key="tools/shared-config",
        mimetype="text/plain",
        name="shared-tool.txt",
        size=12,
    )
    first_agent = Agent(
        id="agent-1",
        tenant_id="tenant-1",
        name="First Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    second_agent = Agent(
        id="agent-2",
        tenant_id="tenant-1",
        name="Second Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    soul = AgentSoulConfig(
        config_files=[
            AgentConfigFileRefConfig(
                name="guide.txt",
                file_kind="upload_file",
                file_id=upload.id,
            ),
        ],
        config_skills=[
            AgentConfigSkillRefConfig(name="shared-tool", file_id=tool_file.id),
        ],
    )
    first_draft = AgentConfigDraft(
        id="draft-1",
        tenant_id="tenant-1",
        agent_id=first_agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        config_snapshot=soul,
    )
    second_snapshot = AgentConfigSnapshot(
        id="snapshot-2",
        tenant_id="tenant-1",
        agent_id=second_agent.id,
        version=1,
        config_snapshot=soul,
    )
    sqlite_session.add_all([upload, tool_file, first_agent, second_agent])
    sqlite_session.commit()
    with _registered_upload_reference_guards():
        sqlite_session.add_all([first_draft, second_snapshot])
        sqlite_session.commit()

        assert (
            detach_agent_config_versions_and_claim_uploads(
                sqlite_session,
                tenant_id="tenant-1",
                agent_ids=(first_agent.id,),
            )
            == ()
        )
        assert sqlite_session.get_one(UploadFile, upload.id).knowledge_cleanup_started_at is None
        assert sqlite_session.get_one(ToolFile, tool_file.id).cleanup_started_at is None

        claimed = detach_agent_config_versions_and_claim_uploads(
            sqlite_session,
            tenant_id="tenant-1",
            agent_ids=(second_agent.id,),
        )
        sqlite_session.commit()

    assert tuple(file.id for file in claimed) == (upload.id,)
    assert sqlite_session.get_one(UploadFile, upload.id).knowledge_cleanup_started_at is not None
    assert sqlite_session.get_one(ToolFile, tool_file.id).cleanup_started_at is not None
    assert tuple(sqlite_session.scalars(select(AgentConfigUploadFileReference.id))) == ()
    assert tuple(sqlite_session.scalars(select(AgentConfigToolFileReference.id))) == ()


def test_extract_agent_config_tool_file_ids_includes_legacy_skill_archives() -> None:
    assert extract_agent_config_tool_file_ids(
        {
            "config_files": [
                {"name": "guide", "file_kind": "tool_file", "file_id": "tool-guide"},
                {"name": "upload", "file_kind": "upload_file", "file_id": "upload-guide"},
            ],
            "config_skills": [
                {"name": "research", "file_id": "skill-archive"},
                {"name": "missing", "file_id": "", "is_missing": True},
            ],
        }
    ) == ("tool-guide", "skill-archive")
    assert extract_agent_config_tool_file_ids(
        AgentSoulConfig(
            config_skills=[
                AgentConfigSkillRefConfig(name="research", file_id="skill-archive"),
            ]
        )
    ) == ("skill-archive",)


def test_agent_config_adopts_only_pending_tool_file_created_in_current_scope(sqlite_session: Session) -> None:
    agent = Agent(
        id="agent-skill-adoption",
        tenant_id="tenant-1",
        name="Skill Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    draft = AgentConfigDraft(
        id="draft-skill-adoption",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        config_snapshot=AgentSoulConfig(),
    )
    sqlite_session.add_all([agent, draft])
    sqlite_session.commit()

    with (
        _registered_upload_reference_guards(),
        track_created_agent_config_tool_files(tenant_id="tenant-1") as created,
    ):
        pending = ToolFile(
            user_id="account-1",
            tenant_id="tenant-1",
            conversation_id=None,
            file_key="tools/tenant-1/research.zip",
            mimetype="application/zip",
            name="research.zip",
            size=13,
            cleanup_started_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=10),
        )
        sqlite_session.add(pending)
        sqlite_session.commit()
        assert tuple(created) == (pending.id,)
        draft.config_snapshot = AgentSoulConfig(
            config_skills=[
                AgentConfigSkillRefConfig(name="research", file_id=pending.id),
            ]
        )
        sqlite_session.commit()

    sqlite_session.expire_all()
    adopted = sqlite_session.get_one(ToolFile, pending.id)
    assert adopted.cleanup_started_at is None
    assert (
        sqlite_session.scalar(
            select(AgentConfigToolFileReference).where(
                AgentConfigToolFileReference.owner_id == draft.id,
                AgentConfigToolFileReference.tool_file_id == pending.id,
            )
        )
        is not None
    )


def test_agent_config_tool_file_claim_waits_for_shared_snapshot_owner(sqlite_session: Session) -> None:
    tool_file = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=None,
        file_key="tools/shared-config.txt",
        mimetype="text/plain",
        name="shared-config.txt",
        size=12,
    )
    agent = Agent(
        id="agent-tool-owner",
        tenant_id="tenant-1",
        name="Tool Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    soul = AgentSoulConfig(
        config_skills=[
            AgentConfigSkillRefConfig(
                name="shared-tool",
                file_id=tool_file.id,
            ),
        ]
    )
    draft = AgentConfigDraft(
        id="draft-tool-owner",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        config_snapshot=soul,
    )
    snapshot = AgentConfigSnapshot(
        id="snapshot-tool-owner",
        tenant_id="tenant-1",
        agent_id=agent.id,
        version=1,
        config_snapshot=soul,
    )
    sqlite_session.add_all([tool_file, agent])
    sqlite_session.commit()
    with _registered_upload_reference_guards():
        sqlite_session.add_all([draft, snapshot])
        sqlite_session.commit()
        AgentConfigService(
            session_factory=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        ).push(
            tenant_id="tenant-1",
            agent_id=agent.id,
            user_id="account-1",
            config_version_id=draft.id,
            config_version_kind=AgentConfigVersionKind.BUILD_DRAFT,
            payload=ConfigPushPayload(
                skills=[ConfigPushSkillItem(name="shared-tool", file_ref=None)],
            ),
        )

        sqlite_session.expire_all()
        assert sqlite_session.get_one(ToolFile, tool_file.id).cleanup_started_at is None
        assert tuple(
            sqlite_session.scalars(
                select(AgentConfigToolFileReference.owner_kind).where(
                    AgentConfigToolFileReference.tool_file_id == tool_file.id
                )
            )
        ) == ("snapshot",)

        sqlite_session.delete(sqlite_session.get_one(AgentConfigSnapshot, snapshot.id))
        sqlite_session.commit()

    sqlite_session.expire_all()
    assert sqlite_session.get_one(ToolFile, tool_file.id).cleanup_started_at is not None
    assert tuple(sqlite_session.scalars(select(AgentConfigToolFileReference.id))) == ()


def test_agent_config_tool_file_claim_removes_reference_without_tenant_agent_owner(
    sqlite_session: Session,
) -> None:
    tool_file = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=None,
        file_key="tools/stale-owner.zip",
        mimetype="application/zip",
        name="stale-owner.zip",
        size=12,
    )
    sqlite_session.add(tool_file)
    sqlite_session.commit()
    draft_id = "draft-stale-agent-owner"
    sqlite_session.execute(
        insert(AgentConfigDraft).values(
            id=draft_id,
            tenant_id="tenant-1",
            agent_id="missing-agent",
            draft_type=AgentConfigDraftType.DRAFT,
            account_id=None,
            draft_owner_key="",
            config_snapshot=AgentSoulConfig(
                config_skills=[AgentConfigSkillRefConfig(name="research", file_id=tool_file.id)]
            ),
        )
    )
    sqlite_session.commit()
    sqlite_session.execute(
        insert(AgentConfigToolFileReference).values(
            id="stale-tool-ref",
            tenant_id="tenant-1",
            owner_kind="draft",
            owner_id=draft_id,
            tool_file_id=tool_file.id,
        )
    )
    sqlite_session.commit()

    claimed = claim_orphan_agent_config_tool_files(
        sqlite_session,
        tenant_id="tenant-1",
        files=(AgentConfigToolFileCleanup(id=tool_file.id, key=tool_file.file_key),),
    )
    sqlite_session.commit()

    assert tuple(file.id for file in claimed) == (tool_file.id,)
    assert sqlite_session.get_one(ToolFile, tool_file.id).cleanup_started_at is not None
    assert sqlite_session.get(AgentConfigToolFileReference, "stale-tool-ref") is None


def test_agent_config_tool_file_detach_preserves_live_conversation_owner(sqlite_session: Session) -> None:
    conversation = make_conversation(
        conversation_id="conversation-tool-owner",
        app_id="app-tool-owner",
        name="Conversation owner",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
    )
    tool_file = ToolFile(
        tenant_id="tenant-1",
        user_id="account-1",
        conversation_id=conversation.id,
        file_key="tools/conversation-owned.txt",
        mimetype="text/plain",
        name="conversation-owned.txt",
        size=12,
    )
    agent = Agent(
        id="agent-conversation-tool-owner",
        tenant_id="tenant-1",
        name="Tool Agent",
        agent_kind=AgentKind.DIFY_AGENT,
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
    )
    sqlite_session.add_all([conversation, tool_file, agent])
    sqlite_session.commit()
    draft = AgentConfigDraft(
        id="draft-conversation-tool-owner",
        tenant_id="tenant-1",
        agent_id=agent.id,
        draft_type=AgentConfigDraftType.DRAFT,
        account_id=None,
        draft_owner_key="",
        config_snapshot=AgentSoulConfig(
            config_files=[
                AgentConfigFileRefConfig(
                    name="guide.txt",
                    file_kind="tool_file",
                    file_id=tool_file.id,
                )
            ]
        ),
    )
    with _registered_upload_reference_guards():
        sqlite_session.add(draft)
        sqlite_session.commit()
        sqlite_session.delete(sqlite_session.get_one(AgentConfigDraft, draft.id))
        sqlite_session.commit()

    sqlite_session.expire_all()
    retained = sqlite_session.get_one(ToolFile, tool_file.id)
    assert retained.conversation_id == conversation.id
    assert retained.cleanup_started_at is None
    assert tuple(sqlite_session.scalars(select(AgentConfigToolFileReference.id))) == ()


def test_app_deletion_detaches_ordinary_drafts_before_claiming_exclusive_files(sqlite_session: Session) -> None:
    exclusive = make_upload_file(file_id="exclusive-file", tenant_id="tenant-1", key="files/exclusive")
    shared = make_upload_file(file_id="shared-file", tenant_id="tenant-1", key="files/shared")
    icon = make_upload_file(file_id="icon-file", tenant_id="tenant-1", key="files/icon")
    app = make_app(
        app_id="app-1",
        tenant_id="tenant-1",
        icon_type=IconType.IMAGE,
        icon=icon.id,
    )
    other_app = make_app(app_id="app-2", tenant_id="tenant-1")
    sqlite_session.add_all(
        [
            exclusive,
            shared,
            icon,
            app,
            other_app,
            make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id=app.id),
            make_workflow(workflow_id="workflow-2", tenant_id="tenant-1", app_id=other_app.id),
        ]
    )
    sqlite_session.flush()
    with _registered_upload_reference_guards():
        sqlite_session.add_all(
            [
                _draft_file_variable(
                    variable_id="variable-exclusive",
                    app_id=app.id,
                    node_id="node-exclusive",
                    file_id=exclusive.id,
                ),
                _draft_file_variable(
                    variable_id="variable-shared-1",
                    app_id=app.id,
                    node_id="node-shared-1",
                    file_id=shared.id,
                ),
                _draft_file_variable(
                    variable_id="variable-shared-2",
                    app_id=other_app.id,
                    node_id="node-shared-2",
                    file_id=shared.id,
                ),
            ]
        )
        sqlite_session.flush()

    candidates = snapshot_and_detach_app_upload_files(
        sqlite_session,
        tenant_id="tenant-1",
        app_id=app.id,
    )
    sqlite_session.delete(app)
    sqlite_session.flush()
    claimed = claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidates)

    assert {file.id for file in candidates} == {exclusive.id, shared.id, icon.id}
    assert {file.id for file in claimed} == {exclusive.id, icon.id}
    assert sqlite_session.get(WorkflowDraftVariable, "variable-exclusive") is None
    assert sqlite_session.get(WorkflowDraftVariable, "variable-shared-1") is None
    assert sqlite_session.get(WorkflowDraftVariable, "variable-shared-2") is not None
    assert shared.knowledge_cleanup_started_at is None


@pytest.mark.parametrize("icon", ["file-1", "https://example.test/files/file-1/image-preview?timestamp=1"])
def test_app_image_icon_blocks_upload_cleanup(sqlite_session: Session, icon: str) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/icon")
    sqlite_session.add(upload)
    sqlite_session.commit()
    with _registered_upload_reference_guards():
        sqlite_session.add(
            make_app(
                app_id="app-1",
                tenant_id="tenant-1",
                icon_type=IconType.IMAGE,
                icon=icon,
            )
        )
        sqlite_session.flush()

        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )


def test_app_image_icon_insert_and_update_recheck_cleanup_fence(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/icon")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    sqlite_session.add_all([upload, app])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(
            make_app(
                app_id="app-2",
                tenant_id="tenant-1",
                icon_type=IconType.IMAGE,
                icon="file-1",
            )
        )
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        app = sqlite_session.get_one(App, "app-1")
        app.icon_type = IconType.IMAGE
        app.icon = "/files/file-1/file-preview"
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_app_image_icon_is_scoped_to_its_tenant(sqlite_session: Session) -> None:
    sqlite_session.add(make_upload_file(file_id="foreign-file", tenant_id="tenant-2", key="files/foreign"))
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(
            make_app(
                app_id="app-1",
                tenant_id="tenant-1",
                icon_type=IconType.IMAGE,
                icon="foreign-file",
            )
        )
        with pytest.raises(ValueError, match="does not belong to the app tenant"):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_unrelated_app_update_does_not_revalidate_historical_missing_icon(sqlite_session: Session) -> None:
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    sqlite_session.add(app)
    sqlite_session.commit()
    sqlite_session.execute(
        update(App).where(App.id == app.id).values({App.icon_type: IconType.IMAGE, App.icon: "historical-missing-file"})
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    with _registered_upload_reference_guards():
        stored = sqlite_session.get_one(App, app.id)
        stored.name = "Renamed without changing its icon"
        sqlite_session.flush()

    assert stored.name == "Renamed without changing its icon"


def test_app_icon_change_still_validates_the_new_reference(sqlite_session: Session) -> None:
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    sqlite_session.add(app)
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        app.icon_type = IconType.IMAGE
        app.icon = "missing-file"
        with pytest.raises(ValueError, match="does not belong to the app tenant"):
            sqlite_session.flush()
        sqlite_session.rollback()


def _site(*, app_id: str, icon: str | None = None) -> Site:
    return Site(
        app_id=app_id,
        title="Site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        icon_type=IconType.IMAGE if icon else None,
        icon=icon,
    )


IconOwner = Dataset | PipelineCustomizedTemplate | Agent | CustomizedSnippet | MCPToolProvider


def _tenant_icon_owner(kind: str, *, file_id: str) -> IconOwner:
    if kind == "dataset":
        dataset = _dataset("dataset-icon-owner", "tenant-1")
        dataset.icon_info = {"icon_type": "image", "icon": file_id, "icon_url": "/preview"}
        return dataset
    if kind == "pipeline_template":
        return PipelineCustomizedTemplate(
            tenant_id="tenant-1",
            name="Template",
            description="",
            chunk_structure="paragraph",
            icon={"icon_type": "image", "icon": file_id, "icon_url": "/preview"},
            position=1,
            yaml_content="",
            install_count=0,
            language="en-US",
            created_by="account-1",
        )
    if kind == "agent":
        return Agent(
            tenant_id="tenant-1",
            name="Agent",
            description="",
            role="",
            icon_type=AgentIconType.IMAGE,
            icon=file_id,
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
            created_by="account-1",
        )
    if kind == "snippet":
        return CustomizedSnippet(
            tenant_id="tenant-1",
            name="Snippet",
            description="",
            type=SnippetType.NODE.value,
            icon_info={"icon_type": "image", "icon": file_id, "icon_url": "/preview"},
            created_by="account-1",
        )
    if kind == "mcp":
        return MCPToolProvider(
            tenant_id="tenant-1",
            name="MCP",
            server_identifier="mcp",
            server_url="encrypted",
            server_url_hash="hash",
            icon=file_id,
            user_id="account-1",
        )
    raise AssertionError(f"unknown icon owner: {kind}")


@pytest.mark.parametrize("owner_kind", ["dataset", "pipeline_template", "agent", "snippet", "mcp"])
def test_tenant_icon_owner_blocks_upload_cleanup(sqlite_session: Session, owner_kind: str) -> None:
    upload = make_upload_file(file_id=f"{owner_kind}-file", tenant_id="tenant-1")
    sqlite_session.add(upload)
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(_tenant_icon_owner(owner_kind, file_id=upload.id))
        sqlite_session.flush()

        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )


@pytest.mark.parametrize("owner_kind", ["dataset", "pipeline_template", "agent", "snippet", "mcp"])
def test_tenant_icon_owner_rejects_upload_claimed_for_cleanup(sqlite_session: Session, owner_kind: str) -> None:
    upload = make_upload_file(file_id=f"{owner_kind}-file", tenant_id="tenant-1")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add(upload)
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(_tenant_icon_owner(owner_kind, file_id=upload.id))
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()


@pytest.mark.parametrize("owner_kind", ["dataset", "pipeline_template", "agent", "snippet", "mcp"])
def test_unrelated_owner_update_keeps_historical_missing_icon(sqlite_session: Session, owner_kind: str) -> None:
    owner = _tenant_icon_owner(owner_kind, file_id="")
    sqlite_session.add(owner)
    sqlite_session.commit()
    owner_id = owner.id
    if isinstance(owner, Dataset):
        sqlite_session.execute(
            update(Dataset)
            .where(Dataset.id == owner_id)
            .values(icon_info={"icon_type": "image", "icon": "historical-missing"})
        )
    elif isinstance(owner, PipelineCustomizedTemplate):
        sqlite_session.execute(
            update(PipelineCustomizedTemplate)
            .where(PipelineCustomizedTemplate.id == owner_id)
            .values(icon={"icon_type": "image", "icon": "historical-missing"})
        )
    elif isinstance(owner, Agent):
        sqlite_session.execute(
            update(Agent).where(Agent.id == owner_id).values(icon_type=AgentIconType.IMAGE, icon="historical-missing")
        )
    elif isinstance(owner, CustomizedSnippet):
        sqlite_session.execute(
            update(CustomizedSnippet)
            .where(CustomizedSnippet.id == owner_id)
            .values(icon_info={"icon_type": "image", "icon": "historical-missing"})
        )
    else:
        sqlite_session.execute(
            update(MCPToolProvider).where(MCPToolProvider.id == owner_id).values(icon="historical-missing")
        )
    sqlite_session.commit()
    sqlite_session.expire_all()

    with _registered_upload_reference_guards():
        stored = sqlite_session.get_one(type(owner), owner_id)
        stored.name = "Renamed without changing its icon"
        sqlite_session.flush()

    assert stored.name == "Renamed without changing its icon"


def test_unrelated_site_update_does_not_revalidate_historical_missing_icon(sqlite_session: Session) -> None:
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    site = _site(app_id=app.id)
    sqlite_session.add_all([app, site])
    sqlite_session.commit()
    sqlite_session.execute(
        update(Site).where(Site.id == site.id).values(icon_type=IconType.IMAGE, icon="historical-missing-file")
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    with _registered_upload_reference_guards():
        stored = sqlite_session.get_one(Site, site.id)
        stored.title = "Renamed without changing its icon"
        sqlite_session.flush()

    assert stored.title == "Renamed without changing its icon"


def test_site_icon_write_enforces_app_tenant_and_cleanup_fence(sqlite_session: Session) -> None:
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    pending = make_upload_file(file_id="pending-file", tenant_id="tenant-1", key="files/pending")
    pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    foreign = make_upload_file(file_id="foreign-file", tenant_id="tenant-2", key="files/foreign")
    sqlite_session.add_all([app, pending, foreign])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(_site(app_id=app.id, icon=pending.id))
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        app = sqlite_session.get_one(App, app.id)
        sqlite_session.add(_site(app_id=app.id, icon=foreign.id))
        with pytest.raises(ValueError, match="does not belong to the site tenant"):
            sqlite_session.flush()
        sqlite_session.rollback()


@pytest.mark.parametrize("icon", ["file-1", "/files/file-1/image-preview"])
def test_site_image_icon_blocks_upload_cleanup(sqlite_session: Session, icon: str) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/site-icon")
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    sqlite_session.add_all([app, upload])
    sqlite_session.flush()
    with _registered_upload_reference_guards():
        sqlite_session.add(_site(app_id=app.id, icon=icon))
        sqlite_session.flush()

        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload.id, key=upload.key),),
            )
            == ()
        )


def test_account_avatar_uses_creator_chain_after_workspace_membership_ends(sqlite_session: Session) -> None:
    account = make_account(account_id="account-1")
    first_tenant = make_tenant(tenant_id="tenant-1")
    second_tenant = make_tenant(tenant_id="tenant-2")
    avatar = make_upload_file(file_id="avatar-file", tenant_id=second_tenant.id, created_by=account.id)
    sqlite_session.add_all(
        [
            account,
            first_tenant,
            second_tenant,
            TenantAccountJoin(
                tenant_id=first_tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
            ),
            avatar,
        ]
    )
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        account.avatar = avatar.id
        sqlite_session.flush()
        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id=second_tenant.id,
                files=(UploadFileCleanup(id=avatar.id, key=avatar.key),),
            )
            == ()
        )


def test_account_avatar_orphan_fence_compiles_portably_for_uuid_upload_ids(sqlite_session: Session) -> None:
    account = make_account(account_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    avatar = make_upload_file(
        file_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        tenant_id="cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        created_by=account.id,
    )
    sqlite_session.add_all([account, avatar])
    sqlite_session.commit()
    account.avatar = avatar.id
    sqlite_session.commit()
    statements: list[tuple[str, str]] = []

    def capture_account_avatar_read(execute_state: ORMExecuteState) -> None:
        statement = cast(Select[tuple[object]], execute_state.statement)
        postgres_sql = str(statement.compile(dialect=postgresql.dialect()))
        if "FROM accounts" not in postgres_sql:
            return
        statements.append((postgres_sql, str(statement.compile(dialect=mysql.dialect()))))

    event.listen(sqlite_session, "do_orm_execute", capture_account_avatar_read)
    try:
        assert (
            find_orphan_upload_files(
                sqlite_session,
                tenant_id=avatar.tenant_id,
                files=(UploadFileCleanup(id=avatar.id, key=avatar.key),),
            )
            == ()
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", capture_account_avatar_read)

    assert len(statements) == 1
    postgres_sql, mysql_sql = statements[0]
    assert "CAST(upload_files.id AS VARCHAR) = accounts.avatar" in postgres_sql
    assert "upload_files.id IN" in postgres_sql
    assert "FOR UPDATE OF accounts NOWAIT" in postgres_sql
    assert "CAST(upload_files.id AS CHAR) = accounts.avatar" in mysql_sql
    assert "upload_files.id IN" in mysql_sql
    assert "FOR UPDATE NOWAIT" in mysql_sql


def test_account_avatar_change_rejects_pending_or_unowned_upload(sqlite_session: Session) -> None:
    account = make_account(account_id="account-1")
    tenant = make_tenant(tenant_id="tenant-1")
    pending = make_upload_file(file_id="pending-avatar", tenant_id=tenant.id, created_by=account.id)
    pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    unowned = make_upload_file(file_id="unowned-avatar", tenant_id=tenant.id, created_by="account-2")
    sqlite_session.add_all(
        [
            account,
            tenant,
            TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.NORMAL),
            pending,
            unowned,
        ]
    )
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        account.avatar = pending.id
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()

        account = sqlite_session.get_one(Account, account.id)
        account.avatar = unowned.id
        with pytest.raises(ValueError, match="does not belong to the account"):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_account_unrelated_update_keeps_historical_missing_avatar(sqlite_session: Session) -> None:
    account = make_account(account_id="account-1")
    sqlite_session.add(account)
    sqlite_session.commit()
    sqlite_session.execute(update(Account).where(Account.id == account.id).values(avatar="historical-missing-file"))
    sqlite_session.commit()
    sqlite_session.expire_all()

    with _registered_upload_reference_guards():
        stored = sqlite_session.get_one(Account, account.id)
        stored.name = "Renamed without changing its avatar"
        sqlite_session.flush()

    assert stored.name == "Renamed without changing its avatar"


def test_workspace_logo_reference_change_is_fenced_and_blocks_cleanup(sqlite_session: Session) -> None:
    tenant = make_tenant(tenant_id="tenant-1")
    logo = make_upload_file(file_id="logo-file", tenant_id=tenant.id)
    pending = make_upload_file(file_id="pending-logo", tenant_id=tenant.id)
    pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add_all([tenant, logo, pending])
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        tenant.custom_config_dict = {
            "remove_webapp_brand": False,
            "replace_webapp_logo": f"/files/{logo.id}/image-preview",
        }
        sqlite_session.flush()
        assert (
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id=tenant.id,
                files=(UploadFileCleanup(id=logo.id, key=logo.key),),
            )
            == ()
        )

        tenant.custom_config_dict = {"remove_webapp_brand": True, "replace_webapp_logo": logo.id}
        sqlite_session.flush()

        tenant.custom_config_dict = {"remove_webapp_brand": True, "replace_webapp_logo": pending.id}
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_workspace_unrelated_update_keeps_historical_missing_logo(sqlite_session: Session) -> None:
    tenant = make_tenant(tenant_id="tenant-1")
    sqlite_session.add(tenant)
    sqlite_session.commit()
    sqlite_session.execute(
        update(Tenant)
        .where(Tenant.id == tenant.id)
        .values(custom_config='{"remove_webapp_brand":false,"replace_webapp_logo":"missing-logo"}')
    )
    sqlite_session.commit()
    sqlite_session.expire_all()

    with _registered_upload_reference_guards():
        stored = sqlite_session.get_one(Tenant, tenant.id)
        stored.name = "Renamed without changing its logo"
        sqlite_session.flush()

    assert stored.name == "Renamed without changing its logo"


def test_inline_image_filter_keeps_only_images_without_other_active_segments(sqlite_session: Session) -> None:
    active_document = _document("document-1", workspace_id="tenant-1")
    inactive_document = _document("document-2", workspace_id="tenant-1", enabled=False)
    active_segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=active_document.id,
        position=1,
        content="active",
        word_count=1,
        tokens=1,
        created_by="account-1",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    excluded_segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=active_document.id,
        position=2,
        content="excluded",
        word_count=1,
        tokens=1,
        created_by="account-1",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    inactive_segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=inactive_document.id,
        position=1,
        content="inactive document",
        word_count=1,
        tokens=1,
        created_by="account-1",
        enabled=True,
        status=SegmentStatus.COMPLETED,
    )
    active_segment.id = "active-segment"
    excluded_segment.id = "excluded-segment"
    inactive_segment.id = "inactive-segment"
    uploads = tuple(
        make_upload_file(file_id=file_id, tenant_id="tenant-1", key=f"files/{file_id}")
        for file_id in ("shared-image", "excluded-image", "inactive-image", "orphan-image")
    )
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            active_document,
            inactive_document,
            active_segment,
            excluded_segment,
            inactive_segment,
            *uploads,
        ]
    )
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            KnowledgeUploadFileReference(
                tenant_id="tenant-1",
                upload_file_id=file_id,
                dataset_id="dataset-1",
                document_id=document_id,
                kind="segment_image",
                resource_id=segment_id,
            )
            for file_id, document_id, segment_id in (
                ("shared-image", active_document.id, active_segment.id),
                ("excluded-image", active_document.id, excluded_segment.id),
                ("inactive-image", inactive_document.id, inactive_segment.id),
            )
        ]
    )
    sqlite_session.flush()

    assert filter_inline_image_ids_without_active_references(
        sqlite_session,
        DatasetRef("tenant-1", "dataset-1"),
        ("shared-image", "excluded-image", "inactive-image", "orphan-image", "orphan-image"),
        excluding_segment_ids=(excluded_segment.id,),
    ) == ("excluded-image", "inactive-image", "orphan-image")


def test_replace_segment_attachments_returns_only_detached_file_snapshots(sqlite_session: Session) -> None:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content="content",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    segment.id = "segment-1"
    files = (
        make_upload_file(file_id="removed", tenant_id="tenant-1", key="files/removed"),
        make_upload_file(file_id="kept", tenant_id="tenant-1", key="files/kept"),
        make_upload_file(file_id="added", tenant_id="tenant-1", key="files/added"),
    )
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            _document("document-1", workspace_id="tenant-1"),
            segment,
            *files,
            SegmentAttachmentBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment.id,
                attachment_id="removed",
            ),
            SegmentAttachmentBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id=segment.id,
                attachment_id="kept",
            ),
        ]
    )
    sqlite_session.flush()

    removed = replace_segment_attachment_bindings(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=segment.id,
        attachment_ids=("kept", "added", "kept"),
    )
    sqlite_session.flush()

    assert removed == (UploadFileCleanup(id="removed", key="files/removed"),)
    assert set(
        sqlite_session.scalars(
            select(SegmentAttachmentBinding.attachment_id).where(SegmentAttachmentBinding.segment_id == segment.id)
        ).all()
    ) == {"kept", "added"}


def test_document_cleanup_manifest_prefers_normalized_edges_and_falls_back_for_legacy_rows(
    sqlite_session: Session,
) -> None:
    source = make_upload_file(file_id="source-file", tenant_id="tenant-1", key="files/source")
    normalized_image = make_upload_file(file_id="normalized-image", tenant_id="tenant-1", key="files/normalized")
    legacy_image = make_upload_file(file_id="legacy-image", tenant_id="tenant-1", key="files/legacy")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.NOTION_IMPORT)
    normalized_segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="content no longer contains its normalized image URL",
        word_count=7,
        tokens=7,
        created_by="account-1",
    )
    legacy_segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=2,
        content="![architecture diagram](/files/legacy-image/image-preview)",
        word_count=2,
        tokens=2,
        created_by="account-1",
    )
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            document,
            normalized_segment,
            legacy_segment,
            source,
            normalized_image,
            legacy_image,
        ]
    )
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            KnowledgeUploadFileReference(
                tenant_id="tenant-1",
                upload_file_id=source.id,
                dataset_id="dataset-1",
                document_id=document.id,
                kind="document_source",
                resource_id=document.id,
            ),
            KnowledgeUploadFileReference(
                tenant_id="tenant-1",
                upload_file_id=normalized_image.id,
                dataset_id="dataset-1",
                document_id=document.id,
                kind="segment_image",
                resource_id=normalized_segment.id,
            ),
        ]
    )
    sqlite_session.flush()

    manifest = build_document_cleanup_manifest(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_ids=(document.id,),
        document_file_ids=(),
    )

    assert manifest.document_files == (UploadFileCleanup(id=source.id, key=source.key),)
    assert manifest.image_files == (
        UploadFileCleanup(id=normalized_image.id, key=normalized_image.key),
        UploadFileCleanup(id=legacy_image.id, key=legacy_image.key),
    )


def test_segment_cleanup_manifest_falls_back_for_legacy_inline_image_rows(sqlite_session: Session) -> None:
    document = _document("document-1", workspace_id="tenant-1")
    legacy_image = make_upload_file(file_id="legacy-image", tenant_id="tenant-1", key="files/legacy")
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="![legacy](/files/legacy-image/image-preview)",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    segment.id = "segment-1"
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), document, segment, legacy_image])
    sqlite_session.flush()

    manifest = build_segment_cleanup_manifest(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        segment_ids=(segment.id,),
    )

    assert manifest.image_files == (UploadFileCleanup(id=legacy_image.id, key=legacy_image.key),)


def test_cleanup_claim_preserves_candidate_scoped_legacy_references(sqlite_session: Session) -> None:
    source = make_upload_file(file_id="legacy-source", tenant_id="tenant-1", key="files/source")
    image = make_upload_file(file_id="legacy-image", tenant_id="tenant-1", key="files/image")
    workflow_file = make_upload_file(file_id="legacy-workflow", tenant_id="tenant-1", key="files/workflow")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.LOCAL_FILE)
    document.data_source_info = json.dumps(
        {"reference": build_file_reference(record_id=source.id, storage_key=source.key)}
    )
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content=f"![legacy](/files/{image.id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            document,
            segment,
            make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1"),
            source,
            image,
            workflow_file,
        ]
    )
    sqlite_session.flush()
    _insert_unindexed_draft_file_variable(
        sqlite_session,
        variable_id="variable-1",
        app_id="app-1",
        node_id="node-1",
        file_id=workflow_file.id,
        storage_key=workflow_file.key,
    )

    assert tuple(sqlite_session.scalars(select(KnowledgeUploadFileReference.id))) == ()
    assert tuple(sqlite_session.scalars(select(WorkflowDraftVariableUploadFileReference.id))) == ()
    candidates = tuple(UploadFileCleanup(id=file.id, key=file.key) for file in (source, image, workflow_file))

    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidates) == ()


def test_cleanup_claim_uses_canonical_parsers_after_candidate_prefilter(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/orphan")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.LOCAL_FILE)
    document.data_source_info = json.dumps({"unrelated_description": "mentions file-1 but is not a file reference"})
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content="plain text mentions file-1 without an image preview URL",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), document, segment, upload])
    sqlite_session.flush()

    candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)
    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == candidate


def test_serialized_reference_reads_require_complete_knowledge_owner_chains(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/orphan")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.LOCAL_FILE)
    document.data_source_info = json.dumps({"related_id": upload.id})
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content=f"![orphan owner](/files/{upload.id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    sqlite_session.add_all([document, segment, upload])
    sqlite_session.flush()

    candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)
    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == candidate


def test_pre_delete_recheck_releases_claim_after_legacy_reference_commit(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared")
    sqlite_session.add_all(
        [
            upload,
            make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1"),
        ]
    )
    sqlite_session.flush()
    candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)

    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == candidate
    assert upload.knowledge_cleanup_started_at is not None
    _insert_unindexed_draft_file_variable(
        sqlite_session,
        variable_id="variable-1",
        app_id="app-1",
        node_id="node-1",
        file_id=upload.id,
    )

    assert recheck_claimed_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == ()
    assert upload.knowledge_cleanup_started_at is None
    assert sqlite_session.get(UploadFile, upload.id) is upload


def test_serialized_reference_checks_are_candidate_scoped_mysql_current_reads(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/orphan")
    sqlite_session.add(upload)
    sqlite_session.flush()
    statements: list[str] = []

    def capture_serialized_reference_reads(execute_state: ORMExecuteState) -> None:
        statement = cast(Select[tuple[object]], execute_state.statement)
        compiled = str(statement.compile(dialect=mysql.dialect()))
        if " LIKE " not in compiled:
            return
        if any(table in compiled for table in ("FROM documents", "FROM document_segments", "workflow_draft_variables")):
            statements.append(compiled)

    event.listen(sqlite_session, "do_orm_execute", capture_serialized_reference_reads)
    try:
        find_orphan_upload_files(
            sqlite_session,
            tenant_id="tenant-1",
            files=(UploadFileCleanup(id=upload.id, key=upload.key),),
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", capture_serialized_reference_reads)

    assert len(statements) == 3
    assert all("FOR UPDATE NOWAIT" in statement for statement in statements)
    document_statement = next(statement for statement in statements if "FROM documents" in statement)
    segment_statement = next(statement for statement in statements if "FROM document_segments" in statement)
    workflow_statement = next(statement for statement in statements if "FROM workflow_draft_variables" in statement)
    assert "INNER JOIN datasets" in document_statement
    assert "INNER JOIN documents" in segment_statement
    assert "INNER JOIN datasets" in segment_statement
    assert "INNER JOIN workflows" in workflow_statement


def test_large_candidate_sets_bound_each_serialized_reference_query(sqlite_session: Session) -> None:
    statements: list[str] = []

    def capture_serialized_reference_reads(execute_state: ORMExecuteState) -> None:
        statement = cast(Select[tuple[object]], execute_state.statement)
        compiled = str(statement.compile(dialect=mysql.dialect()))
        if " LIKE " not in compiled:
            return
        if any(table in compiled for table in ("FROM documents", "FROM document_segments", "workflow_draft_variables")):
            statements.append(compiled)

    event.listen(sqlite_session, "do_orm_execute", capture_serialized_reference_reads)
    try:
        find_orphan_upload_files(
            sqlite_session,
            tenant_id="tenant-1",
            files=tuple(UploadFileCleanup(id=f"file-{index:04d}", key=None) for index in range(501)),
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", capture_serialized_reference_reads)

    assert len(statements) == 9
    assert max(statement.count(" LIKE ") for statement in statements) == 750
    assert all("FOR UPDATE NOWAIT" in statement for statement in statements)


@pytest.mark.parametrize(
    "sqlite_session",
    [(UploadFile, KnowledgeUploadFileReference, SegmentAttachmentBinding)],
    indirect=True,
)
def test_last_reference_cleanup_is_fenced_before_storage_delete(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared")
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            _document("document-1", workspace_id="tenant-1"),
            _document("document-2", workspace_id="tenant-1"),
            upload,
        ]
    )
    sqlite_session.flush()
    for document_id in ("document-1", "document-2"):
        replace_document_upload_file_references(
            sqlite_session,
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id=document_id,
            data_source_type="upload_file",
            data_source_info={"upload_file_id": "file-1"},
        )
    sqlite_session.flush()

    remove_document_upload_file_references(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_ids=("document-1",),
    )
    assert (
        claim_orphan_upload_files(
            sqlite_session,
            tenant_id="tenant-1",
            files=(UploadFileCleanup(id="file-1", key="files/shared"),),
        )
        == ()
    )

    remove_document_upload_file_references(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_ids=("document-2",),
    )
    claimed = claim_orphan_upload_files(
        sqlite_session,
        tenant_id="tenant-1",
        files=(UploadFileCleanup(id="file-1", key="files/shared"),),
    )
    assert claimed == (UploadFileCleanup(id="file-1", key="files/shared"),)
    assert upload.knowledge_cleanup_started_at is not None

    with pytest.raises(UploadFilePendingDeletionError):
        replace_document_upload_file_references(
            sqlite_session,
            tenant_id="tenant-1",
            dataset_id="dataset-2",
            document_id="document-3",
            data_source_type="local_file",
            data_source_info={"related_id": "file-1"},
        )

    delete_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=claimed)
    sqlite_session.flush()
    assert sqlite_session.scalar(select(UploadFile).where(UploadFile.id == "file-1")) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
def test_document_owner_mapper_syncs_edges_and_claims_serialized_only_detach(sqlite_session: Session) -> None:
    old_upload = make_upload_file(file_id="old-file", tenant_id="tenant-1", key="files/old")
    new_upload = make_upload_file(file_id="new-file", tenant_id="tenant-1", key="files/new")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.UPLOAD_FILE)
    document.data_source_info = json.dumps({"upload_file_id": old_upload.id})
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), old_upload, new_upload, document])
    sqlite_session.flush()
    assert sqlite_session.scalar(select(KnowledgeUploadFileReference)) is None

    with _registered_upload_reference_guards():
        document.data_source_info = json.dumps({"upload_file_id": new_upload.id})
        sqlite_session.flush()

    reference = sqlite_session.scalar(select(KnowledgeUploadFileReference))
    assert reference is not None
    assert reference.upload_file_id == new_upload.id
    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_upload.id))
        is not None
    )
    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == new_upload.id))
        is None
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
def test_document_owner_mapper_rollback_restores_reference_and_cleanup_marker(sqlite_session: Session) -> None:
    old_upload = make_upload_file(file_id="old-file", tenant_id="tenant-1", key="files/old")
    new_upload = make_upload_file(file_id="new-file", tenant_id="tenant-1", key="files/new")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.UPLOAD_FILE)
    document.data_source_info = json.dumps({"upload_file_id": old_upload.id})
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), old_upload, new_upload])
    sqlite_session.flush()

    with _registered_upload_reference_guards():
        sqlite_session.add(document)
        sqlite_session.flush()
        nested = sqlite_session.begin_nested()
        document.data_source_info = json.dumps({"upload_file_id": new_upload.id})
        sqlite_session.flush()
        assert (
            sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_upload.id))
            is not None
        )
        nested.rollback()

    sqlite_session.expire_all()
    restored = sqlite_session.get_one(Document, document.id)
    assert restored.data_source_info_dict == {"upload_file_id": old_upload.id}
    reference = sqlite_session.scalar(select(KnowledgeUploadFileReference))
    assert reference is not None
    assert reference.upload_file_id == old_upload.id
    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_upload.id))
        is None
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
@pytest.mark.parametrize("owner_kind", ["document", "segment"])
def test_knowledge_owner_mapper_rejects_owner_chain_mutation(
    sqlite_session: Session,
    owner_kind: str,
) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/one")
    document = _document(
        "document-1",
        workspace_id="tenant-1",
        source_type=DataSourceType.UPLOAD_FILE if owner_kind == "document" else DataSourceType.NOTION_IMPORT,
    )
    document.data_source_info = (
        json.dumps({"upload_file_id": upload.id}) if owner_kind == "document" else json.dumps({})
    )
    sqlite_session.add_all(
        [
            _dataset("dataset-1", "tenant-1"),
            _dataset("dataset-2", "tenant-1"),
            upload,
        ]
    )
    sqlite_session.flush()
    with _registered_upload_reference_guards():
        sqlite_session.add(document)
        sqlite_session.flush()
        target: Document | DocumentSegment = document
        if owner_kind == "segment":
            target = DocumentSegment(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id=document.id,
                position=1,
                content=f"![image](/files/{upload.id}/image-preview)",
                word_count=1,
                tokens=1,
                created_by="account-1",
            )
            sqlite_session.add(target)
            sqlite_session.flush()

        nested = sqlite_session.begin_nested()
        target.dataset_id = "dataset-2"
        with pytest.raises(ValueError, match="ownership is immutable"):
            sqlite_session.flush()
        nested.rollback()

    reference = sqlite_session.scalar(select(KnowledgeUploadFileReference))
    assert reference is not None
    assert reference.dataset_id == "dataset-1"


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
def test_mapper_and_explicit_replacements_are_idempotent_in_production_order(sqlite_session: Session) -> None:
    old_upload = make_upload_file(file_id="old-file", tenant_id="tenant-1", key="files/old")
    new_upload = make_upload_file(file_id="new-file", tenant_id="tenant-1", key="files/new")
    old_image = make_upload_file(file_id="old-image", tenant_id="tenant-1", key="files/old-image")
    new_image = make_upload_file(file_id="new-image", tenant_id="tenant-1", key="files/new-image")
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.UPLOAD_FILE)
    document.data_source_info = json.dumps({"upload_file_id": old_upload.id})
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), old_upload, new_upload, old_image, new_image])
    sqlite_session.flush()

    with _registered_upload_reference_guards():
        sqlite_session.add(document)
        sqlite_session.flush()
        document.data_source_info = json.dumps({"upload_file_id": new_upload.id})
        sqlite_session.flush()
        assert (
            replace_document_upload_file_references(
                sqlite_session,
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id=document.id,
                data_source_type=document.data_source_type,
                data_source_info=document.data_source_info_dict,
            )
            == ()
        )

        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id=document.id,
            position=1,
            content=f"![old](/files/{old_image.id}/image-preview)",
            word_count=1,
            tokens=1,
            created_by="account-1",
        )
        sqlite_session.add(segment)
        sqlite_session.flush()
        segment.content = f"![new](/files/{new_image.id}/image-preview)"
        detached = replace_segment_image_upload_file_references(
            sqlite_session,
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id=document.id,
            segment_id=segment.id,
            content=segment.content,
        )
        sqlite_session.flush()

    assert detached == ()
    references = sqlite_session.scalars(select(KnowledgeUploadFileReference)).all()
    assert len(references) == 2
    assert {reference.upload_file_id for reference in references} == {new_upload.id, new_image.id}
    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_upload.id))
        is not None
    )
    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == old_image.id))
        is not None
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
def test_segment_owner_mapper_keeps_shared_image_until_last_serialized_owner_detaches(
    sqlite_session: Session,
) -> None:
    upload = make_upload_file(file_id="image-file", tenant_id="tenant-1", key="files/image")
    document = _document("document-1", workspace_id="tenant-1")
    first = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=1,
        content=f"![first](/files/{upload.id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    second = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id=document.id,
        position=2,
        content=f"![second](/files/{upload.id}/image-preview)",
        word_count=1,
        tokens=1,
        created_by="account-1",
    )
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), document, upload, first, second])
    sqlite_session.flush()

    with _registered_upload_reference_guards():
        first.content = "first without image"
        sqlite_session.flush()
        assert (
            sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == upload.id))
            is None
        )

        second.content = "second without image"
        sqlite_session.flush()

    assert (
        sqlite_session.scalar(select(UploadFile.knowledge_cleanup_started_at).where(UploadFile.id == upload.id))
        is not None
    )
    assert sqlite_session.scalar(select(KnowledgeUploadFileReference)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, UploadFile, KnowledgeUploadFileReference)],
    indirect=True,
)
def test_document_owner_mapper_rejects_a_pending_source_without_persisting_owner(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="pending-file", tenant_id="tenant-1", key="files/pending")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add_all([_dataset("dataset-1", "tenant-1"), upload])
    sqlite_session.flush()
    document = _document("document-1", workspace_id="tenant-1", source_type=DataSourceType.UPLOAD_FILE)
    document.data_source_info = json.dumps({"upload_file_id": upload.id})

    nested = sqlite_session.begin_nested()
    sqlite_session.add(document)
    with _registered_upload_reference_guards():
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
    nested.rollback()

    assert sqlite_session.get(Document, document.id) is None
    assert sqlite_session.scalar(select(KnowledgeUploadFileReference)) is None


@pytest.mark.parametrize(
    "sqlite_session",
    [(UploadFile, KnowledgeUploadFileReference, SegmentAttachmentBinding)],
    indirect=True,
)
def test_reference_added_before_claim_prevents_cleanup(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add(upload)
    sqlite_session.flush()

    with pytest.raises(UploadFilePendingDeletionError):
        replace_document_upload_file_references(
            sqlite_session,
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="document-1",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": "file-1"},
        )


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Conversation, Message, MessageFile, UploadFile)],
    indirect=True,
)
def test_local_message_file_rejects_upload_claimed_by_cleanup(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared")
    upload.knowledge_cleanup_started_at = datetime(2026, 1, 1)
    sqlite_session.add_all(
        [
            make_app(app_id="app-1", tenant_id="tenant-1"),
            make_conversation(
                conversation_id="conversation-1",
                app_id="app-1",
                inputs={},
                from_source=ConversationFromSource.API,
            ),
            make_message(
                message_id="message-1",
                app_id="app-1",
                conversation_id="conversation-1",
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            ),
            upload,
        ]
    )
    sqlite_session.commit()

    sessions = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    with _registered_upload_reference_guards():
        with sessions() as writer:
            writer.add(
                MessageFile(
                    message_id="message-1",
                    type=FileType.DOCUMENT,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    upload_file_id=upload.id,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by="account-1",
                )
            )
            with pytest.raises(UploadFilePendingDeletionError):
                writer.flush()


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Conversation, Message, MessageFile, UploadFile)],
    indirect=True,
)
def test_message_file_guard_scopes_local_upload_to_message_tenant(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            make_app(app_id="app-1", tenant_id="tenant-1"),
            make_conversation(
                conversation_id="conversation-1",
                app_id="app-1",
                inputs={},
                from_source=ConversationFromSource.API,
            ),
            make_message(
                message_id="message-1",
                app_id="app-1",
                conversation_id="conversation-1",
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            ),
            make_upload_file(file_id="foreign-file", tenant_id="tenant-2", key="files/foreign"),
        ]
    )
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        sqlite_session.add(
            MessageFile(
                message_id="message-1",
                type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                upload_file_id="foreign-file",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
            )
        )
        with pytest.raises(ValueError, match="does not belong"):
            sqlite_session.flush()
        sqlite_session.rollback()


@pytest.mark.parametrize(
    "sqlite_session",
    [(App, Conversation, Message, MessageFile, UploadFile)],
    indirect=True,
)
def test_local_message_file_update_rechecks_cleanup_fence(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            make_app(app_id="app-1", tenant_id="tenant-1"),
            make_conversation(
                conversation_id="conversation-1",
                app_id="app-1",
                inputs={},
                from_source=ConversationFromSource.API,
            ),
            make_message(
                message_id="message-1",
                app_id="app-1",
                conversation_id="conversation-1",
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            ),
            make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared"),
        ]
    )
    sqlite_session.commit()

    with _registered_upload_reference_guards():
        message_file = MessageFile(
            message_id="message-1",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            upload_file_id="file-1",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
        sqlite_session.add(message_file)
        sqlite_session.commit()

        sessions = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
        with sessions.begin() as cleanup:
            pending = cleanup.get(UploadFile, "file-1")
            assert pending is not None
            pending.knowledge_cleanup_started_at = datetime(2026, 1, 1)

        message_file.url = "/files/file-1/file-preview"
        with pytest.raises(UploadFilePendingDeletionError):
            sqlite_session.flush()
        sqlite_session.rollback()


def test_message_and_workflow_references_block_knowledge_cleanup(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/shared")
    sqlite_session.add(upload)
    sqlite_session.add(
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=None,
            type_=ExecutionOffLoadType.OUTPUTS,
            file_id=upload.id,
        )
    )
    sqlite_session.flush()
    candidate = (UploadFileCleanup(id=upload.id, key=upload.key),)
    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == ()

    sqlite_session.execute(
        delete(WorkflowNodeExecutionOffload).where(WorkflowNodeExecutionOffload.file_id == upload.id)
    )
    conversation = Conversation(
        app_id="app-1",
        mode=AppMode.CHAT,
        name="conversation",
        inputs={},
        from_source=ConversationFromSource.API,
    )
    sqlite_session.add(conversation)
    sqlite_session.flush()
    message = Message(
        app_id="app-1",
        conversation_id=conversation.id,
        inputs={},
        query="question",
        message={},
        message_unit_price=0,
        answer="answer",
        answer_unit_price=0,
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    sqlite_session.add(message)
    sqlite_session.flush()
    sqlite_session.add(
        MessageFile(
            message_id=message.id,
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            upload_file_id=upload.id,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
        )
    )
    sqlite_session.flush()

    assert claim_orphan_upload_files(sqlite_session, tenant_id="tenant-1", files=candidate) == ()


def test_stale_segment_edges_do_not_keep_deleted_owner_files_alive(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/orphan")
    sqlite_session.add_all(
        [
            upload,
            KnowledgeUploadFileReference(
                tenant_id="tenant-1",
                upload_file_id=upload.id,
                dataset_id="dataset-deleted",
                document_id="document-deleted",
                kind="segment_image",
                resource_id="segment-deleted",
            ),
            SegmentAttachmentBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-deleted",
                document_id="document-deleted",
                segment_id="segment-deleted",
                attachment_id=upload.id,
            ),
        ]
    )
    sqlite_session.flush()

    claimed = claim_orphan_upload_files(
        sqlite_session,
        tenant_id="tenant-1",
        files=(UploadFileCleanup(id=upload.id, key=None),),
    )

    assert claimed == (UploadFileCleanup(id=upload.id, key="files/orphan"),)
    assert sqlite_session.scalars(select(KnowledgeUploadFileReference)).all() == []
    assert sqlite_session.scalars(select(SegmentAttachmentBinding)).all() == []


def test_cleanup_owner_lock_conflict_uses_mysql_nowait_and_rolls_back(sqlite_session: Session) -> None:
    upload = make_upload_file(file_id="file-1", tenant_id="tenant-1", key="files/orphan")
    stale_reference = KnowledgeUploadFileReference(
        tenant_id="tenant-1",
        upload_file_id=upload.id,
        dataset_id="dataset-deleted",
        document_id="document-deleted",
        kind="segment_image",
        resource_id="segment-deleted",
    )
    sqlite_session.add_all([upload, stale_reference])
    sqlite_session.commit()
    upload_id = upload.id
    upload_key = upload.key
    reference_id = stale_reference.id
    compiled_owner_reads: list[str] = []

    def reject_dataset_owner_lock(execute_state: ORMExecuteState) -> None:
        statement = cast(Select[tuple[object]], execute_state.statement)
        compiled = str(statement.compile(dialect=mysql.dialect()))
        if "FROM datasets" not in compiled:
            return
        compiled_owner_reads.append(compiled)
        if "FOR UPDATE NOWAIT" in compiled:
            raise OperationalError(compiled, {}, RuntimeError("owner row is busy"))

    event.listen(sqlite_session, "do_orm_execute", reject_dataset_owner_lock)
    try:
        with pytest.raises(OperationalError, match="owner row is busy"), sqlite_session.begin():
            claim_orphan_upload_files(
                sqlite_session,
                tenant_id="tenant-1",
                files=(UploadFileCleanup(id=upload_id, key=upload_key),),
            )
    finally:
        event.remove(sqlite_session, "do_orm_execute", reject_dataset_owner_lock)

    assert compiled_owner_reads
    assert all("FOR UPDATE NOWAIT" in statement for statement in compiled_owner_reads)
    assert sqlite_session.get_one(UploadFile, upload_id).knowledge_cleanup_started_at is None
    assert sqlite_session.get_one(KnowledgeUploadFileReference, reference_id).id == reference_id
