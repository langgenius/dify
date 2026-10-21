"""The real Fix model boundary must carry active conditions without raw producer values."""

import json
from collections.abc import Iterator
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import Never, cast, override
from unittest.mock import MagicMock, patch

import pytest
import pytest_mock
import sqlalchemy

from core.dify_builder.errors import NotFoundError
from core.dify_builder.models import Actor, ApplyResult, Diagnosis, Graph, MutationIntent, NodeOutput, Risk, Run
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.enums import ExecutionOffLoadType
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowRun
from services.dify_builder.agent import fix
from services.dify_builder.application.runner import Env
from services.dify_builder.condition_evidence import build_evidence
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.errors import PreflightError
from services.dify_builder.revision import execution_revision
from tests.unit_tests.core.dify_builder.fakes import FakeEditDifyPort, InMemoryRepository
from tests.unit_tests.services.dify_builder.test_dify_port import (
    PortDatabase,
    TrackedPortSession,
    _account,
    _actor,
    _app,
    _configure_session_get,
    _execution,
    _run,
    _workflow,
)
from tests.unit_tests.services.dify_builder.test_fix_cognition import _RecordingInstance


@pytest.fixture
def mock_session(sqlite_engine: sqlalchemy.Engine, mocker: pytest_mock.MockerFixture) -> Iterator[TrackedPortSession]:
    with TrackedPortSession(sqlite_engine, expire_on_commit=False) as session:
        for name in ("get", "refresh", "commit"):
            mocker.spy(session, name)
        yield session


def stored_outputs(row: WorkflowNodeExecutionModel) -> dict[str, object]:
    outputs = row.outputs_dict
    assert outputs is not None
    return outputs


def evidence_graph(operator: str = "is") -> Graph:
    return {
        "nodes": [
            {
                "id": "producer",
                "data": {
                    "type": "code",
                    "title": "Producer",
                    "code": 'def main(): return {"structured_output": {"confidence": 0.69}}',
                    "code_language": "python3",
                    "outputs": {
                        "structured_output": {"type": "object", "children": {"confidence": {"type": "number"}}}
                    },
                    "variables": [],
                },
            },
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "title": "Decision",
                    "cases": [
                        {
                            "case_id": "true",
                            "logical_operator": "and",
                            "conditions": [
                                {
                                    "id": "confidence-condition",
                                    "variable_selector": ["producer", "structured_output", "confidence"],
                                    "comparison_operator": operator,
                                    "varType": "number",
                                    "value": "0.7",
                                }
                            ],
                        }
                    ],
                },
            },
        ],
        "edges": [{"id": "producer-branch", "source": "producer", "target": "branch"}],
    }


def test_diagnosis_shows_active_condition_even_without_historical_binding() -> None:
    """Omitting IF config prevents diagnosis from distinguishing required and observed types."""
    graph = evidence_graph()
    outputs = [NodeOutput(node_id="branch", status="failed", error="Invalid actual value type: string or boolean")]
    original = deepcopy(outputs)
    model = _RecordingInstance(['{"culprit_node_id":"branch","root_cause":"mismatch","severity":"high"}'])
    fix.diagnose(model, Run(), graph, outputs)
    user = model.calls[0]["prompt_messages"][1].content
    assert "cases.0.conditions.0" in user
    assert "confidence-condition" in user
    assert '"expected_wire_type":"string"' in user
    assert '"producer_json_type":"unknown"' in user
    assert outputs == original


def test_real_proposal_rejects_an_unknown_evidence_operator_guess() -> None:
    """Real vet must prevent changing threshold ordering solely on error prose."""
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph("<")
    diagnosis = Diagnosis(culprit_node_id="branch", root_cause="Invalid actual value type: number")
    diagnosis.condition_evidence = {"graph_state": "unavailable", "conditions": []}
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "is"},
                }
            ]
        }
    )
    model = _RecordingInstance([payload, payload])
    intents, risk = fix.propose_repair(model, diagnosis, graph)
    assert intents == []
    assert risk.level == "high"


def failed_rows(value: object = 0.69, *, available: bool = True) -> list[NodeOutput]:
    return [
        NodeOutput(
            node_id="producer",
            status="succeeded",
            outputs_available=available,
            outputs={"structured_output": {"confidence": value}},
        ),
        NodeOutput(node_id="branch", status="failed", error="Invalid actual value type: string or boolean"),
    ]


@pytest.mark.parametrize(
    ("value", "want"),
    [
        (None, "null"),
        (False, "boolean"),
        (True, "boolean"),
        (0, "number"),
        (0.69, "number"),
        ("0.69", "string"),
        ({}, "object"),
        ([], "array"),
    ],
)
def test_same_run_producer_json_type_is_distinct_from_unresolved_if_operand(
    value: Graph | None | bool | float | int | list[object] | str, want: str
) -> None:
    graph = evidence_graph()
    _, _, _, evidence = build_evidence(Run(), graph, deepcopy(graph), failed_rows(value))
    fact = evidence["conditions"][0]
    assert fact["producer_json_type"] == want
    assert fact["resolved_operand_type"] == "unknown"
    assert fact["expected_wire_type"] == "string"
    assert fact["expected_wire_value"] == "0.7"
    assert evidence["graph_state"] == "historical_matches_current"


@pytest.mark.parametrize(
    "kind", ["missing", "truncated", "duplicate", "failed", "redacted", "selector", "loop", "retry", "duplicate-node"]
)
def test_incomplete_or_ambiguous_producer_evidence_stays_unknown(kind: str) -> None:
    from services.dify_builder.credentials import REDACTED

    graph, rows = evidence_graph(), failed_rows()
    if kind == "missing":
        rows.pop(0)
    elif kind == "truncated":
        rows[0].outputs_available = False
    elif kind == "duplicate":
        rows.insert(0, deepcopy(rows[0]))
    elif kind == "failed":
        rows[0].status = "failed"
    elif kind == "redacted":
        rows[0].outputs["structured_output"]["confidence"] = REDACTED
    elif kind == "selector":
        graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["variable_selector"][1] = "{{dynamic}}"
    elif kind == "loop":
        graph["nodes"][0]["data"]["isInLoop"] = True
    elif kind == "retry":
        graph["nodes"][0]["data"]["retry_config"] = {"retry_enabled": True}
    elif kind == "duplicate-node":
        graph["nodes"].append(deepcopy(graph["nodes"][0]))
    # Keep the IF failure first even if the producer itself is failed.
    rows.sort(key=lambda row: row.node_id != "branch")
    _, _, _, evidence = build_evidence(Run(), graph, deepcopy(graph), rows)
    assert evidence["conditions"][0]["producer_json_type"] == "unknown"


