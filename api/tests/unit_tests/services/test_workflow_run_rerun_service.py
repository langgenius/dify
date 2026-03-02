import json
from collections.abc import Mapping
from datetime import datetime
from types import SimpleNamespace
from typing import Any

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from dify_graph.entities.workflow_execution import WorkflowRunRerunScope
from dify_graph.runtime import VariablePool
from dify_graph.system_variable import SystemVariable
from models import Account, EndUser
from services.workflow_run_rerun_service import (
    WorkflowRunRerunOverride,
    WorkflowRunRerunService,
    WorkflowRunRerunServiceError,
)


def _new_service() -> WorkflowRunRerunService:
    service = WorkflowRunRerunService.__new__(WorkflowRunRerunService)
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: None
    )
    service._sql_workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **kwargs: service._workflow_run_repo.get_workflow_run_by_id(**kwargs)
    )
    return service


def _build_variable_pool() -> VariablePool:
    return VariablePool(
        system_variables=SystemVariable.default(),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )


class _DummySessionFactory:
    def __call__(self):
        return self

    def __enter__(self):
        return object()

    def __exit__(self, exc_type, exc, tb):
        return None


class _FakeNodeExecution:
    def __init__(
        self,
        node_id: str,
        outputs: Mapping[str, Any],
        *,
        created_at: datetime | None = None,
        index: int = 0,
        execution_id: str | None = None,
    ):
        self.node_id = node_id
        self._outputs = outputs
        self.created_at = created_at
        self.index = index
        self.id = execution_id or f"execution_{node_id}_{index}"

    def load_full_outputs(self, *, session: object, storage: object) -> Mapping[str, Any]:
        return self._outputs


def _build_source_run(**kwargs: Any) -> SimpleNamespace:
    graph = kwargs.pop(
        "graph_dict",
        {
            "nodes": [
                {"id": "start", "data": {"type": "start"}},
                {"id": "target", "data": {"type": "llm"}},
            ],
            "edges": [{"source": "start", "target": "target"}],
        },
    )
    return SimpleNamespace(
        id=kwargs.pop("id", "run_1"),
        type=kwargs.pop("type", "workflow"),
        status=kwargs.pop("status", "succeeded"),
        workflow_id=kwargs.pop("workflow_id", "wf_1"),
        rerun_chain_root_workflow_run_id=kwargs.pop("rerun_chain_root_workflow_run_id", None),
        graph_dict=graph,
        inputs_dict=kwargs.pop("inputs_dict", {}),
        **kwargs,
    )


def test_apply_overrides_patch_nested_path() -> None:
    service = _new_service()
    variable_pool = _build_variable_pool()
    variable_pool.add(["node_a", "output"], {"nested": {"value": "old"}})

    service._apply_overrides(
        variable_pool=variable_pool,
        overrides=[
            WorkflowRunRerunOverride(
                selector=["node_a", "output", "nested", "value"],
                value="new",
            )
        ],
        ancestors=["node_a"],
    )

    segment = variable_pool.get(["node_a", "output", "nested", "value"])
    assert segment is not None
    assert segment.value == "new"


def test_apply_overrides_raises_for_missing_path() -> None:
    service = _new_service()
    variable_pool = _build_variable_pool()
    variable_pool.add(["node_a", "output"], {"nested": {"value": "old"}})

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._apply_overrides(
            variable_pool=variable_pool,
            overrides=[
                WorkflowRunRerunOverride(
                    selector=["node_a", "output", "nested", "missing"],
                    value="new",
                )
            ],
            ancestors=["node_a"],
        )

    assert exc_info.value.code == "override_selector_invalid"
    assert exc_info.value.status == 422


def test_apply_overrides_raises_for_type_mismatch() -> None:
    service = _new_service()
    variable_pool = _build_variable_pool()
    variable_pool.add(["node_a", "output"], "plain-text")

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._apply_overrides(
            variable_pool=variable_pool,
            overrides=[
                WorkflowRunRerunOverride(
                    selector=["node_a", "output", "nested"],
                    value="new",
                )
            ],
            ancestors=["node_a"],
        )

    assert exc_info.value.code == "override_type_mismatch"
    assert exc_info.value.status == 422


