import logging
import re
from typing import TYPE_CHECKING, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from sqlalchemy.orm import scoped_session

from models import Workflow, WorkflowAlias
from models.workflow_alias import AliasType


class CreateOrUpdateAliasRequest(BaseModel):
    """
    Pydantic model for create or update alias request parameters.
    """

    tenant_id: str = Field(..., description="Tenant ID")
    app_id: str = Field(..., description="App ID")
    workflow_id: str = Field(..., description="Workflow ID")
    alias_name: str = Field(..., description="Alias name", max_length=255)
    alias_type: str = Field(default=AliasType.CUSTOM, description="Alias type")
    created_by: Optional[str] = Field(default=None, description="User ID who created the alias")


logger = logging.getLogger(__name__)


class WorkflowAliasService:
    def create_or_update_alias(
        self,
        session: Union[Session, "scoped_session"],
        request: CreateOrUpdateAliasRequest,
    ) -> WorkflowAlias:
        self._validate_alias_name(request.alias_name)

        workflow = session.get(Workflow, request.workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {request.workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot create or transfer aliases for draft workflows")

        existing_alias = session.execute(
            select(WorkflowAlias).where(
                and_(WorkflowAlias.app_id == request.app_id, WorkflowAlias.alias_name == request.alias_name)
            )
        ).scalar_one_or_none()

        if existing_alias:
            old_workflow_id = existing_alias.workflow_id
            existing_alias.workflow_id = request.workflow_id
            existing_alias.updated_at = func.current_timestamp()

            existing_alias._is_transferred = True
            existing_alias._old_workflow_id = old_workflow_id
            return existing_alias

        alias = WorkflowAlias(
            id=str(uuid4()),
            tenant_id=request.tenant_id,
            app_id=request.app_id,
            workflow_id=request.workflow_id,
            alias_name=request.alias_name,
            alias_type=request.alias_type,
            created_by=request.created_by,
        )

        session.add(alias)
        session.flush()
        return alias

    def get_aliases_by_app(
        self,
        session: Union[Session, "scoped_session"],
        tenant_id: str,
        app_id: str,
        workflow_ids: Optional[list[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[WorkflowAlias]:
        conditions = [WorkflowAlias.tenant_id == tenant_id, WorkflowAlias.app_id == app_id]

        if workflow_ids:
            conditions.append(WorkflowAlias.workflow_id.in_(workflow_ids))

        stmt = (
            select(WorkflowAlias)
            .where(and_(*conditions))
            .order_by(WorkflowAlias.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        return list(session.execute(stmt).scalars().all())

    def get_workflow_by_alias(
        self,
        session: Union[Session, "scoped_session"],
        tenant_id: str,
        app_id: str,
        alias_name: str,
    ) -> Optional[Workflow]:
        alias = session.execute(
            select(WorkflowAlias).where(
                and_(
                    WorkflowAlias.tenant_id == tenant_id,
                    WorkflowAlias.app_id == app_id,
                    WorkflowAlias.alias_name == alias_name,
                )
            )
        ).scalar_one_or_none()

        if not alias:
            return None

        return session.get(Workflow, alias.workflow_id)

    def delete_alias(
        self,
        session: Union[Session, "scoped_session"],
        alias_id: str,
        tenant_id: str,
        app_id: str,
    ) -> bool:
        alias = session.get(WorkflowAlias, alias_id)
        if not alias or alias.tenant_id != tenant_id or alias.app_id != app_id:
            raise ValueError("Alias not found")

        session.delete(alias)
        return True

    def _validate_alias_name(self, alias_name: str) -> None:
        if not alias_name:
            raise ValueError("Alias name cannot be empty")

        if len(alias_name) > 100:
            raise ValueError("Alias name cannot exceed 100 characters")

        if len(alias_name) < 1:
            raise ValueError("Alias name must be at least 1 character long")

        if not re.match(r"^[a-zA-Z0-9_.-]+$", alias_name):
            raise ValueError("Alias name can only contain letters, numbers, hyphens, underscores, and dots")