@pytest.mark.parametrize("cases", ["absent", None, []])
def test_native_legacy_fallback_and_explicit_empty_cases(cases: None | list[object] | str) -> None:
    graph = evidence_graph()
    data = graph["nodes"][1]["data"]
    data["conditions"] = data["cases"][0]["conditions"]
    if cases == "absent":
        del data["cases"]
    else:
        data["cases"] = cases
    _, _, _, evidence = build_evidence(Run(), graph, deepcopy(graph), failed_rows())
    assert [fact["path"] for fact in evidence["conditions"]] == ([] if cases == [] else ["conditions.0"])


def test_historical_graph_does_not_borrow_current_condition_or_schema() -> None:
    current, historical = evidence_graph("<"), evidence_graph("is")
    current["nodes"][0]["data"]["structured_output"] = {"schema": {"type": "number"}}
    _, _, _, evidence = build_evidence(Run(), current, historical, failed_rows("0.69"))
    assert evidence["graph_state"] == "historical_differs_current"
    assert evidence["conditions"][0]["operator"] == "is"
    assert evidence["conditions"][0]["producer_json_type"] == "string"
    assert evidence["current_conditions"][0]["operator"] == "<"
    assert evidence["current_conditions"][0]["producer_json_type"] == "unknown"


def test_error_only_credential_is_collected_before_projection_and_truncation() -> None:
    graph = evidence_graph()
    secret = "error-only-sensitive-token"
    graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secret
    rows = failed_rows(secret)
    rows[1].error = "password=" + secret
    safe_run, safe_graph, safe_rows, evidence = build_evidence(Run(error="password=" + secret), graph, graph, rows)
    assert secret not in json.dumps(evidence)
    assert secret not in json.dumps(safe_graph)
    assert secret not in safe_run.error
    assert secret not in safe_rows[1].error
    assert evidence["conditions"][0]["producer_json_type"] == "unknown"


def test_all_graphs_and_later_upstream_rows_are_redacted_before_budget() -> None:
    current, historical = evidence_graph(), evidence_graph()
    secrets = ["current-secret-abc", "historical-secret-xyz", "upstream-secret-123"]
    current["nodes"][0]["data"]["authorization"] = {"type": "api-key", "config": {"api_key": secrets[0]}}
    historical["nodes"][0]["data"]["password"] = secrets[1]
    current["nodes"][1]["data"]["title"] = " ".join(secrets)
    historical["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secrets[2]
    rows = failed_rows(" ".join(secrets))
    rows.append(NodeOutput(node_id="unrelated", outputs={"token": secrets[2], "large": "x" * 30000}))
    _, safe_graph, safe_rows, evidence = build_evidence(Run(error=" ".join(secrets)), current, historical, rows)
    rendered = json.dumps([safe_graph, evidence, [row.error for row in safe_rows]])
    assert all(secret not in rendered for secret in secrets)
    assert "expected_wire_value" not in evidence["conditions"][0]
    assert evidence["conditions"][0]["producer_json_type"] == "unknown"


def test_projection_budget_discards_whole_conditions_and_marks_unknown() -> None:
    from services.dify_builder.condition_evidence import MAX_CONTEXT_BYTES

    graph = evidence_graph()
    condition = graph["nodes"][1]["data"]["cases"][0]["conditions"][0]
    condition["variable_selector"] = ["producer", "x" * 20000]
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows())
    assert evidence["truncated"] is True
    assert evidence["conditions"] == []
    assert len(json.dumps(evidence, ensure_ascii=True).encode()) <= MAX_CONTEXT_BYTES


@dataclass
class NativeEvidenceCase:
    port: WorkflowServiceDifyPort
    graph: Graph
    workflow: Workflow
    run: WorkflowRun
    rows: list[WorkflowNodeExecutionModel]
    sync: MagicMock
    repositories: MagicMock


def native_row(node_id: str, *, value: object = 0.69) -> WorkflowNodeExecutionModel:
    row = _execution(
        node_id=node_id,
        node_type="code" if node_id == "producer" else "if-else",
        title=node_id,
        status="succeeded" if node_id == "producer" else "failed",
        error="" if node_id == "producer" else "Invalid actual value type: string or boolean",
        inputs_dict={},
        outputs_dict={"structured_output": {"confidence": value}} if node_id == "producer" else {},
    )
    row.id = "row-" + node_id
    row.node_execution_id = "exec-" + node_id
    row.workflow_run_id = "native-run"
    row.execution_metadata = json.dumps({})
    row.finished_at = datetime.min
    return row


@pytest.fixture
def native_adapter(
    mock_session: TrackedPortSession, sqlite_engine: sqlalchemy.Engine, monkeypatch: pytest.MonkeyPatch
) -> Iterator[NativeEvidenceCase]:
    session = mock_session
    monkeypatch.setattr("services.dify_builder.dify_port.db", PortDatabase(sqlite_engine))
    monkeypatch.setattr("services.dify_builder.dify_port._session_factory", lambda: lambda: session)
    _configure_session_get(session, account=_account(), app=_app())
    graph = evidence_graph()
    workflow = _workflow(session=session, graph_dict=graph)
    run = _run(id="native-run", graph_dict=deepcopy(graph), status="failed", error="")
    rows = [native_row("producer"), native_row("branch")]
    with (
        patch("services.dify_builder.dify_port.set_login_user"),
        patch("services.dify_builder.dify_port.DifyAPIRepositoryFactory") as repositories,
        patch("services.dify_builder.dify_port.WorkflowService") as workflow_service,
        patch("services.dify_builder.dify_port.notify_workflow_draft_changed"),
        patch("services.dify_builder.dify_port._sync_graph_only") as sync,
    ):
        repositories.create_api_workflow_run_repository.return_value.get_workflow_run_by_id.return_value = run
        node_repository = repositories.create_api_workflow_node_execution_repository.return_value
        node_repository.get_executions_by_workflow_run.return_value = rows
        workflow_service.return_value.get_draft_workflow.side_effect = lambda _app, *, session: session.get(
            Workflow, workflow.id
        )
        sync.side_effect = lambda _app, graph, *_args: _workflow(graph_dict=graph)
        yield NativeEvidenceCase(
            port=WorkflowServiceDifyPort(),
            graph=graph,
            workflow=workflow,
            run=run,
            rows=rows,
            sync=sync,
            repositories=repositories,
        )