def test_analyze_main_flow_scope() -> None:
    service = _new_service()
    descendants, ancestors = service._analyze_main_flow_scope(
        target_node_id="node_b",
        edges=[
            {"source": "node_a", "target": "node_b"},
            {"source": "node_b", "target": "node_c"},
            {"source": "node_a", "target": "node_d"},
        ],
        main_node_ids=["node_a", "node_b", "node_c", "node_d"],
        main_node_id_set={"node_a", "node_b", "node_c", "node_d"},
    )

    assert descendants == ["node_b", "node_c"]
    assert ancestors == ["node_a"]


def test_expand_container_internal_nodes_include_start_node() -> None:
    service = _new_service()
    nodes = [
        {"id": "loop_1", "data": {"type": "loop"}},
        {"id": "loop_start_1", "data": {"type": "loop-start"}},
        {"id": "loop_inner_1", "data": {"type": "llm", "loop_id": "loop_1"}},
    ]
    nodes_by_id = {node["id"]: node for node in nodes}
    nodes_by_id["loop_1"]["data"]["start_node_id"] = "loop_start_1"

    rerun_node_id_set = {"loop_1"}
    service._expand_container_internal_nodes(
        rerun_node_id_set=rerun_node_id_set,
        nodes_by_id=nodes_by_id,
        all_nodes=nodes,
    )

    assert rerun_node_id_set == {"loop_1", "loop_start_1", "loop_inner_1"}


def test_build_plan_rejects_internal_target_node(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: SimpleNamespace(
            id="run_1",
            type="workflow",
            status="succeeded",
            workflow_id="wf_1",
            rerun_chain_root_workflow_run_id=None,
            graph_dict={
                "nodes": [
                    {"id": "start", "data": {"type": "start"}},
                    {"id": "inner_node", "data": {"type": "llm", "isInLoop": True}},
                ],
                "edges": [{"source": "start", "target": "inner_node"}],
            },
            inputs_dict={},
        )
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = SimpleNamespace()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: None)
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._build_plan_or_raise(
            app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
            source_run_id="run_1",
            target_node_id="inner_node",
            overrides=[],
        )

    assert exc_info.value.code == "unsupported_target_node_scope"
    assert exc_info.value.status == 422


def test_build_plan_fallbacks_to_sql_graph_when_source_graph_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: _build_source_run(
            graph_dict={}
        )
    )
    service._sql_workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: _build_source_run(
            graph_dict={
                "nodes": [
                    {"id": "start", "data": {"type": "start"}},
                    {"id": "target_sql", "data": {"type": "llm"}},
                ],
                "edges": [{"source": "start", "target": "target_sql"}],
            }
        )
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="run_1",
        target_node_id="target_sql",
        overrides=[],
    )

    assert plan.target_node_id == "target_sql"
    assert "target_sql" in plan.scope.rerun_node_ids


def test_build_plan_uses_source_graph_when_sql_graph_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: _build_source_run()
    )
    service._sql_workflow_run_repo = SimpleNamespace(get_workflow_run_by_id=lambda **_: None)  # type: ignore[attr-defined]
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="run_1",
        target_node_id="target",
        overrides=[],
    )

    assert plan.target_node_id == "target"
    assert "target" in plan.scope.rerun_node_ids


def test_build_plan_rejects_unsupported_app_mode() -> None:
    service = _new_service()

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._build_plan_or_raise(
            app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="advanced-chat"),
            source_run_id="run_1",
            target_node_id="target",
            overrides=[],
        )

    assert exc_info.value.code == "unsupported_app_mode"
    assert exc_info.value.status == 422


def test_build_plan_rejects_source_run_not_ended(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: _build_source_run(status="running")
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: None)
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._build_plan_or_raise(
            app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
            source_run_id="run_1",
            target_node_id="target",
            overrides=[],
        )

    assert exc_info.value.code == "workflow_run_not_ended"
    assert exc_info.value.status == 409


