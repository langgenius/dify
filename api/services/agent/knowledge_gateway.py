"""Authorize finite KnowledgeFS commands; execute network I/O in the async Stub.

Separating authorization from transport lets run cancellation close the actual
KnowledgeFS request. No model-supplied URL, identity, policy or upstream header
crosses this boundary. A prepared capability is private server-to-server data.
"""

from __future__ import annotations

from typing import Literal, cast
from urllib.parse import quote, urlsplit

from dify_agent.protocol.knowledge_fs import (
    KnowledgeFsBinding,
    KnowledgeFsError,
    KnowledgeFsPreparedRequest,
    KnowledgeFsPrepareRequest,
)
from pydantic import JsonValue
from sqlalchemy import select

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from core.db.session_factory import session_factory
from factories.file_factory.builders import build_from_mapping
from models.agent import Agent, AgentStatus, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig
from models.enums import AppStatus
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from models.model import App, AppMode, EndUser
from services.account_service import TenantService
from services.agent_config_service import AgentConfigService, AgentConfigVersionKind
from services.knowledge_fs.app_execution_capability import _move_query_image_grants_to_internal_header
from services.knowledge_fs.product_dto import KnowledgeFSRetrievalQueryImageReference, KnowledgeFSRetrievalTestPayload
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.query_images import (
    QUERY_IMAGE_MAX_TOTAL_BYTES,
    issue_workflow_query_image_reference,
    validate_query_image_references,
)
from services.knowledge_fs.runtime import KnowledgeFSRuntime, get_knowledge_fs_runtime

_OPERATIONS = {
    "capabilities": "getSettings",
    "search": "retrieveEvidence",
    "ls": "listKnowledgeFs",
    "tree": "treeKnowledgeFs",
    "find": "findKnowledgeFs",
    "grep": "grepKnowledgeFs",
    "cat": "catKnowledgeFs",
    "stat": "statKnowledgeFs",
    "diff": "diffKnowledgeFs",
    "open": "openNodeKnowledgeFs",
    "images": "getDocumentMultimodalManifest",
    "image": "getDocumentMultimodalAsset",
}