def repair_intent(value: object = "=", path: str = "comparison_operator") -> MutationIntent:
    return MutationIntent(
        op="set_node_config", args={"node_id": "branch", "path": "cases.0.conditions.0." + path, "value": value}
    )


def apply_native(adapter: NativeEvidenceCase, intents: list[MutationIntent]) -> ApplyResult:
    return adapter.port.apply_repair(
        "app-1", _actor(), intents, expected_revision=execution_revision(adapter.workflow), failed_run_id="native-run"
    )


def test_real_write_rejects_value_only_noop_that_leaves_observed_mismatch(native_adapter: NativeEvidenceCase) -> None:
    with pytest.raises(PreflightError, match="IF repair"):
        apply_native(native_adapter, [repair_intent("0.7", "value")])
    native_adapter.sync.assert_not_called()


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "id"])
def test_adapter_denies_mismatched_run_before_reading_any_execution(
    native_adapter: NativeEvidenceCase, field: str
) -> None:
    setattr(native_adapter.run, field, "someone-else")
    with pytest.raises(NotFoundError):
        native_adapter.port.failed_run_context("app-1", _actor(), "native-run")
    native_adapter.repositories.create_api_workflow_node_execution_repository.assert_not_called()


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_run_id", "workflow_id"])
def test_adapter_denies_row_identity_before_ephemeral_raw_handling(
    native_adapter: NativeEvidenceCase, field: str
) -> None:
    def poisoned_outputs(_row: object) -> Never:
        raise AssertionError("unauthorized outputs were accessed")

    setattr(native_adapter.rows[1], field, "someone-else")
    with (
        patch.object(WorkflowNodeExecutionModel, "outputs_dict", new=property(poisoned_outputs)),
        pytest.raises(NotFoundError),
    ):
        native_adapter.port.failed_run_context("app-1", _actor(), "native-run")


@pytest.mark.parametrize("kind", ["missing-run", "missing-graph", "offload", "loop-metadata", "retry-metadata"])
def test_adapter_unavailable_native_evidence_does_not_gain_observed_types(
    native_adapter: NativeEvidenceCase, kind: str
) -> None:
    if kind == "missing-run":
        run_repository = native_adapter.repositories.create_api_workflow_run_repository.return_value
        run_repository.get_workflow_run_by_id.return_value = None
    elif kind == "missing-graph":
        native_adapter.run.graph = json.dumps({})
    elif kind == "offload":
        native_adapter.rows[0].offload_data = [
            WorkflowNodeExecutionOffload(
                tenant_id="tenant-1",
                app_id="app-1",
                node_execution_id="exec-producer",
                type_=ExecutionOffLoadType.OUTPUTS,
                file_id="offloaded-output",
            )
        ]
    elif kind == "loop-metadata":
        native_adapter.rows[0].execution_metadata = json.dumps({"loop_id": "loop-1"})
    elif kind == "retry-metadata":
        native_adapter.rows[0].execution_metadata = json.dumps({"retry_index": 1})
    historical, rows, _ = native_adapter.port.failed_run_context("app-1", _actor(), "native-run")
    _, _, _, evidence = build_evidence(Run(), native_adapter.graph, historical, rows)
    assert not evidence["conditions"] or evidence["conditions"][0]["producer_json_type"] == "unknown"
    with pytest.raises(PreflightError):
        apply_native(native_adapter, [repair_intent()])
    native_adapter.sync.assert_not_called()


def test_real_write_proven_numeric_equality_changes_only_nested_operator(native_adapter: NativeEvidenceCase) -> None:
    original = deepcopy(native_adapter.run.graph_dict)
    result = apply_native(native_adapter, [repair_intent()])
    assert result.changed_nodes == ["branch"]
    written = native_adapter.sync.call_args.args[1]
    expected = deepcopy(native_adapter.graph)
    expected["nodes"][1]["data"]["cases"][0]["conditions"][0]["comparison_operator"] = "="
    assert written == expected
    assert native_adapter.run.graph_dict == original
    assert "cases.0.conditions.0.comparison_operator" not in written["nodes"][1]["data"]
    assert native_adapter.sync.call_count == 1


@pytest.mark.parametrize(
    ("operator", "value", "path"),
    [
        ("is", "<", "comparison_operator"),
        ("<", "is", "comparison_operator"),
        ("is", "0.8", "value"),
        ("is", ["producer", "other"], "variable_selector"),
    ],
)
def test_actual_write_gate_preserves_threshold_selector_and_ordering(
    native_adapter: NativeEvidenceCase, operator: str, value: list[str] | str, path: str
) -> None:
    native_adapter.graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["comparison_operator"] = operator
    native_adapter.workflow.graph = json.dumps(native_adapter.graph)
    native_adapter.run.graph = json.dumps(native_adapter.graph)
    with pytest.raises(PreflightError):
        apply_native(native_adapter, [repair_intent(value, path)])
    native_adapter.sync.assert_not_called()


def test_real_model_boundary_diagnosis_and_proposal_share_sanitized_types(native_adapter: NativeEvidenceCase) -> None:
    from services.dify_builder.agent import llm_agent
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent
    from services.dify_builder.condition_evidence import diagnose_failure, propose_failure

    secret = "upstream-bearer-sealed-value"
    native_adapter.rows[0].outputs = json.dumps({**stored_outputs(native_adapter.rows[0]), "token": secret})
    assert native_adapter.rows[1].error is not None
    native_adapter.rows[1].error += " " + secret
    history = native_adapter.run.graph_dict
    history["nodes"][0]["data"]["password"] = secret
    native_adapter.run.graph = json.dumps(history)
    native_adapter.graph["nodes"][1]["data"]["title"] = secret
    raw_run = Run(dify_run_id="native-run", immutable=True, error=secret)
    original = deepcopy(raw_run)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "="},
                }
            ]
        }
    )
    model = _RecordingInstance(
        ['{"culprit_node_id":"branch","root_cause":"numeric equality","severity":"high"}', payload, payload]
    )
    env = Env(
        dify=native_adapter.port, agent=LlmBuilderAgent("tenant-1"), repo=InMemoryRepository(), now=lambda: datetime.min
    )
    with patch.object(llm_agent, "resolve_model_instance", return_value=model):
        diagnosis = diagnose_failure(env, "app-1", _actor(), raw_run, native_adapter.graph)
        intents, _ = propose_failure(env, "app-1", _actor(), raw_run, diagnosis, native_adapter.graph)
    assert len(model.calls) == 3
    for call in model.calls:
        system, user = [message.content for message in call["prompt_messages"]]
        assert secret not in system + user
        assert "confidence-condition" not in system
        assert "structured_output" not in system
        assert '"producer_json_type":"number"' in user
        assert '"resolved_operand_type":"unknown"' in user
        assert "cases.0.conditions.0" in user
        assert "0.69" not in user
    assert raw_run == original
    assert secret not in json.dumps(diagnosis.condition_evidence)
    # Historical graph changed password/title, so the real gate must refuse this stale repair.
    assert intents == []


