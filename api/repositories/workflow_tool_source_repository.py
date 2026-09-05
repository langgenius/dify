from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from models.model import App
from models.workflow import Workflow


class SQLAlchemyWorkflowToolSourceRepository(WorkflowToolSourceRepository):
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    @override
    def get_source(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        version: str,
    ) -> WorkflowToolSource | None:
        stmt = (
            select(Workflow)
            .join(App, App.id == Workflow.app_id)
            .where(
                App.id == app_id,
                App.tenant_id == tenant_id,
                Workflow.id == workflow_id,
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == app_id,
                Workflow.version == version,
                Workflow.version != Workflow.VERSION_DRAFT,
            )
            .limit(1)
        )
        with self._session_maker() as session:
            workflow = session.scalar(stmt)
            if workflow is None:
                return None
            return WorkflowToolSource(
                app_id=workflow.app_id,
                workflow_id=workflow.id,
                graph_config=workflow.graph_dict,
                features_dict=workflow.features_dict,
                environment_variables=tuple(workflow.environment_variables),
                workflow_kind=workflow.kind_or_standard,
            )
