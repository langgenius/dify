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
    def create_or_update_alias(
        self,
        session: Union[Session, "scoped_session"],
        request: WorkflowAliasArgs,
    ) -> WorkflowNameAlias:
        workflow = session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot create or transfer aliases for draft workflows")

        existing_alias = session.scalar(
            select(WorkflowNameAlias).where(
                and_(WorkflowNameAlias.app_id == request.app_id, WorkflowNameAlias.name == request.name)
            )
        )

        if existing_alias:
            old_workflow_id = existing_alias.workflow_id
            existing_alias.workflow_id = request.workflow_id
            existing_alias.updated_at = func.current_timestamp()

            existing_alias._is_transferred = True  # type: ignore[reportPrivateUsage]
            existing_alias._old_workflow_id = old_workflow_id  # type: ignore[reportPrivateUsage]
            return existing_alias

        alias = WorkflowNameAlias(
            id=str(uuidv7()),
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            name=request.name,
            created_by=request.created_by,
        )

        session.add(alias)
        return alias

    def get_aliases_by_app(
        self,
        session: Union[Session, "scoped_session"],
        app_id: str,
        workflow_ids: list[str] | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Sequence[WorkflowNameAlias]:
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

        return list(session.scalars(stmt))

    def get_workflow_by_alias(
        self,
        session: Union[Session, "scoped_session"],
        app_id: str,
        name: str,
    ) -> Workflow | None:
        alias = session.scalar(
            select(WorkflowNameAlias).where(
                WorkflowNameAlias.app_id == app_id,
                WorkflowNameAlias.name == name,
            )
        )

        if not alias:
            return None

        return session.get(Workflow, alias.workflow_id)

    def delete_alias(
        self,
        session: Union[Session, "scoped_session"],
        alias_id: str,
        app_id: str,
    ) -> bool:
        alias = session.get(WorkflowNameAlias, alias_id)
        if not alias or alias.app_id != app_id:
            raise ValueError("Alias not found")

        session.delete(alias)
        return True
