from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.tools.workflow_as_tool.repository import WorkflowToolSource
from models.account import Account
from models.model import App
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.workflow.provider import WorkflowToolProviderController
from services.tools.workflow.tool import WorkflowTool
from services.workflow.execution.ports import WorkflowRuntime


class SQLAlchemyWorkflowToolSourceRepository:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        workflow_runtime: WorkflowRuntime | None,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None,
    ) -> None:
        self._session_maker = session_maker
        self._workflow_runtime = workflow_runtime
        self._draft_variable_saver = draft_variable_saver

    def get_by_provider_ids(self, *, tenant_id: str, provider_ids: Sequence[str]) -> Sequence[WorkflowToolSource]:
        if not provider_ids:
            return ()
        with self._session_maker() as session:
            rows = tuple(
                session.execute(
                    select(Workflow, WorkflowToolProvider)
                    .join(App, App.id == Workflow.app_id)
                    .join(
                        WorkflowToolProvider,
                        (WorkflowToolProvider.app_id == Workflow.app_id)
                        & (WorkflowToolProvider.version == Workflow.version),
                    )
                    .where(
                        App.tenant_id == tenant_id,
                        Workflow.tenant_id == tenant_id,
                        WorkflowToolProvider.tenant_id == tenant_id,
                        WorkflowToolProvider.id.in_(provider_ids),
                        Workflow.version != Workflow.VERSION_DRAFT,
                    )
                )
            )
        return tuple(
            self._materialize(
                workflow,
                tool=self._build_tool(provider),
            )
            for workflow, provider in rows
        )

    def _build_tool(self, provider: WorkflowToolProvider) -> WorkflowTool:
        runtime = self._workflow_runtime
        if runtime is None:
            raise ValueError("Workflow execution dependencies are required to materialize Workflow Tools")
        controller = WorkflowToolProviderController.from_db(
            provider,
            queries=runtime.tools,
            draft_variable_saver=self._draft_variable_saver,
            workflow_runtime=runtime,
        )
        tools = controller.get_tools(provider.tenant_id)
        if len(tools) != 1:
            raise ValueError(f"Workflow Tool provider {provider.id} did not materialize exactly one tool")
        return tools[0]

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
