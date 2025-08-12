import logging
from typing import Optional
from uuid import uuid4

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session
from typing import Union, TYPE_CHECKING

if TYPE_CHECKING:
    from flask_sqlalchemy import SQLAlchemy
    from flask_sqlalchemy.pagination import Pagination
    from sqlalchemy.orm import scoped_session

from models import Workflow, WorkflowAlias
from models.workflow_alias import AliasType

logger = logging.getLogger(__name__)


class WorkflowAliasService:

    def create_alias(
        self,
        session: Union[Session, "scoped_session"],
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        alias_name: str,
        alias_type: str = AliasType.CUSTOM.value,
        created_by: str | None = None,
    ) -> WorkflowAlias:
        workflow = session.get(Workflow, workflow_id)
        if not workflow:
            raise ValueError(f"Workflow {workflow_id} not found")

        if workflow.version == Workflow.VERSION_DRAFT:
            raise ValueError("Cannot create or transfer aliases for draft workflows")

        existing_alias = session.execute(
            select(WorkflowAlias).where(
                and_(
                    WorkflowAlias.app_id == app_id,
                    WorkflowAlias.alias_name == alias_name
                )
            )
        ).scalar_one_or_none()

        if existing_alias:
            old_workflow_id = existing_alias.workflow_id
            existing_alias.workflow_id = workflow_id
            existing_alias.updated_at = func.current_timestamp()

            setattr(existing_alias, '_is_transferred', True)
            setattr(existing_alias, '_old_workflow_id', old_workflow_id)

            logger.info(
                "Transferred alias '%s' from workflow %s to workflow %s",
                alias_name, old_workflow_id, workflow_id
            )
            return existing_alias

        alias = WorkflowAlias(
            id=str(uuid4()),
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            alias_name=alias_name,
            alias_type=alias_type,
            created_by=created_by,
        )

        session.add(alias)
        session.flush()

        logger.info(
            "Created workflow alias: %s for workflow %s",
            alias_name, workflow_id
        )
        return alias

    def get_alias_by_id(self, session: Union[Session, "scoped_session"], alias_id: str) -> Optional[WorkflowAlias]:
        return session.get(WorkflowAlias, alias_id)

    def get_aliases_by_workflow(
        self,
        session: Union[Session, "scoped_session"],
        tenant_id: str,
        app_id: str,
        workflow_id: str,
    ) -> list[WorkflowAlias]:
        stmt = select(WorkflowAlias).where(
            and_(
                WorkflowAlias.tenant_id == tenant_id,
                WorkflowAlias.app_id == app_id,
                WorkflowAlias.workflow_id == workflow_id
            )
        ).order_by(WorkflowAlias.created_at.desc())

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
                    WorkflowAlias.alias_name == alias_name
                )
            )
        ).scalar_one_or_none()

        if not alias:
            return None

        return session.get(Workflow, alias.workflow_id)

    def update_alias(
        self,
        session: Union[Session, "scoped_session"],
        alias_id: str,
        tenant_id: str,
        app_id: str,
        alias_name: Optional[str] = None,
    ) -> WorkflowAlias:
        alias = session.get(WorkflowAlias, alias_id)
        if not alias or alias.tenant_id != tenant_id or alias.app_id != app_id:
            raise ValueError("Alias not found")

        if alias_name:
            alias.alias_name = alias_name

        session.flush()
        return alias

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
        session.flush()
        return True



    def _validate_alias_name(self, alias_name: str) -> bool:
        if not alias_name or len(alias_name) > 255:
            return False

        import re
        pattern = r'^[a-zA-Z0-9_-]+$'
        return bool(re.match(pattern, alias_name))