def test_build_plan_rejects_non_workflow_source_run(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: _build_source_run(type="chat")
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: None)
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._build_plan_or_raise(
            app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
            source_run_id="run_1",
            target_node_id="target",
            overrides=[],
        )

    assert exc_info.value.code == "unsupported_app_mode"
    assert exc_info.value.status == 422


def test_build_plan_sets_rerun_chain_root(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    source_run = _build_source_run(id="source_1", rerun_chain_root_workflow_run_id="root_1")
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: source_run
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="source_1",
        target_node_id="target",
        overrides=[],
    )

    assert plan.rerun_metadata.rerun_chain_root_workflow_run_id == "root_1"


def test_build_plan_uses_source_as_chain_root_for_normal_run(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    source_run = _build_source_run(id="source_1", rerun_chain_root_workflow_run_id=None)
    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=lambda **_: source_run
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="source_1",
        target_node_id="target",
        overrides=[],
    )

    assert plan.rerun_metadata.rerun_chain_root_workflow_run_id == "source_1"


def test_build_plan_resolves_chain_root_from_parent_when_source_chain_root_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _new_service()
    source_run = _build_source_run(
        id="source_2",
        rerun_chain_root_workflow_run_id=None,
        rerun_from_workflow_run_id="source_1",
    )
    parent_run = _build_source_run(
        id="source_1",
        rerun_chain_root_workflow_run_id="root_1",
        rerun_from_workflow_run_id="root_1",
    )

    def _get_workflow_run_by_id(**kwargs: Any) -> SimpleNamespace | None:
        run_id = kwargs.get("run_id")
        if run_id == "source_2":
            return source_run
        if run_id == "source_1":
            return parent_run
        return None

    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=_get_workflow_run_by_id
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="source_2",
        target_node_id="target",
        overrides=[],
    )

    assert plan.rerun_metadata.rerun_chain_root_workflow_run_id == "root_1"


def test_build_plan_uses_parent_id_when_chain_root_missing_and_parent_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _new_service()
    source_run = _build_source_run(
        id="source_2",
        rerun_chain_root_workflow_run_id=None,
        rerun_from_workflow_run_id="source_1",
    )

    def _get_workflow_run_by_id(**kwargs: Any) -> SimpleNamespace | None:
        run_id = kwargs.get("run_id")
        if run_id == "source_2":
            return source_run
        return None

    service._workflow_run_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_workflow_run_by_id=_get_workflow_run_by_id
    )
    service._node_execution_repo = SimpleNamespace()  # type: ignore[attr-defined]
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    monkeypatch.setattr(service, "_load_workflow", lambda **_: SimpleNamespace(environment_variables=[]))
    monkeypatch.setattr(service, "_rebuild_variable_pool", lambda **_: ({}, _build_variable_pool()))

    plan = service._build_plan_or_raise(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        source_run_id="source_2",
        target_node_id="target",
        overrides=[],
    )

    assert plan.rerun_metadata.rerun_chain_root_workflow_run_id == "source_1"


def test_rebuild_variable_pool_drops_conversation_id_and_clears_all_rerun_nodes() -> None:
    service = _new_service()
    service._node_execution_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_executions_by_workflow_run=lambda **_: [
            _FakeNodeExecution("target", {"out": "old-target"}),
            _FakeNodeExecution("container_inner", {"out": "old-inner"}),
            _FakeNodeExecution("ancestor", {"out": "ancestor-old"}),
        ]
    )
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    user_inputs, variable_pool = service._rebuild_variable_pool(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1"),
        workflow=SimpleNamespace(environment_variables=[]),
        source_run=_build_source_run(
            id="source_1",
            inputs_dict={
                "foo": "bar",
                "sys.workflow_run_id": "old-run",
                "sys.timestamp": 123,
                "sys.conversation_id": "c-1",
            },
        ),
        workflow_run_id="new-run",
        rerun_node_ids=["target", "container_inner"],
        overrides=[WorkflowRunRerunOverride(selector=["ancestor", "out"], value="patched")],
        ancestors=["ancestor"],
    )

    assert user_inputs == {"foo": "bar"}
    assert variable_pool.system_variables.workflow_execution_id == "new-run"
    assert variable_pool.system_variables.conversation_id is None
    assert variable_pool.get(["target", "out"]) is None
    assert variable_pool.get(["container_inner", "out"]) is None
    ancestor_segment = variable_pool.get(["ancestor", "out"])
    assert ancestor_segment is not None
    assert ancestor_segment.value == "patched"


