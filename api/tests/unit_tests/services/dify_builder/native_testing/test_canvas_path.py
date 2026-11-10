"""The actual Graphon path survives a pause and a fresh engine on the same Run."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.dify_builder.models import Actor
from core.repositories.human_input_repository import HumanInputFormRepositoryImpl
from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.system_variables import build_system_variables
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import GraphEdgeSkippedEvent, GraphRunPausedEvent, GraphRunSucceededEvent
from graphon.graph import Graph
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.human_input.entities import HumanInputNodeData as GraphonHumanInputNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import RuntimeState, VariablePool
from libs.datetime_utils import naive_utc_now
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeTestScope
from models.human_input import HumanInputForm
from runtime_contracts.builder.execution import canonical_digest
from runtime_contracts.builder.native.canvas_path import NativeCanvasPath
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder.native_testing import canvas_path
from tests.workflow_test_utils import build_test_graph_init_params


@pytest.mark.parametrize("branch", [False, True], ids=["linear", "two-ports-one-target"])
def test_native_path_accumulates_across_graphon_resume(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, branch: bool
) -> None:
    """Verify SQL snapshots from the real scheduler, including a skipped parallel edge."""
    tenant_id, account_id, app_id, workflow_id, run_id, session_id = (str(uuid4()) for _ in range(6))
    actor = Actor(account_id=account_id, tenant_id=tenant_id)
    context = {"policy_version": "builder-native-test-v1", "native_run_id": run_id}
    ref = NativeTestContextRef(request_id=str(uuid4()), invocation_id="root", context_digest=canonical_digest(context))
    with sqlite_session_factory.begin() as sql:
        sql.add(
            DifyBuilderExecutionRequest(
                id=ref.request_id,
                tenant_id=tenant_id,
                actor_id=account_id,
                app_id=app_id,
                workflow_id=workflow_id,
                session_id=session_id,
                test_input_id=str(uuid4()),
                context=context,
                context_digest=ref.context_digest,
                state="running",
            )
        )
        sql.add(
            NativeTestScope(
                tenant_id=tenant_id,
                request_id=ref.request_id,
                generation=0,
                task_approved=True,
                cancelled=False,
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
                budget_limits={},
                budget_spent={},
                profile={},
                max_calls=1,
                max_dispatches=1,
                max_cost_units=1,
            )
        )

    def saved_path() -> NativeCanvasPath:
        with sqlite_session_factory() as sql:
            request = sql.get(DifyBuilderExecutionRequest, ref.request_id)
            assert request is not None
            path = canvas_path.read_canvas_path(request.canvas_path, run_id)
            assert path is not None
            return path

    observed: list[NativeCanvasPath] = []
    monkeypatch.setattr(canvas_path, "publish_native_change", lambda _session_id: observed.append(saved_path()))
    forms = HumanInputFormRepositoryImpl(tenant_id=tenant_id, app_id=app_id, workflow_execution_id=run_id)
    params = build_test_graph_init_params(
        workflow_id=workflow_id,
        graph_config={"nodes": [], "edges": []},
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    human_data = HumanInputNodeData(
        title="Approval",
        form_content="Approve the synthetic run",
        inputs=[],
        user_actions=[UserActionConfig(id="approve", title="Approve")]
        + ([UserActionConfig(id="alternate", title="Alternate")] if branch else []),
    )

    def engine(state: RuntimeState) -> Engine:
        start = StartNode(
            node_id="start",
            data=StartNodeData(title="START", variables=[]),
            init_params=params,
            runtime_state=state,
        )
        approval = HumanInputNode(
            node_id="approval",
            data=GraphonHumanInputNodeData.model_validate(human_data.model_dump()),
            init_params=params,
            runtime_state=state,
            hitl_callback=DifyHITLCallback(form_repository=forms, node_data=human_data),
        )
        output = EndNode(
            node_id="output",
            data=EndNodeData(title="OUTPUT", outputs=[]),
            init_params=params,
            runtime_state=state,
        )
        builder = Graph.new().add_root(start).add_node(approval).add_node(output, source_handle="approve")
        if branch:
            builder.connect(tail="approval", head="output", source_handle="alternate")
        graph = builder.build()
        instance = Engine(graph=graph, runtime_state=state, command_channel=InMemoryChannel())
        instance.add_layer(
            canvas_path.NativeCanvasPathLayer(
                sessions=sqlite_session_factory,
                ref=ref,
                actor=actor,
                app_id=app_id,
                workflow_id=workflow_id,
                run_id=run_id,
                graph={
                    "nodes": [{"id": node_id} for node_id in graph.nodes],
                    "edges": [
                        {"id": edge.id, "source": edge.tail, "target": edge.head, "sourceHandle": edge.source_handle}
                        for edge in graph.edges.values()
                    ],
                },
            )
        )
        return instance

    variables = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            workflow_execution_id=run_id,
            app_id=app_id,
            workflow_id=workflow_id,
            user_id=account_id,
        ),
        user_inputs={},
        conversation_variables=[],
    )
    initial = RuntimeState(workflow_id=workflow_id, variable_pool=variables, start_at=0.0)
    first = list(engine(initial).run())
    assert any(isinstance(event, GraphRunPausedEvent) for event in first)
    paused = saved_path()
    assert [(edge.edge_id, edge.source_status, edge.target_status) for edge in paused.edges] == [
        ("edge_0", "succeeded", "paused")
    ]

    with sqlite_session_factory.begin() as sql:
        form = sql.scalar(select(HumanInputForm).where(HumanInputForm.workflow_run_id == run_id))
        scope = sql.get(NativeTestScope, ref.request_id)
        assert form is not None
        assert scope is not None
        form.selected_action_id = "approve"
        form.submitted_data = "{}"
        form.submitted_at = naive_utc_now()
        form.status = HumanInputFormStatus.SUBMITTED
        scope.generation += 1

    second = list(engine(RuntimeState.from_snapshot(initial.dumps())).run())
    assert any(isinstance(event, GraphRunSucceededEvent) for event in second)
    assert {event.edge_id for event in second if isinstance(event, GraphEdgeSkippedEvent)} == (
        {"edge_2"} if branch else set()
    )
    completed = saved_path()
    assert completed.revision > paused.revision
    assert [(edge.edge_id, edge.source_status, edge.target_status) for edge in completed.edges] == [
        ("edge_0", "succeeded", "succeeded"),
        ("edge_1", "succeeded", "succeeded"),
    ]
    assert any(
        edge.edge_id == "edge_1" and edge.target_status == "running" for snapshot in observed for edge in snapshot.edges
    )
