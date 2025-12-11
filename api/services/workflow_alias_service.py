import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Union

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from libs.uuid_utils import uuidv7

if TYPE_CHECKING:
    from sqlalchemy.orm import scoped_session

from models import Workflow, WorkflowNameAlias


class WorkflowAliasArgs(BaseModel):
    app_id: str = Field(..., description="App ID")
    workflow_id: str = Field(..., description="Workflow ID")
    name: str = Field(..., description="Alias name", max_length=100)
    created_by: str | None = Field(default=None, description="User ID who created the alias")


logger = logging.getLogger(__name__)


class WorkflowAliasService:
    def __init__(self, session: Union[Session, "scoped_session"] | None = None):
        """
        Initialize WorkflowAliasService with optional database session.

        Args:
            session: Database session. If provided, will be used for all operations.
                    If None, session must be passed to each method call.
        """
        self._session = session

    def create_alias(
        self,
        request: WorkflowAliasArgs,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> WorkflowNameAlias:
        """
        Create a new workflow alias. Raises an error if alias already exists.
        """
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        workflow = db_session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot create aliases for draft workflows")

        # Check if alias already exists
        existing_alias = db_session.scalar(
            select(WorkflowNameAlias).where(
                and_(WorkflowNameAlias.app_id == request.app_id, WorkflowNameAlias.name == request.name)
            )
        )

        if existing_alias:
            raise ValueError(f"Alias '{request.name}' already exists for app {request.app_id}")

        alias = WorkflowNameAlias(
            id=str(uuidv7()),
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            name=request.name,
            created_by=request.created_by,
        )

        db_session.add(alias)
        return alias

    def update_alias(
        self,
        request: WorkflowAliasArgs,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> WorkflowNameAlias:
        """
        Update an existing workflow alias. Raises an error if alias doesn't exist.
        """
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        workflow = db_session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot update aliases for draft workflows")

        # Find existing alias to update
        existing_alias = db_session.scalar(
            select(WorkflowNameAlias).where(
                and_(WorkflowNameAlias.app_id == request.app_id, WorkflowNameAlias.name == request.name)
            )
        )

        if not existing_alias:
            raise ValueError(f"Alias '{request.name}' not found for app {request.app_id}")

        old_workflow_id = existing_alias.workflow_id
        existing_alias.workflow_id = request.workflow_id
        existing_alias.updated_at = func.current_timestamp()

        # Mark as transferred if workflow ID changed
        if old_workflow_id != request.workflow_id:
            existing_alias.is_transferred = True
            existing_alias.old_workflow_id = old_workflow_id

        return existing_alias

    def get_aliases_by_app(
        self,
        app_id: str,
        workflow_ids: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> Sequence[WorkflowNameAlias]:
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        conditions = [WorkflowNameAlias.app_id == app_id]

        if workflow_ids:
            conditions.append(WorkflowNameAlias.workflow_id.in_(workflow_ids))

        stmt = (
            select(WorkflowNameAlias)
            .where(and_(*conditions))
            .order_by(WorkflowNameAlias.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(db_session.scalars(stmt))

    def delete_alias(
        self,
        alias_id: str,
        app_id: str,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> bool:
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        alias = db_session.get(WorkflowNameAlias, alias_id)
        if not alias or alias.app_id != app_id:
            raise ValueError("Alias not found")

        db_session.delete(alias)
        return True