def test_minimal_numeric_equality_repair_preserves_unrelated_invalid_sibling() -> None:
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph()
    sibling = deepcopy(graph["nodes"][1]["data"]["cases"][0]["conditions"][0])
    sibling["id"] = "sibling-condition"
    graph["nodes"][1]["data"]["cases"][0]["conditions"].append(sibling)
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows())
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "="},
                }
            ]
        }
    )
    intents, _ = fix.propose_repair(_RecordingInstance([payload, payload]), diagnosis, graph)
    assert len(intents) == 1
    assert graph["nodes"][1]["data"]["cases"][0]["conditions"][1] == sibling


@pytest.mark.parametrize("operator", ["null", "not null", "empty", "not empty", "exists", "not exists", "<"])
def test_harmless_if_metadata_edit_preserves_valid_comparison(operator: str) -> None:
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph(operator)
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows())
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    payload = json.dumps(
        {
            "intents": [
                {"op": "set_node_config", "args": {"node_id": "branch", "path": "title", "value": "Decision clarified"}}
            ]
        }
    )
    intents, _ = fix.propose_repair(_RecordingInstance([payload, payload]), diagnosis, graph)
    assert len(intents) == 1
    assert intents[0].args["path"] == "title"


@pytest.mark.parametrize(
    "malformed",
    [
        {"nodes": [None], "edges": []},
        {"nodes": [{"id": "branch", "data": None}], "edges": []},
        {"nodes": None, "edges": []},
        {"nodes": [], "edges": [None]},
        {"nodes": [{"id": "branch", "data": {"type": "if-else", "cases": "broken"}}], "edges": []},
    ],
)
def test_malformed_historical_graph_cannot_crash_or_bind_runtime_types(malformed: Graph) -> None:
    _, _, _, evidence = build_evidence(Run(), evidence_graph(), malformed, failed_rows())
    assert evidence["graph_state"] == "unavailable"
    assert all(fact["producer_json_type"] == "unknown" for fact in evidence["conditions"])


@pytest.mark.parametrize(
    ("actual", "expected"),
    [
        (0.69, "not-a-number"),
        (0.69, None),
        (0.69, "{{producer.secret}}"),
        (0.69, "[REDACTED]"),
        (0.69, "NaN"),
        (0.69, "Infinity"),
        (0, "0.7"),
    ],
)
def test_real_vet_rejects_equality_transition_with_native_incompatible_expected(
    actual: float | int, expected: None | str
) -> None:
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph()
    graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = expected
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows(actual))
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "="},
                }
            ]
        }
    )
    intents, risk = fix.propose_repair(_RecordingInstance([payload, payload]), diagnosis, graph)
    assert intents == []
    assert risk.level == "high"


@pytest.mark.parametrize("mode", ["build", "edit"])
def test_runtime_build_edit_handlers_bind_native_condition_evidence(mode: str, monkeypatch: pytest.MonkeyPatch) -> None:
    from core.dify_builder.models import DifyBuilderContext, EntryMode, TestInput, Turn
    from services.dify_builder.agent import llm_agent
    from services.dify_builder.application import handlers_build, handlers_edit
    from tests.unit_tests.core.dify_builder import test_handlers_build as build_tests
    from tests.unit_tests.core.dify_builder import test_handlers_edit as edit_tests
    from tests.unit_tests.core.dify_builder.fakes import failed_verification

    graph = evidence_graph()
    graph["nodes"].insert(0, {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}})
    graph["edges"].insert(0, {"id": "start-producer", "source": "start", "target": "producer"})
    rows = failed_rows()

    class OwnedNativePort(FakeEditDifyPort):
        def failed_run_context(self, app_id: str, actor: Actor, run_id: str) -> tuple[Graph, list[NodeOutput], str]:
            assert app_id == session.app_id
            assert actor == tests._actor()
            assert run_id == "native-run"
            return deepcopy(graph), deepcopy(rows), ""

        @override
        def run_draft(self, *_args: object, **_kwargs: object) -> Run:
            return Run(
                status="failed",
                dify_run_id="native-run",
                per_node=deepcopy(rows),
                verification=failed_verification(self),
            )

    port = OwnedNativePort()
    port.graph = deepcopy(graph)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "="},
                }
            ]
        }
    )
    model = _RecordingInstance(
        ['{"culprit_node_id":"branch","root_cause":"numeric equality","severity":"high"}', payload, payload]
    )
    monkeypatch.setattr(llm_agent, "resolve_model_instance", lambda *_args: model)
    tests = build_tests if mode == "build" else edit_tests
    env, repo = tests._new_env(dify=port, agent=llm_agent.LlmBuilderAgent("tenant-1"))
    session = tests._session(entry_mode=EntryMode.BUILD if mode == "build" else EntryMode.EDIT)
    repo.save_test_input(TestInput(id="ti", session_id=session.id, inputs={}))
    context = DifyBuilderContext(test_input_ref="ti")
    handler = handlers_build.handle_test_and_repair if mode == "build" else handlers_edit.handle_test_affected_paths
    result = handler(env, Turn(actor=tests._actor()), session, context)
    assert result.context is not None
    assert result.context.diagnosis is not None
    assert result.context.diagnosis.condition_evidence is not None
    assert result.context.diagnosis.condition_evidence["graph_state"] == "historical_matches_current"
    assert result.context is not None
    assert result.context.diagnosis is not None
    assert result.context.diagnosis.condition_evidence is not None
    assert result.context.diagnosis.condition_evidence["conditions"][0]["producer_json_type"] == "number"
    assert len(result.context.staged_repair) == 1
    assert '"producer_json_type":"number"' in model.calls[0]["prompt_messages"][1].content
    assert result.run is not None
    assert result.run.dify_run_id == "native-run"
    assert result.run.per_node == rows


