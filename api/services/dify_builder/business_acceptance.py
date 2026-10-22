"""Bounded, explicit business expectations over existing immutable native runs.

The caller supplies a user-confirmed contract, the owned TestInput and persisted
native graph. Pure comparisons infer no expectations from prose and grant no
execution authority. Explicit file checks delegate bounded read-only evidence
to the native storage owner; a filename cannot prove a real document.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from itertools import starmap
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from core.dify_builder.errors import BadRequestError, NotFoundError
from core.dify_builder.models import DifyBuilderContext, Graph, PublicationDecision, Run, Session, TestInput
from services.dify_builder.application.verification import publication_decision
from services.dify_builder.native_docx_evidence import FileAcceptance
from services.dify_builder.revision import executable_graph_revision

Identifier = Annotated[str, Field(min_length=1, max_length=128)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
State = Literal["passed", "failed", "unverified"]

logger = logging.getLogger(__name__)


class _ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AcceptanceCheck(_ContractModel):
    path: tuple[Identifier, ...] = Field(min_length=1, max_length=16)
    operator: Literal["equals", "nonnull", "file"]
    expected: JsonValue = None
    file_type: Literal["docx"] | None = None

    @model_validator(mode="after")
    def check_arguments(self) -> AcceptanceCheck:
        if self.operator == "equals" and "expected" not in self.model_fields_set:
            raise ValueError("Equality requires an explicit expected value")
        if self.operator != "equals" and self.expected is not None:
            raise ValueError("Only equality accepts an expected value")
        if (self.operator == "file") != (self.file_type is not None):
            raise ValueError("File checks require a file type; other checks do not")
        return self


class AcceptanceCase(_ContractModel):
    id: Identifier
    inputs: dict[str, JsonValue]
    checks: tuple[AcceptanceCheck, ...] = Field(min_length=1, max_length=64)
    required_node_types: tuple[Identifier, ...] = Field(default=(), max_length=32)
    required_tool_ids: tuple[Annotated[str, Field(min_length=1, max_length=512)], ...] = Field(
        default=(), max_length=32
    )
    forbidden_node_types: tuple[Identifier, ...] = Field(default=(), max_length=32)
    forbidden_tool_ids: tuple[Annotated[str, Field(min_length=1, max_length=512)], ...] = Field(
        default=(), max_length=32
    )


class BusinessAcceptanceProposal(_ContractModel):
    """Action metadata needs no private lineage; explicit stale identities fail."""

    version: Literal[1] = 1
    task_id: Identifier | None = None
    source_digest: Digest | None = None
    confirmed: bool = Field(strict=True)
    cases: tuple[AcceptanceCase, ...] = Field(min_length=1, max_length=16)


class BusinessAcceptanceContract(_ContractModel):
    version: Literal[1] = 1
    task_id: Identifier
    source_digest: Digest
    confirmed: bool = Field(strict=True)
    cases: tuple[AcceptanceCase, ...] = Field(min_length=1, max_length=16)

    @model_validator(mode="after")
    def bounded_unique_cases(self) -> BusinessAcceptanceContract:
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError("Acceptance case IDs must be unique")
        _digest(self.model_dump(mode="python"))
        if len(self.model_dump_json().encode()) > 65536:
            raise ValueError("Acceptance contract exceeds 64 KiB")
        return self


class CaseAcceptance(_ContractModel):
    """Content-free findings bound to the exact contract, input and native run."""

    case_id: Identifier
    contract_digest: Digest
    input_digest: Digest
    task_id: Identifier
    source_digest: Digest
    run_id: str
    native_run_id: str
    test_input_id: str
    execution_revision: str
    graph_revision: str
    execution_state: Literal["succeeded", "failed", "unknown"]
    state: State
    reasons: tuple[str, ...] = ()


class AcceptanceCoverage(_ContractModel):
    state: State
    uncovered_case_ids: tuple[str, ...]
    failed_case_ids: tuple[str, ...]
    passed_case_ids: tuple[str, ...]


def _digest(value: object) -> str:
    try:
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    except (TypeError, ValueError) as exc:
        raise ValueError("Acceptance data must be finite JSON") from exc
    return hashlib.sha256(encoded).hexdigest()


def contract_digest(contract: BusinessAcceptanceContract) -> str:
    """Stable identity includes all confirmed expectations and task/source lineage."""
    return _digest(contract.model_dump(mode="json"))


def _equal(actual: object, expected: JsonValue) -> bool:
    # Python equates True with 1; a Boolean must not satisfy a numeric oracle.
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(_equal(actual[k], v) for k, v in expected.items())
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(starmap(_equal, zip(actual, expected, strict=True)))
    return actual == expected


def _value(outputs: object, path: tuple[str, ...]) -> tuple[bool, object]:
    value = outputs
    for key in path:
        if not isinstance(value, Mapping) or key not in value:
            return False, None
        value = value[key]
    return True, value


def _aggregate(states: Sequence[State]) -> State:
    return "failed" if "failed" in states else "unverified" if "unverified" in states else "passed"


def evaluate_case(
    contract: BusinessAcceptanceContract,
    *,
    case_id: str,
    run: Run,
    test_input: TestInput,
    native_graph: Graph | None,
    session_id: str,
    task_id: str,
    source_digest: str,
    current_revision: str,
    current_graph_revision: str,
    file_evidence: Callable[[object], FileAcceptance] | None = None,
) -> CaseAcceptance:
    """Evaluate one real case without conflating its outcome with execution status.

    ``native_graph`` must be the persisted graph belonging to ``run``. The
    existing publication policy establishes native execution/revision provenance;
    graph hashing and successful node rows then support invocation requirements.
    Caller ownership checks remain required when loading any referenced object.
    """
    case = next((case for case in contract.cases if case.id == case_id), None)
    if case is None:
        raise ValueError("Unknown acceptance case")
    evidence = run.verification
    reasons: list[str] = []
    states: list[State] = []

    def record(state: State, reason: str) -> None:
        states.append(state)
        reasons.append(reason)

    if not contract.confirmed:
        record("unverified", "contract_unconfirmed")
    if contract.task_id != task_id or contract.source_digest != source_digest:
        record("unverified", "task_source_mismatch")
    if not run.id:
        record("unverified", "builder_run_unbound")
    if test_input.session_id != session_id or not test_input.id or run.inputs_ref != test_input.id:
        record("unverified", "test_input_unbound")
    if _digest(test_input.inputs) != _digest(case.inputs):
        record("unverified", "sample_input_mismatch")
    decision = publication_decision(
        run, session_id=session_id, current_revision=current_revision, current_graph_revision=current_graph_revision
    )
    if not decision.allowed:
        record("unverified", decision.reason)
    if native_graph is None:
        record("unverified", "native_graph_unavailable")
        if evidence is not None and evidence.terminal_outputs is None:
            record("unverified", "terminal_outputs_redacted")
    elif executable_graph_revision(native_graph) != current_graph_revision:
        record("unverified", "native_graph_mismatch")
    summary = evidence.execution_evidence if evidence else None
    if summary and summary.simulated_node_ids:
        record("unverified", "simulated_execution")

    # Unbound or stale observations must not be interpreted as evidence for this
    # case, even if their content happens to match or contradict the contract.
    if not states and evidence is not None and native_graph is not None:
        successful = {row.node_id for row in run.per_node if row.status == "succeeded"}
        executed = set(evidence.executed_node_ids) & successful
        attempted = set(evidence.executed_node_ids) & {
            row.node_id
            for row in run.per_node
            if row.status in {"running", "succeeded", "failed", "exception", "retry", "paused", "stopped"}
        }
        types: set[str] = set()
        tools: set[str] = set()
        forbidden_observed = False
        for node in native_graph.get("nodes", []):
            data = node.get("data", {})
            node_type = str(data.get("type", ""))
            tool_id = f"{data.get('provider_id', '')}/{data.get('tool_name', '')}"
            if node.get("id") in executed:
                types.add(node_type)
                if node_type == "tool":
                    tools.add(tool_id)
            if node.get("id") in attempted and (
                node_type in case.forbidden_node_types or (node_type == "tool" and tool_id in case.forbidden_tool_ids)
            ):
                forbidden_observed = True
        if not set(case.required_node_types) <= types or not set(case.required_tool_ids) <= tools:
            record("failed", "required_invocation_missing")
        if forbidden_observed:
            record("failed", "forbidden_invocation_observed")
        if evidence.terminal_outputs is None:
            record("unverified", "terminal_outputs_unavailable")
        else:
            for check in case.checks:
                present, value = _value(evidence.terminal_outputs, check.path)
                if not present:
                    record("failed", "required_output_missing")
                elif check.operator == "equals":
                    if not _equal(value, check.expected):
                        record("failed", "output_mismatch")
                elif value is None:
                    record("failed", "required_output_null")
                elif check.operator == "file":
                    if file_evidence is None:
                        record("unverified", "file_bytes_unverified")
                    else:
                        file_result = file_evidence(value)
                        record(file_result.state, file_result.reason)
    return CaseAcceptance(
        case_id=case.id,
        contract_digest=contract_digest(contract),
        input_digest=_digest(test_input.inputs),
        task_id=contract.task_id,
        source_digest=contract.source_digest,
        run_id=run.id,
        native_run_id=run.dify_run_id,
        test_input_id=test_input.id,
        execution_revision=evidence.execution_revision if evidence else "",
        graph_revision=evidence.executed_graph_revision if evidence else "",
        execution_state=run.status if run.status in {"succeeded", "failed"} else "unknown",
        state=_aggregate(states),
        reasons=tuple(dict.fromkeys(reasons)),
    )


def evaluate_coverage(
    contract: BusinessAcceptanceContract,
    findings: Sequence[CaseAcceptance],
    *,
    task_id: str,
    source_digest: str,
    current_revision: str,
    current_graph_revision: str,
) -> AcceptanceCoverage:
    """Summarize current required cases; historical/stale findings confer no pass.

    Findings must be loaded from the owned immutable Run references, never
    accepted as client-supplied assertions. The latest supplied eligible finding
    replaces the previous observation for a case, including a new failure.
    """
    eligible: dict[str, CaseAcceptance] = {}
    digest = contract_digest(contract)
    if contract.confirmed and contract.task_id == task_id and contract.source_digest == source_digest:
        for finding in findings:
            case = next((case for case in contract.cases if case.id == finding.case_id), None)
            if (
                case is not None
                and finding.contract_digest == digest
                and finding.input_digest == _digest(case.inputs)
                and finding.task_id == task_id
                and finding.source_digest == source_digest
                and finding.execution_revision == current_revision
                and finding.graph_revision == current_graph_revision
                and current_revision
                and current_graph_revision
            ):
                eligible[case.id] = finding
    passed = tuple(case.id for case in contract.cases if case.id in eligible and eligible[case.id].state == "passed")
    failed = tuple(case.id for case in contract.cases if case.id in eligible and eligible[case.id].state == "failed")
    uncovered = tuple(case.id for case in contract.cases if case.id not in passed and case.id not in failed)
    return AcceptanceCoverage(
        state="failed" if failed else "unverified" if uncovered else "passed",
        uncovered_case_ids=uncovered,
        failed_case_ids=failed,
        passed_case_ids=passed,
    )


def current_task_id(session: Session, context: DifyBuilderContext) -> str:
    """Capture the initial task boundary once; later repair checkpoints are not new tasks."""
    return context.business_acceptance_task_id or f"{session.id}:{context.checkpoint_seq}"


def current_source_digest(context: DifyBuilderContext) -> str:
    """Hash exact user task sources; never derive business expectations from prose."""
    return _digest(
        {"goal_text": context.goal_text, "requirements": context.requirements, "edit_rules": context.edit_rules}
    )


def confirm_testdata_contract(
    session: Session, context: DifyBuilderContext, payload: dict[str, object], inputs: dict[str, object]
) -> None:
    """Admit only explicit top-level action metadata, independently of Start inputs.

    A successful existing provide_testdata action is the user's confirmation.
    Supplied task/source identities are checked against server-owned state. No
    metadata means no new contract or inferred expected values. Omitting a case
    clears only the active case selection, never the confirmed required cases.
    """
    supplied = "business_acceptance_contract" in payload
    raw = payload.get("business_acceptance_contract") if supplied else context.business_acceptance_contract
    case_id = payload.get("acceptance_case_id", "")
    if not raw:
        if supplied or case_id:
            raise BadRequestError("An explicit acceptance case requires a confirmed business contract")
        context.business_acceptance_case_id = ""
        return
    try:
        if supplied:
            proposal = BusinessAcceptanceProposal.model_validate(raw)
            identities = {"task_id": current_task_id(session, context), "source_digest": current_source_digest(context)}
            if ("task_id" in proposal.model_fields_set and proposal.task_id != identities["task_id"]) or (
                "source_digest" in proposal.model_fields_set and proposal.source_digest != identities["source_digest"]
            ):
                raise BadRequestError("Business acceptance contract does not match the current confirmed task")
            # Stamp omitted lineage after normal action version admission. Keep
            # nested explicit null expectations intact during JSON conversion.
            proposed = proposal.model_dump(mode="json") | identities
            contract = BusinessAcceptanceContract.model_validate(proposed)
        else:
            contract = BusinessAcceptanceContract.model_validate(raw)
    except ValueError as exc:
        raise BadRequestError("Invalid business acceptance contract") from exc
    if (
        not contract.confirmed
        or contract.task_id != current_task_id(session, context)
        or contract.source_digest != current_source_digest(context)
    ):
        raise BadRequestError("Business acceptance contract does not match the current confirmed task")
    if not isinstance(case_id, str) or (supplied and not case_id):
        raise BadRequestError("Select an explicit acceptance case for the confirmed contract")
    if case_id:
        case = next((case for case in contract.cases if case.id == case_id), None)
        if case is None or _digest(case.inputs) != _digest(inputs):
            raise BadRequestError("Test inputs do not match the selected acceptance case")
    previous = context.business_acceptance_contract
    if not previous or contract_digest(contract) != contract_digest(
        BusinessAcceptanceContract.model_validate(previous)
    ):
        context.business_acceptance_run_refs = {}
    context.business_acceptance_task_id = contract.task_id
    context.business_acceptance_contract = contract.model_dump(mode="json")
    context.business_acceptance_case_id = case_id


def record_run_acceptance(
    session: Session,
    context: DifyBuilderContext,
    run: Run,
    test_input: TestInput | None,
    graph: Graph | None,
    execution_revision: str,
) -> None:
    """Attach one deterministic finding before the existing immutable Run is saved.

    No execution or replay occurs here. Explicit file checks may read bounded
    bytes through the tenant-owned native storage owner. Redacted/unknown outputs
    remain unverified. A new attempted case replaces its previous Run reference.
    """
    if not context.business_acceptance_contract or not context.business_acceptance_case_id:
        return
    context.business_acceptance_run_refs[context.business_acceptance_case_id] = run.id
    if run.verification is None or test_input is None:
        return
    try:
        contract = BusinessAcceptanceContract.model_validate(context.business_acceptance_contract)
        file_evidence = None
        if (
            graph is not None
            and session.tenant_id
            and any(check.operator == "file" for case in contract.cases for check in case.checks)
        ):
            from services.dify_builder.native_docx_evidence import native_docx_evaluator

            file_evidence = native_docx_evaluator(tenant_id=session.tenant_id, run=run, native_graph=graph)
        finding = evaluate_case(
            contract,
            case_id=context.business_acceptance_case_id,
            run=run,
            test_input=test_input,
            native_graph=graph,
            session_id=session.id,
            task_id=current_task_id(session, context),
            source_digest=current_source_digest(context),
            current_revision=execution_revision,
            current_graph_revision=(
                executable_graph_revision(graph) if graph is not None else run.verification.executed_graph_revision
            ),
            file_evidence=file_evidence,
        )
        run.verification.business_acceptance = finding.model_dump(mode="json")
    except ValueError as exc:
        # Malformed persisted contract/JSON is an annotation failure, never a
        # reason to discard a completed native run or dispatch it again.
        logger.warning("Business acceptance annotation unavailable (run=%s reason=%s)", run.id, type(exc).__name__)
        run.verification.business_acceptance = {"state": "unverified", "reasons": ["acceptance_annotation_unavailable"]}


def context_publication_decision(
    run: Run | None,
    session: Session,
    context: DifyBuilderContext,
    *,
    current_revision: str,
    current_graph_revision: str,
    load_run: Callable[[str], Run],
) -> PublicationDecision:
    """Shared view/action gate over owned immutable evidence, with no execution.

    Explicit contracts opt in to required-case coverage. Legacy contexts still
    expose execution-only eligibility and explicitly unverified goal acceptance.
    The caller's repository callback must load authorized session Run references.
    """
    decision = publication_decision(
        run, session_id=session.id, current_revision=current_revision, current_graph_revision=current_graph_revision
    )
    if not decision.allowed or not context.business_acceptance_contract:
        return decision
    try:
        contract = BusinessAcceptanceContract.model_validate(context.business_acceptance_contract)
        findings = []
        for case_id, run_id in context.business_acceptance_run_refs.items():
            with suppress(NotFoundError):
                case_run = load_run(run_id)
                if not publication_decision(
                    case_run,
                    session_id=session.id,
                    current_revision=current_revision,
                    current_graph_revision=current_graph_revision,
                ).allowed:
                    continue
                evidence = case_run.verification
                if evidence is None or not evidence.business_acceptance:
                    continue
                finding = CaseAcceptance.model_validate(evidence.business_acceptance)
                if (
                    finding.case_id == case_id
                    and finding.run_id == case_run.id == run_id
                    and finding.native_run_id == case_run.dify_run_id
                    and finding.test_input_id == case_run.inputs_ref
                ):
                    findings.append(finding)
        coverage = evaluate_coverage(
            contract,
            findings,
            task_id=current_task_id(session, context),
            source_digest=current_source_digest(context),
            current_revision=current_revision,
            current_graph_revision=current_graph_revision,
        )
    except ValueError:
        return PublicationDecision(allowed=False, reason="business_acceptance_unverified")
    if coverage.state != "passed":
        return PublicationDecision(
            allowed=False,
            reason="business_acceptance_failed" if coverage.state == "failed" else "business_acceptance_unverified",
        )
    return decision


def clear_task_acceptance(context: DifyBuilderContext) -> None:
    """Only actual new-request owners clear authority; graph repairs retain it."""
    context.business_acceptance_contract = {}
    context.business_acceptance_task_id = ""
    context.business_acceptance_case_id = ""
    context.business_acceptance_run_refs = {}
