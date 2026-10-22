"""Acceptance must never equate a successful error branch with the requested business result."""

from collections.abc import Callable, Sequence
from typing import NoReturn

import pytest
from pydantic import ValidationError

from core.dify_builder.models import Graph, NodeOutput, Run, TestInput
from services.dify_builder.business_acceptance import (
    AcceptanceCoverage,
    BusinessAcceptanceContract,
    CaseAcceptance,
)
from services.dify_builder.native_docx_evidence import FileAcceptance
from services.dify_builder.revision import executable_graph_revision
from tests.unit_tests.core.dify_builder.test_verification import verified

GRAPH: Graph = {
    "nodes": [
        {
            "id": "json",
            "data": {"type": "tool", "provider_id": "langgenius/json_process/json_process", "tool_name": "parse"},
        },
        {"id": "stats", "data": {"type": "code"}},
        {"id": "end", "data": {"type": "end"}},
    ],
    "edges": [],
}
GRAPH_REV = executable_graph_revision(GRAPH)


def contract(**changes: object) -> BusinessAcceptanceContract:
    from services.dify_builder.business_acceptance import BusinessAcceptanceContract

    data = {
        "task_id": "task-1",
        "source_digest": "a" * 64,
        "confirmed": True,
        "cases": [
            {
                "id": "paid",
                "inputs": {
                    "orders": (
                        '[{"status":"paid","amount":100},'
                        '{"status":"paid","amount":250},'
                        '{"status":"cancelled","amount":50}]'
                    )
                },
                "checks": [
                    {"path": ["paid_count"], "operator": "equals", "expected": 2},
                    {"path": ["paid_total"], "operator": "equals", "expected": 350},
                ],
                "required_node_types": ["code"],
                "required_tool_ids": ["langgenius/json_process/json_process/parse"],
            }
        ],
    }
    return BusinessAcceptanceContract.model_validate(data | changes)


def observation(outputs: dict[str, object] | None = None) -> tuple[Run, TestInput]:
    c = contract()
    ti = TestInput(id="input-paid", session_id="s", inputs=c.cases[0].inputs)
    run = verified()
    run.inputs_ref = ti.id
    assert run.verification is not None
    run.verification.executed_graph_revision = GRAPH_REV
    run.verification.terminal_outputs = {"paid_count": 2, "paid_total": 350} if outputs is None else outputs
    run.verification.executed_node_ids = ["json", "stats", "end"]
    run.per_node = [NodeOutput(node_id=n, status="succeeded") for n in ["json", "stats", "end"]]
    return run, ti


def evaluate(
    c: BusinessAcceptanceContract | None = None,
    run: Run | None = None,
    ti: TestInput | None = None,
    *,
    file_evidence: Callable[[object], FileAcceptance] | None = None,
) -> CaseAcceptance:
    from services.dify_builder.business_acceptance import evaluate_case

    default_run, default_input = observation()
    return evaluate_case(
        c or contract(),
        case_id="paid",
        run=run or default_run,
        test_input=ti or default_input,
        native_graph=GRAPH,
        session_id="s",
        task_id="task-1",
        source_digest="a" * 64,
        current_revision="rev",
        current_graph_revision=GRAPH_REV,
        file_evidence=file_evidence,
    )


def coverage(
    c: BusinessAcceptanceContract,
    findings: Sequence[CaseAcceptance],
    *,
    task_id: str = "task-1",
    source_digest: str = "a" * 64,
    current_revision: str = "rev",
    current_graph_revision: str = GRAPH_REV,
) -> AcceptanceCoverage:
    from services.dify_builder.business_acceptance import evaluate_coverage

    return evaluate_coverage(
        c,
        findings,
        task_id=task_id,
        source_digest=source_digest,
        current_revision=current_revision,
        current_graph_revision=current_graph_revision,
    )


def test_exact_paid_outputs_and_real_required_invocations_pass() -> None:
    result = evaluate()
    assert result.state == "passed"
    assert result.run_id == "r"
    assert result.test_input_id == "input-paid"
    assert coverage(contract(), [result]).state == "passed"