@pytest.mark.parametrize("attack", ["producer", "delete-if", "disconnect", "new-node", "schema"])
def test_real_proposal_cannot_bypass_failed_if_gate_via_other_graph_mutations(attack: str) -> None:
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph("<")
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows("not-numeric"))
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    args = {
        "producer": {
            "op": "set_node_config",
            "args": {
                "node_id": "producer",
                "path": "code",
                "value": 'def main(): return {"structured_output":{"confidence":0.69}}',
            },
        },
        "delete-if": {"op": "delete_node", "args": {"node_id": "branch"}},
        "disconnect": {"op": "connect", "args": {"from_node": "producer", "to_node": "branch"}},
        "new-node": {
            "op": "create_node",
            "args": {
                "node_type": "template-transform",
                "node_id": "converter",
                "config": {
                    "type": "template-transform",
                    "title": "Converter",
                    "template": "0.69",
                    "variables": list[object](),
                },
            },
        },
        "schema": {
            "op": "set_node_config",
            "args": {"node_id": "producer", "path": "outputs", "value": {"confidence": {"type": "number"}}},
        },
    }[attack]
    if attack == "disconnect":
        # A new connection that bypasses the IF; original connection remains.
        graph["nodes"].append({"id": "end", "data": {"type": "end", "title": "End", "outputs": []}})
        _, _, _, diagnosis.condition_evidence = build_evidence(Run(), graph, graph, failed_rows("not-numeric"))
        args["args"]["to_node"] = "end"
    payload = json.dumps({"intents": [args]})
    intents, _ = fix.propose_repair(_RecordingInstance([payload, payload]), diagnosis, graph)
    assert intents == []


def test_native_run_error_credentials_are_collected_for_ordinary_fix(native_adapter: NativeEvidenceCase) -> None:
    from services.dify_builder.agent import llm_agent
    from services.dify_builder.condition_evidence import diagnose_failure

    secret = "native-run-error-only-password"
    native_adapter.run.error = "password=" + secret
    history = native_adapter.run.graph_dict
    for graph in (native_adapter.graph, history):
        graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secret
    native_adapter.run.graph = json.dumps(history)
    model = _RecordingInstance(['{"culprit_node_id":"branch","root_cause":"mismatch","severity":"high"}'])
    env = Env(
        dify=native_adapter.port,
        agent=llm_agent.LlmBuilderAgent("tenant-1"),
        repo=InMemoryRepository(),
        now=lambda: datetime.min,
    )
    with patch.object(llm_agent, "resolve_model_instance", return_value=model):
        diagnosis = diagnose_failure(env, "app-1", _actor(), Run(dify_run_id="native-run"), native_adapter.graph)
    assert secret not in json.dumps(diagnosis.condition_evidence)
    assert secret not in model.calls[0]["prompt_messages"][1].content


@pytest.mark.parametrize("kind", ["target-loop-metadata", "target-duplicate", "incomplete-success", "retry-zero"])
def test_incomplete_or_repeated_execution_scope_cannot_establish_types(
    native_adapter: NativeEvidenceCase, kind: str
) -> None:
    if kind == "target-loop-metadata":
        native_adapter.rows[1].execution_metadata = json.dumps({"loop_id": "loop-1"})
    elif kind == "target-duplicate":
        native_adapter.rows.append(deepcopy(native_adapter.rows[1]))
    elif kind == "incomplete-success":
        native_adapter.rows[0].finished_at = None
    else:
        native_adapter.rows[0].execution_metadata = json.dumps({"retry_index": 0})
    historical, rows, _ = native_adapter.port.failed_run_context("app-1", _actor(), "native-run")
    _, _, _, evidence = build_evidence(Run(), native_adapter.graph, historical, rows)
    assert evidence["conditions"][0]["producer_json_type"] == "unknown"


@pytest.mark.parametrize("actual", ["0.69", False, None])
def test_real_proposal_cannot_claim_value_only_noop_is_an_if_repair(actual: None | bool | str) -> None:
    from core.dify_builder.models import Diagnosis

    graph = evidence_graph("<")
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows(actual))
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.value", "value": "0.7"},
                }
            ]
        }
    )
    intents, _ = fix.propose_repair(_RecordingInstance([payload, payload]), diagnosis, graph)
    assert intents == []


