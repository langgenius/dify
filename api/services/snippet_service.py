import json
import logging
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.node_factory import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from graphon.enums import BuiltinNodeTypes, NodeType
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account, TagBinding
from models.agent import (
    WORKFLOW_ONLY_AGENT_SOURCES,
    Agent,
    AgentScope,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.enums import WorkflowRunTriggeredFrom
from models.model import App, AppMode, UploadFile
from models.snippet import CustomizedSnippet, SnippetType
from models.tools import WorkflowToolProvider
from models.workflow import (
    Workflow,
    WorkflowAppLog,
    WorkflowArchiveLog,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowKind,
    WorkflowNodeExecutionModel,
    WorkflowRun,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.tag_service import TagService
from services.workflow_node_execution_trace_service import (
    WorkflowNodeExecutionTrace,
    assemble_workflow_node_execution_traces,
)
from services.workflow_restore import apply_published_workflow_snapshot_to_draft

logger = logging.getLogger(__name__)

# Node types not allowed in snippet workflows (sync, publish, DSL import).
SNIPPET_FORBIDDEN_NODE_TYPES: frozenset[str] = frozenset(
    {
        BuiltinNodeTypes.START,
        BuiltinNodeTypes.HUMAN_INPUT,
        BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
    }
)


class SnippetService:
    """Service for managing customized snippets."""

    def __init__(
        self,
        session_maker: sessionmaker[Session] | Session | None = None,
        session: Session | None = None,
    ):
        """Initialize SnippetService with repository dependencies."""
        if isinstance(session_maker, Session):
            session = session_maker
            session_maker = None
        if session is not None:
            session_maker = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        if session_maker is None:
            raise ValueError("SnippetService requires a session or session_maker.")
        self._session = session
        self._session_maker = session_maker
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    @contextmanager
    def _session_scope(self) -> Generator[Session, None, None]:
        current_session = getattr(self, "_session", None)
        if current_session is not None:
            yield current_session
            return

        with self._session_maker() as session:
            yield session

    def _commit_if_owned(self, session: Session) -> None:
        if getattr(self, "_session", None) is None:
            session.commit()

    @staticmethod
    def _snippet_kind_filter():
        """Match snippet workflows by business kind."""
        return Workflow.kind == WorkflowKind.SNIPPET.value

    @staticmethod
    def _delete_draft_variable_files(*, session: Session, snippet: CustomizedSnippet) -> None:
        file_ids = list(
            session.scalars(
                select(WorkflowDraftVariable.file_id).where(
                    WorkflowDraftVariable.app_id == snippet.id,
                    WorkflowDraftVariable.file_id.is_not(None),
                )
            ).all()
        )
        if not file_ids:
            return

        file_records = session.execute(
            select(WorkflowDraftVariableFile.id, WorkflowDraftVariableFile.upload_file_id, UploadFile.key)
            .join(UploadFile, UploadFile.id == WorkflowDraftVariableFile.upload_file_id)
            .where(
                WorkflowDraftVariableFile.tenant_id == snippet.tenant_id,
                WorkflowDraftVariableFile.app_id == snippet.id,
                WorkflowDraftVariableFile.id.in_(file_ids),
            )
        ).all()
        upload_file_ids: list[str] = []

        from extensions.ext_storage import storage

        for _, upload_file_id, storage_key in file_records:
            try:
                storage.delete(storage_key)
            except Exception:
                logger.exception("Failed to delete snippet draft variable storage object %s", storage_key)
            upload_file_ids.append(upload_file_id)

        if upload_file_ids:
            session.execute(
                delete(UploadFile)
                .where(UploadFile.id.in_(upload_file_ids))
                .execution_options(synchronize_session=False)
            )
        session.execute(
            delete(WorkflowDraftVariableFile)
            .where(
                WorkflowDraftVariableFile.tenant_id == snippet.tenant_id,
                WorkflowDraftVariableFile.app_id == snippet.id,
                WorkflowDraftVariableFile.id.in_(file_ids),
            )
            .execution_options(synchronize_session=False)
        )

    @staticmethod
    def _delete_archived_workflow_run_files(*, snippet: CustomizedSnippet) -> None:
        from configs import dify_config
        from libs.archive_storage import ArchiveStorageNotConfiguredError, get_archive_storage

        if not (dify_config.BILLING_ENABLED and dify_config.ARCHIVE_STORAGE_ENABLED):
            return

        prefix = f"{snippet.tenant_id}/app_id={snippet.id}/"
        try:
            archive_storage = get_archive_storage()
        except ArchiveStorageNotConfiguredError as e:
            logger.info("Archive storage not configured, skipping snippet archive file cleanup: %s", e)
            return

        try:
            keys = archive_storage.list_objects(prefix)
        except Exception:
            logger.exception("Failed to list snippet archive files for prefix %s", prefix)
            return

        for key in keys:
            try:
                archive_storage.delete_object(key)
            except Exception:
                logger.exception("Failed to delete snippet archive file %s", key)

    @staticmethod
    def validate_snippet_graph_forbidden_nodes(graph: Mapping[str, Any]) -> None:
        """Reject graphs that contain node types not allowed in snippets."""
        nodes = graph.get("nodes") or []
        disallowed: list[tuple[str, str]] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_data = node.get("data") or {}
            node_type = node_data.get("type")
            if not isinstance(node_type, str):
                continue
            if node_type in SNIPPET_FORBIDDEN_NODE_TYPES:
                node_id = node.get("id")
                disallowed.append((str(node_id) if node_id is not None else "?", node_type))
        if not disallowed:
            return
        detail = ", ".join(f"{nid}:{t}" for nid, t in disallowed)
        raise ValueError(
            f"Snippet workflow cannot contain start, human-input, or knowledge-retrieval nodes. Found: {detail}"
        )

    # --- CRUD Operations ---

    def get_snippets(
        self,
        *,
        tenant_id: str,
        session: Session,
        page: int = 1,
        limit: int = 20,
        keyword: str | None = None,
        is_published: bool | None = None,
        creators: list[str] | None = None,
        tag_ids: list[str] | None = None,
    ) -> tuple[Sequence[CustomizedSnippet], int, bool]:
        """
        Get paginated list of snippets with optional search.

        :param tenant_id: Tenant ID
        :param page: Page number (1-indexed)
        :param limit: Number of items per page
        :param keyword: Optional search keyword for name/description
        :param is_published: Optional filter by published status (True/False/None for all)
        :param creators: Optional filter by creator account IDs
        :param tag_ids: Optional filter by tag IDs
        :return: Tuple of (snippets list, total count, has_more flag)
        """
        stmt = (
            select(CustomizedSnippet)
            .where(CustomizedSnippet.tenant_id == tenant_id)
            .order_by(CustomizedSnippet.created_at.desc())
        )

        if keyword:
            stmt = stmt.where(
                CustomizedSnippet.name.ilike(f"%{keyword}%") | CustomizedSnippet.description.ilike(f"%{keyword}%")
            )

        if is_published is not None:
            stmt = stmt.where(CustomizedSnippet.is_published == is_published)

        if creators:
            stmt = stmt.where(CustomizedSnippet.created_by.in_(creators))

        if tag_ids:
            target_ids = TagService.get_target_ids_by_tag_ids("snippet", tenant_id, tag_ids, session, match_all=True)
            if target_ids:
                stmt = stmt.where(CustomizedSnippet.id.in_(target_ids))
            else:
                return [], 0, False

        # Get total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        # Apply pagination
        stmt = stmt.limit(limit + 1).offset((page - 1) * limit)
        snippets = list(session.scalars(stmt).all())

        has_more = len(snippets) > limit
        if has_more:
            snippets = snippets[:-1]

        return snippets, total, has_more

    def get_snippet_by_id(
        self,
        *,
        snippet_id: str,
        tenant_id: str,
    ) -> CustomizedSnippet | None:
        """
        Get snippet by ID with tenant isolation.

        :param snippet_id: Snippet ID
        :param tenant_id: Tenant ID
        :return: CustomizedSnippet or None
        """
        with self._session_scope() as session:
            stmt = select(CustomizedSnippet).where(
                CustomizedSnippet.id == snippet_id,
                CustomizedSnippet.tenant_id == tenant_id,
            )
            return session.scalar(stmt)

    def create_snippet(
        self,
        *,
        tenant_id: str,
        name: str,
        description: str | None,
        snippet_type: SnippetType,
        icon_info: dict | None,
        input_fields: list[dict] | None,
        account: Account,
    ) -> CustomizedSnippet:
        """
        Create a new snippet.

        :param tenant_id: Tenant ID
        :param name: Snippet name
        :param description: Snippet description
        :param snippet_type: Type of snippet (node or group)
        :param icon_info: Icon information
        :param input_fields: Input field definitions
        :param account: Creator account
        :return: Created CustomizedSnippet
        """
        snippet = CustomizedSnippet(
            tenant_id=tenant_id,
            name=name,
            description=description or "",
            type=snippet_type.value,
            icon_info=icon_info,
            input_fields=json.dumps(input_fields) if input_fields else None,
            created_by=account.id,
        )

        with self._session_scope() as session:
            session.add(snippet)
            self._commit_if_owned(session)

        return snippet

    @staticmethod
    def update_snippet(
        *,
        session: Session,
        snippet: CustomizedSnippet,
        account_id: str,
        data: dict,
    ) -> CustomizedSnippet:
        """
        Update snippet attributes.

        :param session: Database session
        :param snippet: Snippet to update
        :param account_id: ID of account making the update
        :param data: Dictionary of fields to update
        :return: Updated CustomizedSnippet
        """
        if "name" in data:
            snippet.name = data["name"]

        if "description" in data:
            snippet.description = data["description"]

        if "icon_info" in data:
            snippet.icon_info = data["icon_info"]

        snippet.updated_by = account_id
        snippet.updated_at = datetime.now(UTC).replace(tzinfo=None)

        session.add(snippet)
        return snippet

    @staticmethod
    def delete_snippet(
        *,
        session: Session,
        snippet: CustomizedSnippet,
        account_id: str | None = None,
    ) -> bool:
        """
        Delete a snippet.

        :param session: Database session
        :param snippet: Snippet to delete
        :return: True if deleted successfully
        """
        SnippetService._delete_draft_variable_files(session=session, snippet=snippet)
        owned_agents = session.scalars(
            select(Agent).where(
                Agent.tenant_id == snippet.tenant_id,
                Agent.app_id == snippet.id,
                Agent.scope == AgentScope.WORKFLOW_ONLY,
                Agent.source.in_(WORKFLOW_ONLY_AGENT_SOURCES),
                Agent.status == AgentStatus.ACTIVE,
            )
        ).all()
        now = datetime.now(UTC).replace(tzinfo=None)
        backing_app_ids = {agent.backing_app_id for agent in owned_agents if agent.backing_app_id}
        for agent in owned_agents:
            agent.status = AgentStatus.ARCHIVED
            agent.archived_by = account_id
            agent.archived_at = now
            agent.updated_by = account_id or agent.updated_by
            agent.updated_at = now

        if backing_app_ids:
            session.execute(
                delete(App)
                .where(
                    App.tenant_id == snippet.tenant_id,
                    App.id.in_(backing_app_ids),
                    App.mode == AppMode.AGENT,
                )
                .execution_options(synchronize_session=False)
            )
            tenant_id = snippet.tenant_id

            def cleanup_backing_apps(_session: Session) -> None:
                from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

                for app_id in backing_app_ids:
                    remove_app_and_related_data_task.delay(tenant_id=tenant_id, app_id=app_id)

            event.listen(session, "after_commit", cleanup_backing_apps, once=True)

        session.execute(
            delete(WorkflowAgentNodeBinding)
            .where(
                WorkflowAgentNodeBinding.tenant_id == snippet.tenant_id,
                WorkflowAgentNodeBinding.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(WorkflowDraftVariable)
            .where(WorkflowDraftVariable.app_id == snippet.id)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(WorkflowToolProvider)
            .where(
                WorkflowToolProvider.tenant_id == snippet.tenant_id,
                WorkflowToolProvider.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(WorkflowAppLog)
            .where(
                WorkflowAppLog.tenant_id == snippet.tenant_id,
                WorkflowAppLog.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(WorkflowArchiveLog)
            .where(
                WorkflowArchiveLog.tenant_id == snippet.tenant_id,
                WorkflowArchiveLog.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        SnippetService._delete_archived_workflow_run_files(snippet=snippet)
        session.execute(
            delete(WorkflowNodeExecutionModel)
            .where(
                WorkflowNodeExecutionModel.tenant_id == snippet.tenant_id,
                WorkflowNodeExecutionModel.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(WorkflowRun)
            .where(
                WorkflowRun.tenant_id == snippet.tenant_id,
                WorkflowRun.app_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(Workflow)
            .where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                SnippetService._snippet_kind_filter(),
            )
            .execution_options(synchronize_session=False)
        )
        session.execute(
            delete(TagBinding)
            .where(
                TagBinding.tenant_id == snippet.tenant_id,
                TagBinding.target_id == snippet.id,
            )
            .execution_options(synchronize_session=False)
        )
        session.delete(snippet)
        return True

    # --- Workflow Operations ---

    def get_draft_workflow(self, snippet: CustomizedSnippet) -> Workflow | None:
        """
        Get draft workflow for snippet.

        :param snippet: CustomizedSnippet instance
        :return: Draft Workflow or None
        """
        with self._session_scope() as session:
            stmt = select(Workflow).where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                self._snippet_kind_filter(),
                Workflow.version == "draft",
            )
            return session.scalar(stmt)

    def get_published_workflow(self, snippet: CustomizedSnippet) -> Workflow | None:
        """
        Get published workflow for snippet.

        :param snippet: CustomizedSnippet instance
        :return: Published Workflow or None
        """
        if not snippet.workflow_id:
            return None

        with self._session_scope() as session:
            stmt = select(Workflow).where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                self._snippet_kind_filter(),
                Workflow.id == snippet.workflow_id,
            )
            return session.scalar(stmt)

    def get_published_workflow_by_id(self, snippet: CustomizedSnippet, workflow_id: str) -> Workflow | None:
        """
        Get a published workflow snapshot by ID for snippet history restore.

        :param snippet: CustomizedSnippet instance
        :param workflow_id: Workflow ID
        :return: Published Workflow or None
        :raises IsDraftWorkflowError: If the workflow ID points to a draft workflow
        """
        with self._session_scope() as session:
            stmt = select(Workflow).where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                self._snippet_kind_filter(),
                Workflow.id == workflow_id,
            )
            workflow = session.scalar(stmt)
        if not workflow:
            return None
        if workflow.version == Workflow.VERSION_DRAFT:
            raise IsDraftWorkflowError("source workflow must be published")
        return workflow

    def sync_draft_workflow(
        self,
        *,
        snippet: CustomizedSnippet,
        graph: dict,
        unique_hash: str | None,
        account: Account,
        input_fields: list[dict] | None = None,
        sync_agent_bindings: bool = True,
    ) -> Workflow:
        """
        Sync draft workflow for snippet.

        Snippet workflows do not persist environment variables (always empty) or
        conversation variables (always empty).

        :param snippet: CustomizedSnippet instance
        :param graph: Workflow graph configuration
        :param unique_hash: Hash for conflict detection
        :param account: Account making the change
        :param input_fields: Input fields for snippet
        :return: Synced Workflow
        :raises WorkflowHashNotEqualError: If hash mismatch
        """
        SnippetService.validate_snippet_graph_forbidden_nodes(graph)

        workflow = self.get_draft_workflow(snippet=snippet)

        if workflow and workflow.unique_hash != unique_hash:
            raise WorkflowHashNotEqualError()

        # Create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=snippet.tenant_id,
                app_id=snippet.id,
                features="{}",
                type=WorkflowType.WORKFLOW,
                kind=WorkflowKind.SNIPPET,
                version="draft",
                graph=json.dumps(graph),
                created_by=account.id,
                environment_variables=[],
                conversation_variables=[],
            )
        else:
            # Update existing draft workflow
            workflow.graph = json.dumps(graph)
            workflow.type = WorkflowType.WORKFLOW
            workflow.kind = WorkflowKind.SNIPPET
            workflow.updated_by = account.id
            workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
            workflow.environment_variables = []
            workflow.conversation_variables = []

        # Update snippet's input_fields if provided
        if input_fields is not None:
            snippet.input_fields = json.dumps(input_fields)
            snippet.updated_by = account.id
            snippet.updated_at = datetime.now(UTC).replace(tzinfo=None)

        from services.agent.workflow_publish_service import WorkflowAgentPublishService

        with self._session_scope() as session:
            session.add(workflow)
            session.add(snippet)
            if sync_agent_bindings:
                session.flush()
                WorkflowAgentPublishService.sync_agent_bindings_for_draft(
                    session=session,
                    draft_workflow=workflow,
                    account_id=account.id,
                )
                WorkflowAgentPublishService.validate_agent_nodes_for_draft_sync(
                    session=session,
                    draft_workflow=workflow,
                )
            self._commit_if_owned(session)
        return workflow

    def restore_published_workflow_to_draft(
        self,
        *,
        snippet: CustomizedSnippet,
        workflow_id: str,
        account: Account,
    ) -> Workflow:
        """
        Restore a published snippet workflow snapshot into the draft workflow.

        :param snippet: CustomizedSnippet instance
        :param workflow_id: Published workflow ID
        :param account: Account making the change
        :return: Restored draft Workflow
        :raises WorkflowNotFoundError: If the source workflow does not exist
        :raises IsDraftWorkflowError: If the source workflow is a draft
        :raises ValueError: If the restored graph is invalid for snippets
        """
        source_workflow = self.get_published_workflow_by_id(snippet=snippet, workflow_id=workflow_id)
        if not source_workflow:
            raise WorkflowNotFoundError("Workflow not found.")

        SnippetService.validate_snippet_graph_forbidden_nodes(source_workflow.graph_dict)

        draft_workflow = self.get_draft_workflow(snippet=snippet)
        draft_workflow, _is_new_draft = apply_published_workflow_snapshot_to_draft(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            source_workflow=source_workflow,
            draft_workflow=draft_workflow,
            account=account,
            updated_at_factory=lambda: datetime.now(UTC).replace(tzinfo=None),
        )

        with self._session_scope() as session:
            session.add(draft_workflow)
            session.flush()
            from services.agent.workflow_publish_service import WorkflowAgentPublishService

            WorkflowAgentPublishService.restore_agent_node_bindings_to_draft(
                session=session,
                source_workflow=source_workflow,
                draft_workflow=draft_workflow,
                account_id=account.id,
            )
            self._commit_if_owned(session)
        return draft_workflow

    def publish_workflow(
        self,
        *,
        session: Session,
        snippet: CustomizedSnippet,
        account: Account,
    ) -> Workflow:
        """
        Publish the draft workflow as a new version.

        :param session: Database session
        :param snippet: CustomizedSnippet instance
        :param account: Account making the change
        :return: Published Workflow
        :raises ValueError: If no draft workflow exists
        """
        draft_workflow_stmt = select(Workflow).where(
            Workflow.tenant_id == snippet.tenant_id,
            Workflow.app_id == snippet.id,
            self._snippet_kind_filter(),
            Workflow.version == "draft",
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        SnippetService.validate_snippet_graph_forbidden_nodes(draft_workflow.graph_dict)

        from services.agent.workflow_publish_service import WorkflowAgentPublishService

        WorkflowAgentPublishService.validate_agent_nodes_for_publish(
            session=session,
            draft_workflow=draft_workflow,
        )

        # Create new published workflow
        workflow = Workflow.new(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            type=WorkflowType.WORKFLOW.value,
            version=str(datetime.now(UTC).replace(tzinfo=None)),
            graph=draft_workflow.graph,
            features=draft_workflow.features,
            created_by=account.id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=draft_workflow.rag_pipeline_variables,
            kind=WorkflowKind.SNIPPET.value,
        )
        session.add(workflow)
        WorkflowAgentPublishService.copy_agent_node_bindings_to_published(
            session=session,
            draft_workflow=draft_workflow,
            published_workflow=workflow,
        )

        # Update snippet version
        snippet.version += 1
        snippet.is_published = True
        snippet.workflow_id = workflow.id
        snippet.updated_by = account.id
        session.add(snippet)

        return workflow

    def get_all_published_workflows(
        self,
        *,
        session: Session,
        snippet: CustomizedSnippet,
        page: int,
        limit: int,
    ) -> tuple[Sequence[Workflow], bool]:
        """
        Get all published workflow versions for snippet.

        :param session: Database session
        :param snippet: CustomizedSnippet instance
        :param page: Page number
        :param limit: Items per page
        :return: Tuple of (workflows list, has_more flag)
        """
        if not snippet.workflow_id:
            return [], False

        stmt = (
            select(Workflow)
            .where(
                Workflow.app_id == snippet.id,
                self._snippet_kind_filter(),
                Workflow.version != "draft",
            )
            .order_by(Workflow.version.desc())
            .limit(limit + 1)
            .offset((page - 1) * limit)
        )

        workflows = list(session.scalars(stmt).all())
        has_more = len(workflows) > limit
        if has_more:
            workflows = workflows[:-1]

        return workflows, has_more

    def update_workflow(
        self,
        *,
        session: Session,
        snippet: CustomizedSnippet,
        workflow_id: str,
        account: Account,
        data: dict[str, Any],
    ) -> Workflow | None:
        """
        Update a published snippet workflow version's display metadata.

        :param session: Database session
        :param snippet: CustomizedSnippet instance
        :param workflow_id: Workflow ID
        :param account: Account making the change
        :param data: Dictionary containing fields to update
        :return: Updated workflow or None if not found
        """
        stmt = select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.tenant_id == snippet.tenant_id,
            Workflow.app_id == snippet.id,
            self._snippet_kind_filter(),
            Workflow.version != Workflow.VERSION_DRAFT,
        )
        workflow = session.scalar(stmt)
        if not workflow:
            return None

        allowed_fields = {"marked_name", "marked_comment"}
        for field, value in data.items():
            if field in allowed_fields:
                setattr(workflow, field, value)

        workflow.updated_by = account.id
        workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
        session.add(workflow)
        return workflow

    # --- Default Block Configs ---

    def get_default_block_configs(self) -> list[dict]:
        """
        Get default block configurations for all node types.

        :return: List of default configurations
        """
        default_block_configs: list[dict[str, Any]] = []
        for node_class_mapping in NODE_TYPE_CLASSES_MAPPING.values():
            node_class = node_class_mapping[LATEST_VERSION]
            default_config = node_class.get_default_config()
            if default_config:
                default_block_configs.append(dict(default_config))

        return default_block_configs

    def get_default_block_config(self, node_type: str, filters: dict | None = None) -> Mapping[str, object] | None:
        """
        Get default config for specific node type.

        :param node_type: Node type string
        :param filters: Optional filters
        :return: Default configuration or None
        """
        node_type_enum: NodeType = node_type

        if node_type_enum not in NODE_TYPE_CLASSES_MAPPING:
            return None

        node_class = NODE_TYPE_CLASSES_MAPPING[node_type_enum][LATEST_VERSION]
        default_config = node_class.get_default_config(filters=filters)
        if not default_config:
            return None

        return default_config

    # --- Workflow Run Operations ---

    def get_snippet_workflow_runs(
        self,
        *,
        snippet: CustomizedSnippet,
        args: dict,
    ) -> InfiniteScrollPagination:
        """
        Get paginated workflow runs for snippet.

        :param snippet: CustomizedSnippet instance
        :param args: Request arguments (last_id, limit)
        :return: InfiniteScrollPagination result
        """
        limit = int(args.get("limit", 20))
        last_id = args.get("last_id")

        triggered_from_values = [
            WorkflowRunTriggeredFrom.DEBUGGING,
        ]

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            triggered_from=triggered_from_values,
            limit=limit,
            last_id=last_id,
        )

    def get_snippet_workflow_run(
        self,
        *,
        snippet: CustomizedSnippet,
        run_id: str,
    ) -> WorkflowRun | None:
        """
        Get workflow run details.

        :param snippet: CustomizedSnippet instance
        :param run_id: Workflow run ID
        :return: WorkflowRun or None
        """
        return self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            run_id=run_id,
        )

    def get_snippet_workflow_run_node_executions(
        self,
        *,
        snippet: CustomizedSnippet,
        run_id: str,
    ) -> list[WorkflowNodeExecutionTrace]:
        """
        Get workflow run node execution list.

        :param snippet: CustomizedSnippet instance
        :param run_id: Workflow run ID
        :return: Public terminal and retry trace records
        """
        workflow_run = self.get_snippet_workflow_run(snippet=snippet, run_id=run_id)
        if not workflow_run:
            return []

        node_executions = self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            workflow_run_id=workflow_run.id,
        )

        return assemble_workflow_node_execution_traces(node_executions, self._node_execution_service_repo)

    # --- Node Execution Operations ---

    def get_snippet_node_last_run(
        self,
        *,
        snippet: CustomizedSnippet,
        workflow: Workflow,
        node_id: str,
    ) -> WorkflowNodeExecutionModel | None:
        """
        Get the most recent execution for a specific node in a snippet workflow.

        :param snippet: CustomizedSnippet instance
        :param workflow: Workflow instance
        :param node_id: Node identifier
        :return: WorkflowNodeExecutionModel or None
        """
        return self._node_execution_service_repo.get_node_last_execution(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            workflow_id=workflow.id,
            node_id=node_id,
        )

    # --- Use Count ---

    @staticmethod
    def increment_use_count(
        *,
        session: Session,
        snippet: CustomizedSnippet,
    ) -> None:
        """
        Increment the use_count when snippet is used.

        :param session: Database session
        :param snippet: CustomizedSnippet instance
        """
        snippet.use_count += 1
        session.add(snippet)
