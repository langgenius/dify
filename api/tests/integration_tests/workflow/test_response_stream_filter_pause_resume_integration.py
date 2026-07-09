"""Regression test: if-else branch + human_input pause + downstream answer nodes.

Reproduces https://github.com/langgenius/dify/issues/38525 at the
iter_dify_graph_engine_events layer: without a restored ResponseStreamFilter,
answer nodes downstream of a pre-pause branch never unlock for streaming on
resume, even though the graph executes correctly.
"""

from datetime import timedelta
from unittest.mock import MagicMock

from core.workflow.nodes.human_input.callback import DifyHITLCallback
from core.workflow.nodes.human_input.entities import HumanInputNodeData, UserActionConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.repositories.human_input_repository import HumanInputFormEntity, HumanInputFormRepository
from core.workflow.system_variables import build_system_variables
from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.filters import GraphEventFilterContext, ResponseStreamFilter, filter_graph_events
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphRunPausedEvent, GraphRunSucceededEvent, NodeRunStreamChunkEvent
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.human_input.human_input_node import HumanInputNode
from graphon.nodes.if_else.entities import IfElseNodeData
from graphon.nodes.if_else.if_else_node import IfElseNode
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.utils.condition.entities import Condition
from libs.datetime_utils import naive_utc_now
from tests.workflow_test_utils import build_test_graph_init_params

WORKFLOW_EXECUTION_ID = "wf-exec-38525"


def _mock_repo_paused() -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    form = MagicMock(spec=HumanInputFormEntity)
    form.id = "form-1"
    form.submission_token = "token-1"
    form.recipients = []
    form.rendered_content = "rendered"
    form.submitted = False
    repo.create_form.return_value = form
    repo.get_form.return_value = None
    return repo


def _mock_repo_resumed(action_id: str = "continue") -> HumanInputFormRepository:
    repo = MagicMock(spec=HumanInputFormRepository)
    form = MagicMock(spec=HumanInputFormEntity)
    form.id = "form-1"
    form.submission_token = "token-1"
    form.recipients = []
    form.rendered_content = "rendered"
    form.submitted = True
    form.selected_action_id = action_id
    form.submitted_data = {}
    form.status = HumanInputFormStatus.WAITING
    form.expiration_time = naive_utc_now() + timedelta(hours=1)
    repo.get_form.return_value = form
    return repo


def _build_graph(runtime_state: GraphRuntimeState, form_repository: HumanInputFormRepository) -> Graph:
    params = build_test_graph_init_params(
        workflow_id="wf",
        graph_config={"nodes": [], "edges": []},
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )

    start_node = StartNode(
        node_id="start",
        data=StartNodeData(title="start", variables=[]),
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    if_else_node = IfElseNode(
        node_id="if_else",
        data=IfElseNodeData(
            title="if-else",
            cases=[
                IfElseNodeData.Case(
                    case_id="true",
                    logical_operator="and",
                    conditions=[
                        Condition(
                            variable_selector=["start", "category"],
                            comparison_operator="is",
                            value="fruit",
                        )
                    ],
                )
            ],
        ),
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    human_data = HumanInputNodeData(
        title="human",
        form_content="Awaiting human input",
        inputs=[],
        user_actions=[UserActionConfig(id="continue", title="Continue")],
    )
    human_node = HumanInputNode(
        node_id="human_input",
        data=human_data,
        graph_init_params=params,
        graph_runtime_state=runtime_state,
        hitl_callback=DifyHITLCallback(form_repository=form_repository, node_data=human_data),
    )

    answer_false_node = AnswerNode(
        node_id="answer_false",
        data=AnswerNodeData(title="answer_false", answer="unreachable branch"),
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    answer_after_pause = AnswerNode(
        node_id="answer_after_pause",
        data=AnswerNodeData(title="answer_after_pause", answer="Post-branch answer chunk 1"),
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    answer_after_pause_2 = AnswerNode(
        node_id="answer_after_pause_2",
        data=AnswerNodeData(title="answer_after_pause_2", answer="Post-branch answer chunk 2"),
        graph_init_params=params,
        graph_runtime_state=runtime_state,
    )

    return (
        Graph.new()
        .add_root(start_node)
        .add_node(if_else_node, from_node_id="start")
        .add_node(human_node, from_node_id="if_else", source_handle="true")
        .add_node(answer_false_node, from_node_id="if_else", source_handle="false")
        .add_node(answer_after_pause, from_node_id="human_input", source_handle="continue")
        .add_node(answer_after_pause_2, from_node_id="answer_after_pause")
        .build()
    )


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(
            workflow_execution_id=WORKFLOW_EXECUTION_ID,
            app_id="app",
            workflow_id="wf",
            user_id="user",
        ),
        user_inputs={},
        conversation_variables=[],
    )
    variable_pool.add(("start", "category"), "fruit")  # drives the if-else "true" branch
    return GraphRuntimeState(variable_pool=variable_pool, start_at=0.0)


def test_if_else_human_input_pause_resume_answer_chunks_survive_resume() -> None:
    # ---- Phase 1: run to GraphRunPausedEvent ----
    runtime_state_1 = _build_runtime_state()
    graph_1 = _build_graph(runtime_state_1, _mock_repo_paused())
    engine_1 = GraphEngine(
        workflow_id="wf",
        graph=graph_1,
        graph_runtime_state=runtime_state_1,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    filter_1 = ResponseStreamFilter()
    phase1_events = list(
        filter_graph_events(
            engine_1.run(),
            context=GraphEventFilterContext.from_engine(engine_1),
            filters=[filter_1],
        )
    )

    assert any(isinstance(e, GraphRunPausedEvent) for e in phase1_events)
    phase1_chunks = [e for e in phase1_events if isinstance(e, NodeRunStreamChunkEvent)]
    assert not any(e.node_id in ("answer_after_pause", "answer_after_pause_2") for e in phase1_chunks)

    response_filter_snapshot = filter_1.dumps()
    runtime_snapshot = runtime_state_1.dumps()

    # ---- Phase 2: rebuild engine + filter from snapshots, resume to completion ----
    runtime_state_2 = GraphRuntimeState.from_snapshot(runtime_snapshot)
    graph_2 = _build_graph(runtime_state_2, _mock_repo_resumed(action_id="continue"))
    engine_2 = GraphEngine(
        workflow_id="wf",
        graph=graph_2,
        graph_runtime_state=runtime_state_2,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    filter_2 = ResponseStreamFilter()
    filter_2.loads(response_filter_snapshot)

    phase2_events = list(iter_dify_graph_engine_events(engine_2, filter_2))

    assert any(isinstance(e, GraphRunSucceededEvent) for e in phase2_events)

    phase2_chunks = [e for e in phase2_events if isinstance(e, NodeRunStreamChunkEvent)]
    answer_1_chunks = [e for e in phase2_chunks if e.node_id == "answer_after_pause"]
    answer_2_chunks = [e for e in phase2_chunks if e.node_id == "answer_after_pause_2"]

    assert answer_1_chunks, "answer_after_pause produced no stream chunks after resume"
    assert answer_2_chunks, "answer_after_pause_2 produced no stream chunks after resume"