@pytest.mark.parametrize("source", ["current", "historical", "upstream", "error"])
def test_quoted_and_expected_credentials_are_collected_before_projection(source: str) -> None:
    current, historical, rows = evidence_graph(), evidence_graph(), failed_rows()
    secret = "quoted password with spaces"
    assignment = '{"password":"' + secret + '"}'
    historical["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secret
    if source == "current":
        current["nodes"][0]["data"]["description"] = assignment
    elif source == "historical":
        historical["nodes"][1]["data"]["cases"][0]["conditions"].append(
            {
                "id": "contains-credential",
                "variable_selector": ["producer", "output"],
                "comparison_operator": "is",
                "value": assignment,
            }
        )
    elif source == "upstream":
        rows[0].outputs["text"] = assignment
    else:
        rows[1].error = assignment
    _, _, _, evidence = build_evidence(Run(), current, historical, rows)
    assert secret not in json.dumps(evidence)


def test_over_budget_execution_identifiers_cannot_escape_context_budget() -> None:
    from services.dify_builder.condition_evidence import MAX_CONTEXT_BYTES

    graph = evidence_graph()
    long_id = "branch-" + "x" * 20000
    graph["nodes"][1]["id"] = long_id
    graph["edges"][0]["target"] = long_id
    rows = failed_rows()
    rows[1].node_id = long_id
    _, _, _, evidence = build_evidence(Run(), graph, graph, rows)
    assert len(json.dumps(evidence, ensure_ascii=True).encode()) <= MAX_CONTEXT_BYTES
    assert evidence["truncated"] is True
    assert evidence["conditions"] == []


@pytest.mark.parametrize("attack", ["producer", "new-node", "delete-if"])
def test_actual_write_refuses_indirect_if_gate_bypass(native_adapter: NativeEvidenceCase, attack: str) -> None:
    if attack == "producer":
        intent = MutationIntent(
            op="set_node_config", args={"node_id": "producer", "path": "code", "value": "def main(): return {}"}
        )
    elif attack == "new-node":
        intent = MutationIntent(
            op="create_node",
            args={
                "node_id": "converter",
                "node_type": "template-transform",
                "config": {"title": "Converter", "template": "0.69", "variables": []},
            },
        )
    else:
        intent = MutationIntent(op="delete_node", args={"node_id": "branch"})
    with pytest.raises(PreflightError, match="IF repair"):
        apply_native(native_adapter, [intent])
    native_adapter.sync.assert_not_called()


@pytest.mark.parametrize(
    ("actual", "wire", "expected_route"),
    [(0.69, "0.7", False), (0.70, "0.7", True), (0.71, "0.7", False), (0, "0", True)],
)
def test_proven_equality_repair_preserves_native_threshold_route(
    actual: float | int, wire: str, expected_route: bool
) -> None:
    from core.dify_builder.models import Diagnosis
    from graphon.utils.condition.processor import _assert_equal
    from services.dify_builder import graph_ops

    graph = evidence_graph()
    graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = wire
    _, _, _, evidence = build_evidence(Run(), graph, graph, failed_rows(actual))
    diagnosis = Diagnosis(culprit_node_id="branch", condition_evidence=evidence)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {"node_id": "branch", "path": "cases.0.conditions.0.comparison_operator", "value": "="},
                }
            ]
        }
    )
    intents, _ = fix.propose_repair(_RecordingInstance([payload]), diagnosis, graph)
    assert len(intents) == 1
    applied = graph_ops.filter_applicable(graph, intents).graph
    condition = applied["nodes"][1]["data"]["cases"][0]["conditions"][0]
    assert condition["value"] == wire
    assert condition["comparison_operator"] == "="
    assert _assert_equal(value=actual, expected=condition["value"]) is expected_route


@pytest.mark.parametrize("mode", ["fix", "build", "edit"])
def test_runtime_handler_write_reloads_trusted_failed_run_and_refuses_value_only(
    native_adapter: NativeEvidenceCase, mode: str
) -> None:
    from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Turn
    from core.dify_builder.state import PcState
    from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
    from tests.unit_tests.core.dify_builder import test_handlers_build as build_tests

    env, repo = build_tests._new_env(dify=native_adapter.port)
    session = build_tests._session(
        app_id="app-1",
        entry_mode=EntryMode.FIX if mode == "fix" else EntryMode.BUILD if mode == "build" else EntryMode.EDIT,
    )
    original = Run(
        id="original-failed", dify_run_id="native-run", kind="original-failed", status="failed", immutable=True
    )
    repo.save_run(session.id, original)
    original_before = deepcopy(repo.get_run(original.id))
    context = DifyBuilderContext(
        failed_run_id=original.id,
        verify_run_id=original.id,
        source="run",
        staged_repair=[repair_intent("0.7", "value")],
        last_snapshot_hash=execution_revision(native_adapter.workflow),
    )
    handler = {
        "fix": handlers_fix.handle_apply,
        "build": handlers_build.handle_await_repair,
        "edit": handlers_edit.handle_await_repair,
    }[mode]
    result = handler(env, Turn(actor=_actor(), action=Action(kind="approve_repair")), session, context)
    assert (
        result.next
        == {"fix": PcState.FIX_AWAIT_DECISION, "build": PcState.BUILD_AWAIT_REPAIR, "edit": PcState.EDIT_AWAIT_REPAIR}[
            mode
        ]
    )
    assert context.staged_repair == []
    assert repo.get_run(original.id) == original_before
    native_adapter.sync.assert_not_called()


def test_runtime_non_if_fix_keeps_existing_native_write_behavior(native_adapter: NativeEvidenceCase) -> None:
    native_adapter.rows[0].status = WorkflowNodeExecutionStatus.FAILED
    native_adapter.rows[0].error = "NameError: missing_variable"
    # Deliberately malformed persisted status must not authorize a failed-node repair.
    native_adapter.rows[1].status = cast(WorkflowNodeExecutionStatus, "skipped")
    intent = MutationIntent(
        op="set_node_config", args={"node_id": "producer", "path": "code", "value": "def main(): return {}"}
    )
    result = apply_native(native_adapter, [intent])
    assert result.changed_nodes == ["producer"]
    assert native_adapter.sync.call_args.args[1]["nodes"][0]["data"]["code"] == "def main(): return {}"
    assert native_adapter.sync.call_count == 1


def _producer_rewrite_payload() -> str:
    return json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {
                        "node_id": "producer",
                        "path": "code",
                        "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                    },
                }
            ]
        }
    )


def _real_context_proposal(
    adapter: NativeEvidenceCase, replies: list[str] | None = None
) -> tuple[Diagnosis, list[MutationIntent], Risk, _RecordingInstance]:
    from services.dify_builder.agent import llm_agent
    from services.dify_builder.condition_evidence import diagnose_failure, propose_failure

    model = _RecordingInstance(
        replies
        or [
            '{"culprit_node_id":"branch","root_cause":"mismatch","severity":"high"}',
            _producer_rewrite_payload(),
            _producer_rewrite_payload(),
        ]
    )
    env = Env(
        dify=adapter.port,
        agent=llm_agent.LlmBuilderAgent("tenant-1"),
        repo=InMemoryRepository(),
        now=lambda: datetime.min,
    )
    run = Run(dify_run_id="native-run", immutable=True)
    with patch.object(llm_agent, "resolve_model_instance", return_value=model):
        diagnosis = diagnose_failure(env, "app-1", _actor(), run, adapter.graph)
        intents, risk = propose_failure(env, "app-1", _actor(), run, diagnosis, adapter.graph)
    return diagnosis, intents, risk, model


