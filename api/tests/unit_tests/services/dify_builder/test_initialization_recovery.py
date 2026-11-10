"""Only an owned, failed root preparation can establish that execution never began."""

import json
from collections.abc import Generator, Mapping
from contextvars import copy_context

import pytest
from sqlalchemy import Engine

from core.plugin.entities.plugin_daemon import PluginDaemonInnerError
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.native_launch_observation import begin_preparation, mark_dispatched, observe_resource
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_runtime.base_runner import PreparedWorkflowRun
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import FullRunCase, _run
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as full_run_harness
from tests.unit_tests.services.test_workflow_run_agg import make_workflow_runner

harness = full_run_harness


@pytest.mark.parametrize(
    "failure_stage",
    [
        "root",
        "after_root",
        "nested",
        "unobserved",
        "root_node",
        "root_started_without_id",
        "root_terminal",
        "root_truncated",
        "root_no_error",
    ],
)
def test_root_metadata_failure_is_sealed_but_other_worker_failures_remain_unknown(
    harness: FullRunCase, monkeypatch: pytest.MonkeyPatch, failure_stage: str
) -> None:
    monkeypatch.setattr(WorkflowServiceDifyPort, "_finish_run", harness.native_finish)
    graph = json.loads(harness.draft.graph)
    graph["nodes"][1]["data"]["model"] = {"provider": "provider", "name": "model"}
    harness.draft.graph = json.dumps(graph)
    launched: list[str] = []
    events: list[Mapping[str, object]] = []

    def metadata_failure() -> None:
        with observe_resource("model", "provider", "model"):
            raise PluginDaemonInnerError(code=-500, message="private endpoint token=secret")

    def worker() -> None:
        engine = harness.factory.kw["bind"]
        assert isinstance(engine, Engine)
        runner, runs, nodes = make_workflow_runner(engine)
        fail = failure_stage.startswith("root")

        def prepare() -> PreparedWorkflowRun | None:
            if fail:
                metadata_failure()
            return None

        monkeypatch.setattr(runner, "prepare", prepare)
        if failure_stage != "unobserved":
            WorkflowRunAgg.run(runner, None, runs, nodes)
        if failure_stage == "nested":
            fail = True
            WorkflowRunAgg.run(runner, None, runs, nodes)
        metadata_failure()

    def generate(**_kwargs: object) -> Generator[dict[str, object]]:
        launched.append("worker")
        begin_preparation()
        worker_context = copy_context()
        mark_dispatched()

        def stream() -> Generator[dict[str, object]]:
            try:
                worker_context.run(worker)
            except PluginDaemonInnerError:
                if failure_stage == "root_node":
                    yield {"event": "node_started", "data": {"node_id": "llm"}}
                if failure_stage == "root_started_without_id":
                    yield {"event": "workflow_started", "data": {}}
                if failure_stage == "root_terminal":
                    yield {"event": "workflow_finished", "data": {"status": "failed"}}
                if failure_stage == "root_truncated":
                    raise ConnectionError("lost stream acknowledgement") from None
                if failure_stage != "root_no_error":
                    yield {"event": "error", "code": "invalid_param", "message": "private token=secret"}

        return stream()

    harness.generate.side_effect = generate
    first = _run(harness, on_workflow_event=events.append)
    recovered = _run(harness)
    assert launched == ["worker"]
    assert first.verification is not None
    evidence = first.verification.execution_evidence
    assert evidence is not None
    assert not first.dify_run_id
    assert first.per_node == []
    if failure_stage.startswith("root"):
        assert "secret" not in json.dumps(events)
        assert "before workflow execution started" not in json.dumps(events)
    if failure_stage == "root":
        assert first.status == recovered.status == "failed"
        assert first.immutable
        assert recovered.immutable
        assert evidence.sealed
        assert evidence.safety_outcome == "preparation_failed"
        assert evidence.failure_phase == "preparation"
        assert evidence.failure_resource == ("model", "provider", "model")
        assert evidence.failure_node_ids == ("llm",)
        assert "secret" not in first.error
    else:
        assert not evidence.sealed
        assert evidence.safety_outcome == "execution_evidence_unknown"
        assert recovered.status == "running"