class AgentKnowledgeGateway:
    def __init__(self, runtime: KnowledgeFSRuntime | None = None) -> None:
        self._runtime = runtime

    def prepare(self, request: KnowledgeFsPrepareRequest) -> KnowledgeFsPreparedRequest:
        soul = self._authorize_context(request)
        expected = [
            KnowledgeFsBinding.model_validate(space.model_dump(exclude={"is_missing"}))
            for space in soul.knowledge.spaces
            if not space.is_missing
        ]
        if soul.knowledge.sets or expected != request.bindings or not expected:
            raise KnowledgeFsError(
                "KNOWLEDGE_CONFIG_CHANGED", "Knowledge bindings changed; start a new Agent turn.", 409
            )

        runtime = self._runtime or get_knowledge_fs_runtime(session_factory.get_session_maker())
        command = request.command
        if command.command == "spaces":
            # Availability is checked per space; one revoked space must not hide
            # all the other bound spaces. Never expose names outside the snapshot.
            spaces: list[JsonValue] = []
            for binding in expected:
                try:
                    self._issue(runtime, request, binding, "listKnowledgeFs")
                except (RuntimeError, ValueError, PermissionError):
                    spaces.append({"id": binding.id, "name": binding.name, "available": False})
                else:
                    spaces.append(
                        {"id": binding.id, "name": binding.name, "description": binding.description, "available": True}
                    )
            return KnowledgeFsPreparedRequest(operation="spaces", response_kind="local", data={"spaces": spaces})

        binding = next((item for item in expected if command.space in (item.id, item.name)), None)
        if binding is None:
            raise KnowledgeFsError("KNOWLEDGE_SPACE_NOT_BOUND", "Choose a space from knowledge spaces.", 403)
        citation = request.citation
        if command.receipt_id and (
            citation is None
            or citation.id != command.receipt_id
            or citation.control_space_id != binding.control_space_id
        ):
            raise KnowledgeFsError("KNOWLEDGE_RECEIPT_INVALID", "Evidence receipt is unavailable for this space.", 404)
        if command.command == "image" and not request.agent_supports_vision:
            raise KnowledgeFsError(
                "KNOWLEDGE_VISION_UNSUPPORTED", "This Agent model cannot consume images; use image captions."
            )

        operation_id = _OPERATIONS[command.command]
        if not is_product_operation_ready(operation_id):
            raise KnowledgeFsError(
                "KNOWLEDGE_PROTOCOL_UNAVAILABLE", "Deploy matching API and KnowledgeFS versions.", 503
            )
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        document_id = citation.document_asset_id if citation and command.command in {"images", "image"} else None
        issued = self._issue(runtime, request, binding, operation_id, resource_id=document_id)
        path = (operation.kfs_path or "").replace("{id}", quote(issued.knowledge_space_id, safe=""))
        if document_id:
            path = path.replace("{documentId}", quote(document_id, safe=""))
        if command.item_id:
            path = path.replace("{itemId}", quote(command.item_id, safe=""))
        if "{" in path or not path.startswith("/knowledge-spaces/"):
            raise KnowledgeFsError("KNOWLEDGE_PROTOCOL_UNAVAILABLE", "Knowledge command route is unavailable.", 503)
        base = dify_config.KNOWLEDGE_FS_BASE_URL or ""
        parsed = urlsplit(base)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.query
            or parsed.fragment
            or parsed.username
        ):
            raise KnowledgeFsError("KNOWLEDGE_UNAVAILABLE", "KnowledgeFS is not configured.", 503)
        headers = {
            "Authorization": f"Bearer {issued.token}",
            "X-Trace-Id": issued.trace_id,
            "Accept-Encoding": "identity",
        }
        query: dict[str, str] = {}
        payload = None
        if command.command == "search":
            images = self._query_images(request) if command.image_file_ids else []
            payload = cast(
                dict[str, JsonValue],
                KnowledgeFSRetrievalTestPayload(
                    query=command.query or "",
                    query_id=command.command_id,
                    queryImages=images,
                    mode="fast",
                    include_text=True,
                ).model_dump(mode="json", by_alias=True, exclude_none=True),
            )
            headers.update(_move_query_image_grants_to_internal_header(payload))
        elif command.command in {"ls", "tree", "find", "grep", "cat", "stat"}:
            query["path"] = command.path or "/knowledge"
            if command.command != "stat":
                query["limit"] = str(command.limit)
                if command.cursor:
                    query["cursor"] = command.cursor
            if command.command == "tree":
                query["depth"] = str(command.depth)
            elif command.command == "grep":
                query.update(q=command.query or "", timeoutMs="5000")
            elif command.command == "find":
                query["nameContains"] = command.query or ""
        elif command.command == "diff":
            query = {"oldPath": command.old_path or "", "newPath": command.new_path or "", "mode": "line"}
        elif command.command == "open":
            query["nodeId"] = citation.node_id if citation else command.node_id or ""
        elif command.command == "image":
            # The bounded thumbnail is a parser-produced variant, never an
            # arbitrary file/URL. A missing variant is an explicit failure.
            query["variant"] = "thumbnail"
            if citation:
                query["expectedArtifactHash"] = citation.artifact_hash
        return KnowledgeFsPreparedRequest(
            operation=operation_id,
            url=f"{base.rstrip('/')}{path}",
            method=cast(Literal["GET", "POST"], operation.method),
            headers=headers,
            query=query,
            payload=payload,
            binding=binding,
            trace_id=issued.trace_id,
            response_kind="image" if command.command == "image" else "json",
            max_response_bytes=min(operation.max_response_bytes, 4 * 1024 * 1024),
        )

    @staticmethod
    def _authorize_context(request: KnowledgeFsPrepareRequest) -> AgentSoulConfig:
        context = request.execution_context
        if not (
            context.app_id
            and context.agent_id
            and context.user_id
            and context.user_from
            and context.agent_config_version_id
            and context.agent_config_version_kind
        ):
            raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Complete Agent execution context is required.", 403)
        with session_factory.create_session() as session:
            app = session.scalar(
                select(App).where(
                    App.id == context.app_id,
                    App.tenant_id == context.tenant_id,
                    App.status == AppStatus.NORMAL,
                )
            )
            agent = session.scalar(
                select(Agent).where(
                    Agent.id == context.agent_id,
                    Agent.tenant_id == context.tenant_id,
                    Agent.status == AgentStatus.ACTIVE,
                )
            )
            if app is None or agent is None:
                raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Agent application is unavailable.", 403)
            if context.user_from == "account":
                if not TenantService.account_belongs_to_tenant(context.user_id, context.tenant_id, session=session):
                    raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Workspace membership is unavailable.", 403)
            elif (
                session.scalar(
                    select(EndUser.id).where(
                        EndUser.id == context.user_id,
                        EndUser.tenant_id == context.tenant_id,
                        EndUser.app_id == context.app_id,
                    )
                )
                is None
            ):
                raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Application user is unavailable.", 403)
            if context.agent_mode == "agent_app":
                if app.mode != AppMode.AGENT or context.app_id not in {agent.app_id, agent.backing_app_id}:
                    raise KnowledgeFsError(
                        "KNOWLEDGE_CONTEXT_INVALID", "Agent does not belong to this application.", 403
                    )
            elif context.agent_mode in {"workflow_run", "single_step"}:
                if (
                    not (context.workflow_id and context.node_id)
                    or session.scalar(
                        select(WorkflowAgentNodeBinding.id).where(
                            WorkflowAgentNodeBinding.tenant_id == context.tenant_id,
                            WorkflowAgentNodeBinding.app_id == context.app_id,
                            WorkflowAgentNodeBinding.workflow_id == context.workflow_id,
                            WorkflowAgentNodeBinding.node_id == context.node_id,
                            WorkflowAgentNodeBinding.agent_id == context.agent_id,
                            WorkflowAgentNodeBinding.current_snapshot_id == context.agent_config_version_id,
                        )
                    )
                    is None
                ):
                    raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Workflow Agent binding changed.", 403)
            else:
                raise KnowledgeFsError("KNOWLEDGE_CONTEXT_INVALID", "Unsupported Agent execution mode.", 403)
        return (
            AgentConfigService()
            .resolve_target(
                tenant_id=context.tenant_id,
                agent_id=context.agent_id,
                user_id=context.user_id,
                config_version_id=context.agent_config_version_id,
                config_version_kind=AgentConfigVersionKind(context.agent_config_version_kind),
            )
            .agent_soul
        )

    @staticmethod
    def _issue(runtime, request, binding, operation_id, resource_id=None):
        context = request.execution_context
        preview = context.agent_config_version_kind != "snapshot" or context.invoke_from in {"debugger", "validation"}
        if preview:
            if context.user_from != "account":
                raise KnowledgeFsError("KNOWLEDGE_PREVIEW_FORBIDDEN", "Preview requires a workspace account.", 403)
            return runtime.broker.issue_interactive(
                tenant_id=context.tenant_id,
                account_id=context.user_id,
                control_space_id=binding.control_space_id,
                operation_id=operation_id,
                resource_id=resource_id,
            )
        return runtime.app_capabilities.issue(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            control_space_id=binding.control_space_id,
            caller_kind=(
                KnowledgeFSAppSpaceJoinType.AGENT
                if context.agent_mode == "agent_app"
                else KnowledgeFSAppSpaceJoinType.WORKFLOW
            ),
            operation_id=operation_id,
            resource_id=resource_id,
        )

    @staticmethod
    def _query_images(request: KnowledgeFsPrepareRequest) -> list[KnowledgeFSRetrievalQueryImageReference]:
        context = request.execution_context
        preview = context.agent_config_version_kind != "snapshot" or context.invoke_from in {"debugger", "validation"}
        if preview:
            metadata = validate_query_image_references(
                tenant_id=context.tenant_id,
                account_id=context.user_id or "",
                upload_file_ids=[str(file_id) for file_id in request.command.image_file_ids],
                mark_used=False,
            )
            return [KnowledgeFSRetrievalQueryImageReference(uploadFileId=item.upload_file_id) for item in metadata]
        scope = FileAccessScope(
            tenant_id=context.tenant_id,
            user_id=context.user_id or "",
            user_from=UserFrom(context.user_from),
            invoke_from=InvokeFrom(context.invoke_from),
        )
        result = []
        total = 0
        with bind_file_access_scope(scope):
            for file_id in request.command.image_file_ids:
                file = build_from_mapping(
                    mapping={"type": "image", "transfer_method": "local_file", "upload_file_id": str(file_id)},
                    tenant_id=context.tenant_id,
                    access_controller=DatabaseFileAccessController(),
                )
                ref = issue_workflow_query_image_reference(
                    app_id=context.app_id or "", tenant_id=context.tenant_id, file=file
                )
                total += ref.byte_size
                result.append(
                    KnowledgeFSRetrievalQueryImageReference(
                        uploadFileId=ref.upload_file_id, accessGrant=ref.access_grant
                    )
                )
        if total > QUERY_IMAGE_MAX_TOTAL_BYTES:
            raise KnowledgeFsError("QUERY_IMAGE_TOTAL_TOO_LARGE", "Query images exceed the aggregate byte budget.")
        return result