@pytest.mark.parametrize("boundary", ["projection", "proposal", "write"])
def test_review_r1_handled_exception_cannot_hide_terminal_failed_if(
    native_adapter: NativeEvidenceCase, boundary: str
) -> None:
    from services.dify_builder.preflight import preflight_errors

    producer = native_adapter.graph["nodes"][0]["data"]
    producer["error_strategy"] = "default-value"
    producer["default_value"] = [{"key": "structured_output", "type": "object", "value": {"confidence": "unknown"}}]
    native_adapter.run.graph = json.dumps(native_adapter.graph)
    native_adapter.workflow.graph = json.dumps(native_adapter.graph)
    native_adapter.rows[0].status = WorkflowNodeExecutionStatus.EXCEPTION
    native_adapter.rows[0].execution_metadata = json.dumps({"error_strategy": "default-value"})
    assert preflight_errors(native_adapter.graph) == []
    if boundary == "write":
        with pytest.raises(PreflightError):
            apply_native(
                native_adapter,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "producer",
                            "path": "code",
                            "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                        },
                    )
                ],
            )
        native_adapter.sync.assert_not_called()
    else:
        diagnosis, intents, _, _ = _real_context_proposal(native_adapter)
        if boundary == "projection":
            assert diagnosis.condition_evidence is not None
            assert diagnosis.condition_evidence["failed_node_id"] == "branch"
            assert diagnosis.condition_evidence is not None
            assert diagnosis.condition_evidence["failed_node_type"] == "if-else"
        else:
            assert intents == []


@pytest.mark.parametrize(
    "kind", ["two-terminal-failures", "only-handled-exception", "missing-run", "empty-rows", "missing-historical-graph"]
)
@pytest.mark.parametrize("boundary", ["proposal", "write"])
def test_review_r1_r2_unknown_failure_identity_cannot_authorize_producer_rewrite(
    native_adapter: NativeEvidenceCase, kind: str, boundary: str
) -> None:
    if kind == "two-terminal-failures":
        native_adapter.rows[0].status = WorkflowNodeExecutionStatus.FAILED
    elif kind == "only-handled-exception":
        native_adapter.rows[0].status = WorkflowNodeExecutionStatus.EXCEPTION
        # Deliberately malformed persisted status must not authorize a failed-node repair.
        native_adapter.rows[1].status = cast(WorkflowNodeExecutionStatus, "skipped")
    elif kind == "missing-run":
        repository = native_adapter.repositories.create_api_workflow_run_repository.return_value
        repository.get_workflow_run_by_id.return_value = None
    elif kind == "empty-rows":
        native_adapter.rows.clear()
    else:
        native_adapter.run.graph = json.dumps({})
    if boundary == "proposal":
        _, intents, _, _ = _real_context_proposal(native_adapter)
        assert intents == []
    else:
        with pytest.raises(PreflightError):
            apply_native(
                native_adapter,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "producer",
                            "path": "code",
                            "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                        },
                    )
                ],
            )
        native_adapter.sync.assert_not_called()


@pytest.mark.parametrize("boundary", ["proposal", "write"])
def test_review_r3_historical_if_replaced_by_same_id_code_is_stale(
    native_adapter: NativeEvidenceCase, boundary: str
) -> None:
    replacement = deepcopy(native_adapter.graph["nodes"][0])
    replacement["id"] = "branch"
    native_adapter.graph["nodes"][1] = replacement
    native_adapter.workflow.graph = json.dumps(native_adapter.graph)
    payload = json.dumps(
        {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {
                        "node_id": "branch",
                        "path": "code",
                        "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                    },
                }
            ]
        }
    )
    if boundary == "proposal":
        _, intents, _, _ = _real_context_proposal(
            native_adapter, ['{"culprit_node_id":"branch","root_cause":"mismatch","severity":"high"}', payload, payload]
        )
        assert intents == []
    else:
        with pytest.raises(PreflightError):
            apply_native(
                native_adapter,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "branch",
                            "path": "code",
                            "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                        },
                    )
                ],
            )
        native_adapter.sync.assert_not_called()


@pytest.mark.parametrize("spelling", ["client_secret", "clientSecret", "refresh_token", "private_key", "auth_token"])
@pytest.mark.parametrize("source", ["native-error", "upstream-string", "expected-string"])
def test_review_r4_normalized_explicit_credentials_never_reach_prompts_or_evidence(
    native_adapter: NativeEvidenceCase, spelling: str, source: str
) -> None:
    secret = "review-sensitive-assignment-value"
    assignment = json.dumps({spelling: secret})
    history = native_adapter.run.graph_dict
    for graph in (native_adapter.graph, history):
        graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secret
        if source == "expected-string":
            sibling = deepcopy(graph["nodes"][1]["data"]["cases"][0]["conditions"][0])
            sibling["id"] = "credential-assignment"
            sibling["value"] = assignment
            graph["nodes"][1]["data"]["cases"][0]["conditions"].append(sibling)
    native_adapter.run.graph = json.dumps(history)
    if source == "native-error":
        native_adapter.run.error = spelling + '="' + secret + '"'
    elif source == "upstream-string":
        native_adapter.rows[0].outputs = json.dumps(
            {**stored_outputs(native_adapter.rows[0]), "annotation": assignment}
        )
    diagnosis_reply = json.dumps({"culprit_node_id": "branch", "root_cause": "mismatch " + secret, "severity": "high"})
    diagnosis, _, _, model = _real_context_proposal(
        native_adapter, [diagnosis_reply, _producer_rewrite_payload(), _producer_rewrite_payload()]
    )
    assert len(model.calls) == 3
    assert secret not in diagnosis.root_cause
    assert secret not in json.dumps(diagnosis.condition_evidence)
    for call in model.calls:
        assert secret not in " ".join(message.content for message in call["prompt_messages"])


@pytest.mark.parametrize("boundary", ["proposal", "write"])
def test_review_r2_missing_history_cannot_use_current_non_if_type(
    native_adapter: NativeEvidenceCase, boundary: str
) -> None:
    native_adapter.rows[0].status = WorkflowNodeExecutionStatus.FAILED
    # Deliberately malformed persisted status must not authorize a failed-node repair.
    native_adapter.rows[1].status = cast(WorkflowNodeExecutionStatus, "skipped")
    native_adapter.run.graph = json.dumps({})
    if boundary == "proposal":
        _, intents, _, _ = _real_context_proposal(native_adapter)
        assert intents == []
    else:
        with pytest.raises(PreflightError):
            apply_native(
                native_adapter,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={
                            "node_id": "producer",
                            "path": "code",
                            "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                        },
                    )
                ],
            )
        native_adapter.sync.assert_not_called()


