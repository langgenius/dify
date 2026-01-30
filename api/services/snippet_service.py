import json
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.variables.variables import VariableBase
from core.workflow.enums import NodeType
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.enums import WorkflowRunTriggeredFrom
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowRun,
    WorkflowType,
)
from repositories.factory import DifyAPIRepositoryFactory
from services.errors.app import WorkflowHashNotEqualError

logger = logging.getLogger(__name__)


class SnippetService:
    """Service for managing customized snippets."""

    def __init__(self, session_maker: sessionmaker | None = None):
        """Initialize SnippetService with repository dependencies."""
        if session_maker is None:
            session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

    # --- CRUD Operations ---

    @staticmethod
    def get_snippets(
        *,
        tenant_id: str,
        page: int = 1,
        limit: int = 20,
        keyword: str | None = None,
    ) -> tuple[Sequence[CustomizedSnippet], int, bool]:
        """
        Get paginated list of snippets with optional search.

        :param tenant_id: Tenant ID
        :param page: Page number (1-indexed)
        :param limit: Number of items per page
        :param keyword: Optional search keyword for name/description
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

        # Get total count
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = db.session.scalar(count_stmt) or 0

        # Apply pagination
        stmt = stmt.limit(limit + 1).offset((page - 1) * limit)
        snippets = list(db.session.scalars(stmt).all())

        has_more = len(snippets) > limit
        if has_more:
            snippets = snippets[:-1]

        return snippets, total, has_more

    @staticmethod
    def get_snippet_by_id(
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
        return (
            db.session.query(CustomizedSnippet)
            .where(
                CustomizedSnippet.id == snippet_id,
                CustomizedSnippet.tenant_id == tenant_id,
            )
            .first()
        )

    @staticmethod
    def create_snippet(
        *,
        tenant_id: str,
        name: str,
        description: str | None,
        snippet_type: SnippetType,
        icon_info: dict | None,
        graph: dict | None,
        input_fields: list[dict] | None,
        account: Account,
    ) -> CustomizedSnippet:
        """
        Create a new snippet.

        :param tenant_id: Tenant ID
        :param name: Snippet name (must be unique per tenant)
        :param description: Snippet description
        :param snippet_type: Type of snippet (node or group)
        :param icon_info: Icon information
        :param graph: Workflow graph structure
        :param input_fields: Input field definitions
        :param account: Creator account
        :return: Created CustomizedSnippet
        :raises ValueError: If name already exists
        """
        # Check if name already exists for this tenant
        existing = (
            db.session.query(CustomizedSnippet)
            .where(
                CustomizedSnippet.tenant_id == tenant_id,
                CustomizedSnippet.name == name,
            )
            .first()
        )
        if existing:
            raise ValueError(f"Snippet with name '{name}' already exists")

        snippet = CustomizedSnippet(
            tenant_id=tenant_id,
            name=name,
            description=description or "",
            type=snippet_type.value,
            icon_info=icon_info,
            graph=json.dumps(graph) if graph else None,
            input_fields=json.dumps(input_fields) if input_fields else None,
            created_by=account.id,
        )

        db.session.add(snippet)
        db.session.commit()

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
            # Check if new name already exists for this tenant
            existing = (
                session.query(CustomizedSnippet)
                .where(
                    CustomizedSnippet.tenant_id == snippet.tenant_id,
                    CustomizedSnippet.name == data["name"],
                    CustomizedSnippet.id != snippet.id,
                )
                .first()
            )
            if existing:
                raise ValueError(f"Snippet with name '{data['name']}' already exists")
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
    ) -> bool:
        """
        Delete a snippet.

        :param session: Database session
        :param snippet: Snippet to delete
        :return: True if deleted successfully
        """
        session.delete(snippet)
        return True

    # --- Workflow Operations ---

    def get_draft_workflow(self, snippet: CustomizedSnippet) -> Workflow | None:
        """
        Get draft workflow for snippet.

        :param snippet: CustomizedSnippet instance
        :return: Draft Workflow or None
        """
        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                Workflow.type == WorkflowType.SNIPPET.value,
                Workflow.version == "draft",
            )
            .first()
        )
        return workflow

    def get_published_workflow(self, snippet: CustomizedSnippet) -> Workflow | None:
        """
        Get published workflow for snippet.

        :param snippet: CustomizedSnippet instance
        :return: Published Workflow or None
        """
        if not snippet.workflow_id:
            return None

        workflow = (
            db.session.query(Workflow)
            .where(
                Workflow.tenant_id == snippet.tenant_id,
                Workflow.app_id == snippet.id,
                Workflow.type == WorkflowType.SNIPPET.value,
                Workflow.id == snippet.workflow_id,
            )
            .first()
        )
        return workflow

    def sync_draft_workflow(
        self,
        *,
        snippet: CustomizedSnippet,
        graph: dict,
        unique_hash: str | None,
        account: Account,
        environment_variables: Sequence[VariableBase],
        conversation_variables: Sequence[VariableBase],
        input_variables: list[dict] | None = None,
    ) -> Workflow:
        """
        Sync draft workflow for snippet.

        :param snippet: CustomizedSnippet instance
        :param graph: Workflow graph configuration
        :param unique_hash: Hash for conflict detection
        :param account: Account making the change
        :param environment_variables: Environment variables
        :param conversation_variables: Conversation variables
        :param input_variables: Input variables for snippet
        :return: Synced Workflow
        :raises WorkflowHashNotEqualError: If hash mismatch
        """
        workflow = self.get_draft_workflow(snippet=snippet)

        if workflow and workflow.unique_hash != unique_hash:
            raise WorkflowHashNotEqualError()

        # Create draft workflow if not found
        if not workflow:
            workflow = Workflow(
                tenant_id=snippet.tenant_id,
                app_id=snippet.id,
                features="{}",
                type=WorkflowType.SNIPPET.value,
                version="draft",
                graph=json.dumps(graph),
                created_by=account.id,
                environment_variables=environment_variables,
                conversation_variables=conversation_variables,
            )
            db.session.add(workflow)
            db.session.flush()
        else:
            # Update existing draft workflow
            workflow.graph = json.dumps(graph)
            workflow.updated_by = account.id
            workflow.updated_at = datetime.now(UTC).replace(tzinfo=None)
            workflow.environment_variables = environment_variables
            workflow.conversation_variables = conversation_variables

        # Update snippet's input_fields if provided
        if input_variables is not None:
            snippet.input_fields = json.dumps(input_variables)
            snippet.updated_by = account.id
            snippet.updated_at = datetime.now(UTC).replace(tzinfo=None)

        db.session.commit()
        return workflow

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
            Workflow.type == WorkflowType.SNIPPET.value,
            Workflow.version == "draft",
        )
        draft_workflow = session.scalar(draft_workflow_stmt)
        if not draft_workflow:
            raise ValueError("No valid workflow found.")

        # Create new published workflow
        workflow = Workflow.new(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            type=draft_workflow.type,
            version=str(datetime.now(UTC).replace(tzinfo=None)),
            graph=draft_workflow.graph,
            features=draft_workflow.features,
            created_by=account.id,
            environment_variables=draft_workflow.environment_variables,
            conversation_variables=draft_workflow.conversation_variables,
            marked_name="",
            marked_comment="",
        )
        session.add(workflow)

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
                Workflow.type == WorkflowType.SNIPPET.value,
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
        node_type_enum = NodeType(node_type)

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
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get workflow run node execution list.

        :param snippet: CustomizedSnippet instance
        :param run_id: Workflow run ID
        :return: List of WorkflowNodeExecutionModel
        """
        workflow_run = self.get_snippet_workflow_run(snippet=snippet, run_id=run_id)
        if not workflow_run:
            return []

        node_executions = self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=snippet.tenant_id,
            app_id=snippet.id,
            workflow_run_id=workflow_run.id,
        )

        return node_executions

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
