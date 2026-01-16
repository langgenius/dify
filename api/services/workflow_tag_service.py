import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Union

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from libs.uuid_utils import uuidv7

if TYPE_CHECKING:
    from sqlalchemy.orm import scoped_session

from models import Workflow, WorkflowNameTag


class WorkflowTagArgs(BaseModel):
    app_id: str = Field(..., description="App ID")
    workflow_id: str = Field(..., description="Workflow ID")
    name: str = Field(..., description="Tag name", max_length=100)
    created_by: str | None = Field(default=None, description="User ID who created the tag")


logger = logging.getLogger(__name__)


class WorkflowTagService:
    def __init__(self, session: Union[Session, "scoped_session"] | None = None):
        """
        Initialize WorkflowTagService with optional database session.

        Args:
            session: Database session. If provided, will be used for all operations.
                    If None, session must be passed to each method call.
        """
        self._session = session

    def create_tag(
        self,
        request: WorkflowTagArgs,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> WorkflowNameTag:
        """
        Create a new workflow tag. Raises an error if tag already exists.
        """
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        workflow = db_session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot create tags for draft workflows")

        # Check if tag already exists
        existing_tag = db_session.scalar(
            select(WorkflowNameTag).where(
                and_(WorkflowNameTag.app_id == request.app_id, WorkflowNameTag.name == request.name)
            )
        )

        if existing_tag:
            raise ValueError(f"Tag '{request.name}' already exists for app {request.app_id}")

        tag = WorkflowNameTag(
            id=str(uuidv7()),
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            name=request.name,
            created_by=request.created_by,
        )

        db_session.add(tag)
        return tag

    def update_tag(
        self,
        request: WorkflowTagArgs,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> WorkflowNameTag:
        """
        Update an existing workflow tag. Raises an error if tag doesn't exist.
        """
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        workflow = db_session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot update tags for draft workflows")

        # Find existing tag to update
        existing_tag = db_session.scalar(
            select(WorkflowNameTag).where(
                and_(WorkflowNameTag.app_id == request.app_id, WorkflowNameTag.name == request.name)
            )
        )

        if not existing_tag:
            raise ValueError(f"Tag '{request.name}' not found for app {request.app_id}")

        old_workflow_id = existing_tag.workflow_id
        existing_tag.workflow_id = request.workflow_id
        existing_tag.updated_at = func.current_timestamp()

        # Mark as transferred if workflow ID changed
        if old_workflow_id != request.workflow_id:
            existing_tag.is_transferred = True
            existing_tag.old_workflow_id = old_workflow_id

        return existing_tag

    def get_tags_by_app(
        self,
        app_id: str,
        workflow_ids: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> Sequence[WorkflowNameTag]:
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        conditions = [WorkflowNameTag.app_id == app_id]

        if workflow_ids:
            conditions.append(WorkflowNameTag.workflow_id.in_(workflow_ids))

        stmt = (
            select(WorkflowNameTag)
            .where(and_(*conditions))
            .order_by(WorkflowNameTag.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(db_session.scalars(stmt))

    def delete_tag(
        self,
        tag_id: str,
        app_id: str,
        session: Union[Session, "scoped_session"] | None = None,
    ) -> bool:
        # Use instance session if provided, otherwise use method parameter
        db_session = self._session or session
        if not db_session:
            raise ValueError("Database session is required")

        tag = db_session.get(WorkflowNameTag, tag_id)
        if not tag or tag.app_id != app_id:
            raise ValueError("Tag not found")

        db_session.delete(tag)
        return True