@pytest.mark.parametrize("missing", ["run", "rows"])
def test_review_r2_write_does_not_trust_prior_available_diagnosis(
    native_adapter: NativeEvidenceCase, missing: str
) -> None:
    diagnosis, _, _, _ = _real_context_proposal(native_adapter)
    assert diagnosis.condition_evidence is not None
    assert diagnosis.condition_evidence["failed_node_type"] == "if-else"
    if missing == "run":
        repository = native_adapter.repositories.create_api_workflow_run_repository.return_value
        repository.get_workflow_run_by_id.return_value = None
    else:
        native_adapter.rows.clear()
    with pytest.raises(PreflightError):
        apply_native(
            native_adapter,
            [
                MutationIntent(
                    op="set_node_config",
                    args={
                        "node_id": "producer",
                        "path": "code",
                        "value": 'def main(): return {"structured_output": {"confidence": 1}}',
                    },
                )
            ],
        )
    native_adapter.sync.assert_not_called()


@pytest.mark.parametrize("attack", ["schema", "routing"])
@pytest.mark.parametrize("boundary", ["proposal", "write"])
def test_review_r2_unavailable_context_rejects_schema_and_routing(
    native_adapter: NativeEvidenceCase, attack: str, boundary: str
) -> None:
    native_adapter.rows.clear()
    if attack == "schema":
        intent = MutationIntent(
            op="set_node_config",
            args={"node_id": "producer", "path": "outputs", "value": {"confidence": {"type": "number"}}},
        )
    else:
        native_adapter.graph["nodes"].append({"id": "end", "data": {"type": "end", "title": "End", "outputs": []}})
        native_adapter.workflow.graph = json.dumps(native_adapter.graph)
        intent = MutationIntent(op="connect", args={"from_node": "producer", "to_node": "end"})
    if boundary == "proposal":
        payload = json.dumps({"intents": [{"op": intent.op, "args": intent.args}]})
        _, intents, _, _ = _real_context_proposal(
            native_adapter, ['{"culprit_node_id":"branch","root_cause":"mismatch","severity":"high"}', payload, payload]
        )
        assert intents == []
    else:
        with pytest.raises(PreflightError):
            apply_native(native_adapter, [intent])
        native_adapter.sync.assert_not_called()


def test_review_r2_successful_run_cannot_authorize_a_terminal_non_if_repair(native_adapter: NativeEvidenceCase) -> None:
    native_adapter.run.status = WorkflowExecutionStatus.SUCCEEDED
    native_adapter.rows[0].status = WorkflowNodeExecutionStatus.FAILED
    # Deliberately malformed persisted status must not authorize a failed-node repair.
    native_adapter.rows[1].status = cast(WorkflowNodeExecutionStatus, "skipped")
    with pytest.raises(PreflightError):
        apply_native(
            native_adapter,
            [
                MutationIntent(
                    op="set_node_config", args={"node_id": "producer", "path": "code", "value": "def main(): return {}"}
                )
            ],
        )
    native_adapter.sync.assert_not_called()


def test_review_r4_known_credential_repeated_as_failure_identity_is_sanitized(
    native_adapter: NativeEvidenceCase,
) -> None:
    from services.dify_builder.agent import llm_agent
    from services.dify_builder.condition_evidence import diagnose_failure

    secret = "credential-repeated-as-node-identity"
    history = native_adapter.run.graph_dict
    for graph in (native_adapter.graph, history):
        graph["nodes"][1]["id"] = secret
        graph["edges"][0]["target"] = secret
    native_adapter.run.graph = json.dumps(history)
    native_adapter.rows[1].node_id = secret
    native_adapter.run.error = 'client_secret="' + secret + '"'
    reply = json.dumps({"culprit_node_id": secret, "root_cause": "mismatch", "severity": "high"})
    model = _RecordingInstance([reply])
    env = Env(
        dify=native_adapter.port,
        agent=llm_agent.LlmBuilderAgent("tenant-1"),
        repo=InMemoryRepository(),
        now=lambda: datetime.min,
    )
    with patch.object(llm_agent, "resolve_model_instance", return_value=model):
        diagnosis = diagnose_failure(env, "app-1", _actor(), Run(dify_run_id="native-run"), native_adapter.graph)
    assert secret not in json.dumps(diagnosis.condition_evidence)
    assert secret not in model.calls[0]["prompt_messages"][1].content
    assert secret not in diagnosis.culprit_node_id


@pytest.mark.parametrize(
    "wrapper", ['error="client_secret=sealed-wrapper-value"', 'payload=client_secret="sealed-wrapper-value"']
)
@pytest.mark.parametrize("source", ["native-error", "upstream-string"])
def test_review_r4_non_sensitive_wrapper_cannot_hide_explicit_inner_credential(
    native_adapter: NativeEvidenceCase, wrapper: str, source: str
) -> None:
    secret = "sealed-wrapper-value"
    history = native_adapter.run.graph_dict
    for graph in (native_adapter.graph, history):
        graph["nodes"][1]["data"]["cases"][0]["conditions"][0]["value"] = secret
    native_adapter.run.graph = json.dumps(history)
    if source == "native-error":
        native_adapter.run.error = wrapper
    else:
        native_adapter.rows[0].outputs = json.dumps({**stored_outputs(native_adapter.rows[0]), "annotation": wrapper})
    diagnosis, _, _, model = _real_context_proposal(native_adapter)
    assert secret not in json.dumps(diagnosis.condition_evidence)
    assert all(secret not in " ".join(message.content for message in call["prompt_messages"]) for call in model.calls)


@pytest.mark.parametrize("boundary", ["proposal", "write"])
def test_review_r2_unregistered_historical_type_cannot_prove_non_if(
    native_adapter: NativeEvidenceCase, boundary: str
) -> None:
    history = native_adapter.run.graph_dict
    history["nodes"][1]["data"]["type"] = "unregistered-native-type"
    native_adapter.run.graph = json.dumps(history)
    replacement = deepcopy(native_adapter.graph["nodes"][0])
    replacement["id"] = "branch"
    native_adapter.graph["nodes"][1] = replacement
    native_adapter.workflow.graph = json.dumps(native_adapter.graph)
    if boundary == "proposal":
        _, intents, _, _ = _real_context_proposal(native_adapter)
        assert intents == []
    else:
        with pytest.raises(PreflightError):
            apply_native(
                native_adapter,
                [
                    MutationIntent(
                        op="set_node_config",
                        args={"node_id": "producer", "path": "code", "value": "def main(): return {}"},
                    )
                ],
            )
        native_adapter.sync.assert_not_called()