def test_rebuild_variable_pool_replays_node_outputs_by_created_at_asc() -> None:
    service = _new_service()
    service._node_execution_repo = SimpleNamespace(  # type: ignore[attr-defined]
        get_executions_by_workflow_run=lambda **_: [
            _FakeNodeExecution(
                "node_a",
                {"output": "new"},
                created_at=datetime(2026, 3, 1, 0, 0, 2),
                index=2,
                execution_id="exec_new",
            ),
            _FakeNodeExecution(
                "node_a",
                {"output": "old"},
                created_at=datetime(2026, 3, 1, 0, 0, 1),
                index=1,
                execution_id="exec_old",
            ),
        ]
    )
    service._session_factory = _DummySessionFactory()  # type: ignore[attr-defined]

    _, variable_pool = service._rebuild_variable_pool(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1"),
        workflow=SimpleNamespace(environment_variables=[]),
        source_run=_build_source_run(id="source_1", inputs_dict={}),
        workflow_run_id="new-run",
        rerun_node_ids=[],
        overrides=[],
        ancestors=[],
    )

    segment = variable_pool.get(["node_a", "output"])
    assert segment is not None
    assert segment.value == "new"


def test_execute_rerun_dispatches_by_streaming(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    sentinel_plan = object()

    monkeypatch.setattr(service, "_build_plan_or_raise", lambda **_: sentinel_plan)
    monkeypatch.setattr(service, "_execute_streaming_with_plan", lambda **_: "streaming-path")
    monkeypatch.setattr(service, "_execute_blocking_with_plan", lambda **_: {"mode": "blocking"})

    streaming_result = service.execute_rerun(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        user=SimpleNamespace(id="user_1"),
        source_run_id="source_1",
        target_node_id="target",
        overrides=[],
        streaming=True,
    )
    blocking_result = service.execute_rerun(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1", mode="workflow"),
        user=SimpleNamespace(id="user_1"),
        source_run_id="source_1",
        target_node_id="target",
        overrides=[],
        streaming=False,
    )

    assert streaming_result == "streaming-path"
    assert blocking_result == {"mode": "blocking"}


def test_execute_blocking_with_plan_enforces_error_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    plan = SimpleNamespace(
        workflow_run_id="new-run",
        task_id="task-1",
        source_run=SimpleNamespace(id="source-1"),
        target_node_id="target",
        graph_runtime_state=object(),
        scope=WorkflowRunRerunScope(
            target_node_id="target",
            ancestor_node_ids=["ancestor"],
            rerun_node_ids=["target"],
            overrideable_node_ids=["ancestor"],
        ),
    )

    def _failed_response(**_: Any) -> Mapping[str, Any]:
        return {
            "workflow_run_id": "new-run",
            "task_id": "task-1",
            "data": {
                "status": "failed",
                "outputs": {},
                "error": None,
                "elapsed_time": 0.1,
                "total_tokens": 1,
                "total_steps": 1,
                "created_at": 1,
                "finished_at": 2,
            },
        }

    monkeypatch.setattr(service, "_execute_generator_with_plan", _failed_response)
    failed_result = service._execute_blocking_with_plan(plan=plan, user=SimpleNamespace(id="u1"))
    assert failed_result["status"] == "failed"
    assert failed_result["error"] == "Workflow rerun failed."

    def _succeeded_response(**_: Any) -> Mapping[str, Any]:
        return {
            "workflow_run_id": "new-run",
            "task_id": "task-1",
            "data": {
                "status": "succeeded",
                "outputs": {"answer": "ok"},
                "error": "should-be-cleared",
                "elapsed_time": 0.1,
                "total_tokens": 1,
                "total_steps": 1,
                "created_at": 1,
                "finished_at": 2,
            },
        }

    monkeypatch.setattr(service, "_execute_generator_with_plan", _succeeded_response)
    succeeded_result = service._execute_blocking_with_plan(plan=plan, user=SimpleNamespace(id="u1"))
    assert succeeded_result["status"] == "succeeded"
    assert succeeded_result["error"] is None


def test_execute_blocking_with_plan_rejects_unknown_status(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    plan = SimpleNamespace(
        workflow_run_id="new-run",
        task_id="task-1",
        source_run=SimpleNamespace(id="source-1"),
        target_node_id="target",
        graph_runtime_state=object(),
        scope=WorkflowRunRerunScope(
            target_node_id="target",
            ancestor_node_ids=[],
            rerun_node_ids=["target"],
            overrideable_node_ids=[],
        ),
    )

    monkeypatch.setattr(
        service,
        "_execute_generator_with_plan",
        lambda **_: {
            "workflow_run_id": "new-run",
            "task_id": "task-1",
            "data": {
                "status": "unknown-status",
                "outputs": {},
                "error": None,
                "elapsed_time": 0.1,
                "total_tokens": 1,
                "total_steps": 1,
                "created_at": 1,
                "finished_at": 2,
            },
        },
    )

    with pytest.raises(WorkflowRunRerunServiceError) as exc_info:
        service._execute_blocking_with_plan(plan=plan, user=SimpleNamespace(id="u1"))

    assert exc_info.value.code == "rerun_execution_failed"
    assert exc_info.value.status == 500


def test_execute_streaming_with_plan_uses_on_subscribe_task_trigger(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _new_service()
    delay_calls: list[str] = []

    def _fake_delay(payload: str) -> None:
        delay_calls.append(payload)

    monkeypatch.setattr("tasks.app_generate.workflow_rerun_task.workflow_run_rerun_task.delay", _fake_delay)
    monkeypatch.setattr(
        "services.workflow_run_rerun_service.AppGenerateService._build_streaming_task_on_subscribe", lambda fn: fn
    )

    def _retrieve_events(*args, on_subscribe=None, **kwargs):
        assert on_subscribe is not None
        on_subscribe()
        return iter([{"event": "workflow_started"}])

    monkeypatch.setattr(
        "services.workflow_run_rerun_service.MessageBasedAppGenerator.retrieve_events",
        _retrieve_events,
    )
    monkeypatch.setattr(
        "services.workflow_run_rerun_service.WorkflowAppGenerator.convert_to_event_stream",
        lambda events: events,
    )

    plan = SimpleNamespace(
        app_model=SimpleNamespace(id="app_1", tenant_id="tenant_1"),
        workflow=SimpleNamespace(id="wf_1"),
        task_id="task_1",
        workflow_run_id="new_run_1",
        target_node_id="target",
        user_inputs={"foo": "bar"},
        execution_graph_config={"nodes": [], "edges": []},
        rerun_metadata={
            "rerun_from_workflow_run_id": "source_1",
            "rerun_from_node_id": "target",
            "rerun_overrides": [],
            "rerun_scope": {
                "target_node_id": "target",
                "ancestor_node_ids": [],
                "rerun_node_ids": ["target"],
                "overrideable_node_ids": [],
            },
            "rerun_chain_root_workflow_run_id": "source_1",
            "rerun_kind": "manual-node-rerun",
        },
        graph_runtime_state=SimpleNamespace(dumps=lambda: "snapshot"),
    )

    result = service._execute_streaming_with_plan(
        plan=plan,
        user=SimpleNamespace(id="user_1"),
    )
    first_event = next(result)

    assert first_event == {"event": "workflow_started"}
    assert len(delay_calls) == 1
    payload = json.loads(delay_calls[0])
    assert payload["workflow_run_id"] == "new_run_1"
    assert payload["target_node_id"] == "target"


def test_resolve_invoke_from_supports_end_user() -> None:
    service = _new_service()
    account = Account(name="tester", email="tester@example.com")
    end_user = EndUser()

    assert service._resolve_invoke_from(account) == InvokeFrom.DEBUGGER
    assert service._resolve_invoke_from(end_user) == InvokeFrom.SERVICE_API
