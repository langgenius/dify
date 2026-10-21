"""API/Celery bootstrap coverage for UploadFile writer fences."""

from collections.abc import Callable
from itertools import starmap

from sqlalchemy import event

from dify_app import DifyApp
from extensions import ext_upload_file_reference_guards
from models.account import Account, Tenant
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigSnapshot,
    AgentConfigToolFileReference,
    AgentConfigUploadFileReference,
)
from models.dataset import Dataset, Document, DocumentSegment, PipelineCustomizedTemplate, SegmentAttachmentBinding
from models.human_input import HumanInputFormUploadFile
from models.model import App, KnowledgeUploadFileReference, MessageFile, Site
from models.snippet import CustomizedSnippet
from models.tools import MCPToolProvider
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowDraftVariableUploadFileReference,
    WorkflowNodeExecutionOffload,
)
from repositories.knowledge.upload_file_repository import (
    claim_detached_icon_upload_references,
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
    remove_agent_config_upload_references,
    sync_agent_config_upload_references,
    sync_knowledge_owner_upload_references,
    sync_workflow_draft_variable_upload_references,
)


def test_fresh_process_extension_bootstrap_registers_every_writer_fence_idempotently() -> None:
    """Both API and Celery workers run this extension through ``app_factory``."""

    listeners: tuple[tuple[type[object], str, Callable[..., object]], ...] = (
        tuple(
            (model, operation, listener)
            for model, listener in (
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
            for operation in ("before_insert", "before_update")
        )
        + tuple(
            (model, "before_delete", prepare_icon_owner_deletion)
            for model in (
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
        )
        + tuple(
            (model, operation, claim_detached_icon_upload_references)
            for model in (
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
            for operation in ("after_update", "after_delete")
        )
        + (
            (WorkflowDraftVariable, "after_insert", sync_workflow_draft_variable_upload_references),
            (WorkflowDraftVariable, "after_update", sync_workflow_draft_variable_upload_references),
            (AgentConfigDraft, "after_insert", sync_agent_config_upload_references),
            (AgentConfigDraft, "after_update", sync_agent_config_upload_references),
            (AgentConfigSnapshot, "after_insert", sync_agent_config_upload_references),
            (AgentConfigSnapshot, "after_update", sync_agent_config_upload_references),
            (Document, "after_insert", sync_knowledge_owner_upload_references),
            (Document, "after_update", sync_knowledge_owner_upload_references),
            (DocumentSegment, "after_insert", sync_knowledge_owner_upload_references),
            (DocumentSegment, "after_update", sync_knowledge_owner_upload_references),
            (AgentConfigDraft, "before_delete", prepare_agent_config_deletion),
            (AgentConfigDraft, "after_delete", remove_agent_config_upload_references),
            (AgentConfigSnapshot, "before_delete", prepare_agent_config_deletion),
            (AgentConfigSnapshot, "after_delete", remove_agent_config_upload_references),
        )
    )
    previous = {entry: event.contains(*entry) for entry in listeners}
    for entry, registered in previous.items():
        if registered:
            event.remove(*entry)
    try:
        app = DifyApp("upload-file-reference-guard-bootstrap")
        ext_upload_file_reference_guards.init_app(app)
        ext_upload_file_reference_guards.init_app(app)
        assert all(starmap(event.contains, listeners))
    finally:
        for entry in listeners:
            if event.contains(*entry):
                event.remove(*entry)
        for entry, registered in previous.items():
            if registered:
                event.listen(*entry)