@pytest.mark.parametrize(
    "outputs",
    [
        {"error": "invalid JSON"},
        {"paid_count": 3, "paid_total": 400},
        {"paid_count": None, "paid_total": 350},
        {"paid_count": True, "paid_total": 350},
    ],
)
def test_successful_execution_with_wrong_missing_null_or_boolean_outputs_fails(outputs: dict[str, object]) -> None:
    run, ti = observation(outputs)
    result = evaluate(run=run, ti=ti)
    assert run.status == "succeeded"
    assert result.state == "failed"


def test_invalid_json_input_cannot_satisfy_valid_paid_case_even_with_expected_outputs() -> None:
    run, ti = observation()
    assert run.verification is not None
    ti.inputs = {"orders": "not-json"}
    result = evaluate(run=run, ti=ti)
    assert result.state == "unverified"
    assert "sample_input_mismatch" in result.reasons


@pytest.mark.parametrize("field", ["execution_revision", "executed_graph_revision"])
def test_stale_native_revision_remains_unverified(field: str) -> None:
    run, ti = observation()
    assert run.verification is not None
    setattr(run.verification, field, "old")
    assert evaluate(run=run, ti=ti).state == "unverified"


def test_simulated_required_tool_never_passes_business_acceptance() -> None:
    run, ti = observation()
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    run.verification.execution_evidence = run.verification.execution_evidence.model_copy(
        update={"simulated_node_ids": ("json",)}
    )
    assert evaluate(run=run, ti=ti).state == "unverified"


def test_required_tool_presence_without_execution_fails() -> None:
    run, ti = observation()
    assert run.verification is not None
    run.verification.executed_node_ids.remove("json")
    run.per_node = [row for row in run.per_node if row.node_id != "json"]
    assert evaluate(run=run, ti=ti).state == "failed"


def test_missing_required_case_is_uncovered_and_blocks_coverage() -> None:
    c = contract(
        cases=[
            *contract().model_dump(mode="json")["cases"],
            {"id": "invalid", "inputs": {"orders": "not-json"}, "checks": [{"path": ["error"], "operator": "nonnull"}]},
        ]
    )
    result = evaluate(c=c)
    summary = coverage(c, [result])
    assert summary.state == "unverified"
    assert summary.uncovered_case_ids == ("invalid",)


def test_changed_contract_or_task_does_not_reuse_historical_success() -> None:
    result = evaluate()
    changed = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["paid_total"], "operator": "equals", "expected": 999}],
            }
        ]
    )
    assert coverage(changed, [result]).state == "unverified"
    assert coverage(contract(), [result], task_id="replacement").state == "unverified"
    assert coverage(contract(), [result], source_digest="b" * 64).state == "unverified"
    assert coverage(contract(), [result], current_revision="new").state == "unverified"
    assert coverage(contract(), [result], current_graph_revision="new").state == "unverified"


def test_docx_filename_is_unverified_without_storage_byte_evidence() -> None:
    c = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["document"], "operator": "file", "file_type": "docx"}],
            }
        ]
    )
    run, ti = observation({"document": {"filename": "report.docx", "url": "https://example.com/report.docx"}})
    result = evaluate(c=c, run=run, ti=ti)
    assert result.state == "unverified"
    assert "file_bytes_unverified" in result.reasons


@pytest.mark.parametrize("value", [None, {}])
def test_required_nonnull_value_fails_when_null_or_absent(value: dict[str, object] | None) -> None:
    c = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["report"], "operator": "nonnull"}],
            }
        ]
    )
    run, ti = observation({"report": value} if value is None else {})
    assert evaluate(c=c, run=run, ti=ti).state == "failed"


def test_unconfirmed_contract_is_not_authority() -> None:
    assert evaluate(c=contract(confirmed=False)).state == "unverified"


