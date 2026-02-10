import time
import uuid
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.workflow.layers import PersistenceWorkflowInfo, WorkflowPersistenceLayer
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowType
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.in_memory_channel import InMemoryChannel
from core.workflow.graph_engine.graph_engine import GraphEngine
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserAction
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.nodes.human_input.human_input_node import HumanInputNode
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.repositories.human_input_form_repository import HumanInputFormEntity, HumanInputFormRepository
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now
from models import Account
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, IconType
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun


def _mock_form_repository_without_submission() -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    form_entity.rendered_content = "rendered"
    form_entity.submitted = False
    repo.create_form.return_value = form_entity
    repo.get_form.return_value = None
    return repo


def _mock_form_repository_with_submission(action_id: str) -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    form_entity = MagicMock(spec=HumanInputFormEntity)
    form_entity.id = "test-form-id"
    form_entity.web_app_token = "test-form-token"
    form_entity.recipients = []
    form_entity.rendered_content = "rendered"
    form_entity.submitted = True
    form_entity.selected_action_id = action_id
    form_entity.submitted_data = {}
    form_entity.status = HumanInputFormStatus.WAITING
    form_entity.expiration_time = naive_utc_now() + timedelta(hours=1)
    repo.get_form.return_value = form_entity
    return repo


def _build_runtime_state(workflow_execution_id: str, app_id: str, workflow_id: str, user_id: str) -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            workflow_execution_id=workflow_execution_id,
            app_id=app_id,
            workflow_id=workflow_id,
            user_id=user_id,
        ),
        user_inputs={},
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _build_graph(
    runtime_state: GraphRuntimeState,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    user_id: str,
    form_repository: HumanInputFormRepository,
) -> Graph:
    graph_config: dict[str, object] = {"nodes": [], "edges": []}
    params = GraphInitParams(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        graph_config=graph_config,
        user_id=user_id,
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    start_data = StartNodeData(title="start", variables=[])
    start_node = StartNode(
        id="start",
        config={"id": "start", "data": start_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    human_data = HumanInputNodeData(
        title="human",
        form_content="Awaiting human input",
        inputs=[],
        user_actions=[
            UserAction(id="continue", title="Continue"),
        ],
    )
    human_node = HumanInputNode(
        id="human",
        config={"id": "human", "data": human_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
        form_repository=form_repository,
    )

    end_data = EndNodeData(
        title="end",
        outputs=[],
        desc=None,
    )
    end_node = EndNode(
        id="end",
        config={"id": "end", "data": end_data.model_dump()},
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(human_node)
        .add_node(end_node, from_node_id="human", source_handle="continue")
        .build()
    )


def _build_generate_entity(
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    workflow_execution_id: str,
    user_id: str,
) -> WorkflowAppGenerateEntity:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id=tenant_id,
        app_id=app_id,
        app_mode=AppMode.WORKFLOW,
        workflow_id=workflow_id,
    )
    return WorkflowAppGenerateEntity(
        task_id=str(uuid.uuid4()),
        app_config=app_config,
        inputs={},
        files=[],
        user_id=user_id,
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id=workflow_execution_id,
    )


class TestHumanInputResumeNodeExecutionIntegration:
    @pytest.fixture(autouse=True)
    def setup_test_data(self, db_session_with_containers: Session):
        tenant = Tenant(
            name="Test Tenant",
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        account = Account(
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(tenant_join)
        db_session_with_containers.commit()

        account.current_tenant = tenant

        app = App(
            tenant_id=tenant.id,
            name="Test App",
            description="",
            mode=AppMode.WORKFLOW.value,
            icon_type=IconType.EMOJI.value,
            icon="rocket",
            icon_background="#4ECDC4",
            enable_site=False,
            enable_api=False,
            api_rpm=0,
            api_rph=0,
            is_demo=False,
            is_public=False,
            is_universal=False,
            max_active_requests=None,
            created_by=account.id,
            updated_by=account.id,
        )
        db_session_with_containers.add(app)
        db_session_with_containers.commit()

        workflow = Workflow(
            tenant_id=tenant.id,
            app_id=app.id,
            type="workflow",
            version="draft",
            graph='{"nodes": [], "edges": []}',
            features='{"file_upload": {"enabled": false}}',
            created_by=account.id,
            created_at=naive_utc_now(),
        )
        db_session_with_containers.add(workflow)
        db_session_with_containers.commit()

        self.session = db_session_with_containers
        self.tenant = tenant
        self.account = account
        self.app = app
        self.workflow = workflow

        yield

        self.session.execute(delete(WorkflowNodeExecutionModel))
        self.session.execute(delete(WorkflowRun))
        self.session.execute(delete(Workflow).where(Workflow.id == self.workflow.id))
        self.session.execute(delete(App).where(App.id == self.app.id))
        self.session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id == self.tenant.id))
        self.session.execute(delete(Account).where(Account.id == self.account.id))
        self.session.execute(delete(Tenant).where(Tenant.id == self.tenant.id))
        self.session.commit()

    def _build_persistence_layer(self, execution_id: str) -> WorkflowPersistenceLayer:
        generate_entity = _build_generate_entity(
            tenant_id=self.tenant.id,
            app_id=self.app.id,
            workflow_id=self.workflow.id,
            workflow_execution_id=execution_id,
            user_id=self.account.id,
        )
        execution_repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=self.session.get_bind(),
            user=self.account,
            app_id=self.app.id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )
        node_execution_repo = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=self.session.get_bind(),
            user=self.account,
            app_id=self.app.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        return WorkflowPersistenceLayer(
            application_generate_entity=generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=self.workflow.id,
                workflow_type=WorkflowType.WORKFLOW,
                version=self.workflow.version,
                graph_data=self.workflow.graph_dict,
            ),
            workflow_execution_repository=execution_repo,
            workflow_node_execution_repository=node_execution_repo,
        )

    def _run_graph(self, graph: Graph, runtime_state: GraphRuntimeState, execution_id: str) -> None:
        engine = GraphEngine(
            workflow_id=self.workflow.id,
            graph=graph,
            graph_runtime_state=runtime_state,
            command_channel=InMemoryChannel(),
        )
        engine.layer(self._build_persistence_layer(execution_id))
        for _ in engine.run():
            continue

    def test_resume_human_input_does_not_create_duplicate_node_execution(self):
        execution_id = str(uuid.uuid4())
        runtime_state = _build_runtime_state(
            workflow_execution_id=execution_id,
            app_id=self.app.id,
            workflow_id=self.workflow.id,
            user_id=self.account.id,
        )
        pause_repo = _mock_form_repository_without_submission()
        paused_graph = _build_graph(
            runtime_state,
            self.tenant.id,
            self.app.id,
            self.workflow.id,
            self.account.id,
            pause_repo,
        )
        self._run_graph(paused_graph, runtime_state, execution_id)

        snapshot = runtime_state.dumps()
        resumed_state = GraphRuntimeState.from_snapshot(snapshot)
        resume_repo = _mock_form_repository_with_submission(action_id="continue")
        resumed_graph = _build_graph(
            resumed_state,
            self.tenant.id,
            self.app.id,
            self.workflow.id,
            self.account.id,
            resume_repo,
        )
        self._run_graph(resumed_graph, resumed_state, execution_id)

        stmt = select(WorkflowNodeExecutionModel).where(
            WorkflowNodeExecutionModel.workflow_run_id == execution_id,
            WorkflowNodeExecutionModel.node_id == "human",
        )
        records = self.session.execute(stmt).scalars().all()
        assert len(records) == 1
        assert records[0].status != "paused"
        assert records[0].triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        assert records[0].created_by_role == CreatorUserRole.ACCOUNT
