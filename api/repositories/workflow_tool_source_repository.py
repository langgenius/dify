from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.tools.workflow_as_tool.tool import WorkflowTool
from models.account import Account
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow


class SQLAlchemyWorkflowToolSourceRepository:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def get_by_provider_ids(self, *, tenant_id: str, provider_ids: Sequence[str]) -> Sequence[WorkflowToolSource]:
        if not provider_ids:
            return ()
        with self._session_maker() as session:
            rows = session.execute(
                select(Workflow, WorkflowToolProvider, Account.name)
                .join(App, App.id == Workflow.app_id)
                .join(
                    WorkflowToolProvider,
                    (WorkflowToolProvider.app_id == Workflow.app_id)
                    & (WorkflowToolProvider.version == Workflow.version),
                )
                .outerjoin(Account, Account.id == WorkflowToolProvider.user_id)
                .where(
                    App.tenant_id == tenant_id,
                    Workflow.tenant_id == tenant_id,
                    WorkflowToolProvider.tenant_id == tenant_id,
                    WorkflowToolProvider.id.in_(provider_ids),
                    Workflow.version != Workflow.VERSION_DRAFT,
                )
            )
            return tuple(
                self._materialize(
                    workflow,
                    tool=WorkflowToolProviderController.build_tool(provider, workflow, author=author or ""),
                )
                for workflow, provider, author in rows
            )

    @staticmethod
    def _materialize(workflow: Workflow, *, tool: WorkflowTool | None = None) -> WorkflowToolSource:
        return WorkflowToolSource(
            app_id=workflow.app_id,
            workflow_id=workflow.id,
            graph_config=workflow.graph_dict,
            features_dict=workflow.features_dict,
            environment_variables=tuple(workflow.environment_variables),
            workflow_kind=workflow.resolved_kind,
            tool=tool,
        )

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
            return self._materialize(workflow)