def test_foreign_input_or_run_reference_is_not_authority() -> None:
    run, ti = observation()
    assert run.verification is not None
    ti.session_id = "foreign"
    assert evaluate(run=run, ti=ti).state == "unverified"
    ti.session_id = "s"
    run.inputs_ref = "another-input"
    assert evaluate(run=run, ti=ti).state == "unverified"


def test_forbidden_external_execution_fails_even_on_expected_outputs() -> None:
    c = contract(cases=[contract().cases[0].model_dump(mode="json") | {"forbidden_node_types": ["tool"]}])
    assert evaluate(c=c).state == "failed"


def test_contract_rejects_duplicate_cases_and_empty_checks() -> None:
    with pytest.raises(ValidationError):
        contract(cases=[contract().cases[0].model_dump(mode="json")] * 2)
    with pytest.raises(ValidationError):
        contract(cases=[{"id": "paid", "inputs": {}, "checks": []}])


def test_nonnull_contract_survives_persisted_json_roundtrip() -> None:
    c = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["paid_count"], "operator": "nonnull"}],
            }
        ]
    )
    restored = type(c).model_validate_json(c.model_dump_json())
    assert evaluate(c=restored).state == "passed"


def test_latest_failed_rerun_replaces_previous_case_pass() -> None:
    passed = evaluate()
    run, ti = observation({"paid_count": 9, "paid_total": 350})
    failed = evaluate(run=run, ti=ti)
    assert coverage(contract(), [passed, failed]).state == "failed"


def test_missing_immutable_builder_run_id_is_unverified() -> None:
    run, ti = observation()
    assert run.verification is not None
    run.id = ""
    assert evaluate(run=run, ti=ti).state == "unverified"


def test_failed_forbidden_tool_invocation_cannot_hide_in_successful_error_branch() -> None:
    c = contract(
        cases=[
            contract().cases[0].model_dump(mode="json") | {"required_tool_ids": [], "forbidden_node_types": ["tool"]}
        ]
    )
    run, ti = observation()
    assert run.verification is not None
    run.per_node[0].status = "failed"
    result = evaluate(c=c, run=run, ti=ti)
    assert result.state == "failed"
    assert "forbidden_invocation_observed" in result.reasons


def test_real_owned_docx_byte_evidence_satisfies_explicit_file_expectation() -> None:
    from services.dify_builder.native_docx_evidence import StoredToolFile, validate_native_docx
    from tests.unit_tests.services.dify_builder.test_native_docx_evidence import FILE_ID, KEY, TENANT, docx, native_file

    c = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["document"], "operator": "file", "file_type": "docx"}],
            }
        ]
    )
    value = native_file()
    run, ti = observation({"document": [value]})
    run.per_node[0] = NodeOutput(node_id="json", status="succeeded", outputs={"files": [value]}, outputs_available=True)
    blob = docx()

    def files(actual: object) -> FileAcceptance:
        return validate_native_docx(
            actual,
            tenant_id=TENANT,
            run=run,
            native_graph=GRAPH,
            lookup_file=lambda _tenant, _id: StoredToolFile(FILE_ID, TENANT, KEY, len(blob)),
            load_stream=lambda _key: iter([blob]),
        )

    result = evaluate(c=c, run=run, ti=ti, file_evidence=files)
    assert result.state == "passed"
    assert "docx_bytes_validated" in result.reasons
    assert coverage(c, [result]).state == "passed"


def test_file_evidence_is_not_read_for_unbound_or_stale_native_run() -> None:
    c = contract(
        cases=[
            {
                "id": "paid",
                "inputs": contract().cases[0].inputs,
                "checks": [{"path": ["document"], "operator": "file", "file_type": "docx"}],
            }
        ]
    )
    run, ti = observation({"document": {"filename": "report.docx"}})
    assert run.verification is not None
    run.verification.execution_revision = "stale"

    def forbidden_read(_value: object) -> NoReturn:
        raise AssertionError("Stale evidence must not trigger a storage read")

    assert evaluate(c=c, run=run, ti=ti, file_evidence=forbidden_read).state == "unverified"
