from dataclasses import replace

import pytest
import pytest_mock
from pydantic import ValidationError

from core.dify_builder.models import Graph, NodeOutput, Run, RunVerification
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.verification import result_card


def summary() -> ExecutionEvidenceSummary:
    return ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="native_failed",
        sandbox_profile="native",
        native_run_id="native",
        failure_phase="execution",
        failure_reason="service_unavailable",
        failure_resource=("model", "langgenius/anthropic/anthropic", "claude-opus-4-8"),
        failure_node_ids=("llm",),
    )


def test_runtime_service_failure_card_retains_native_run_and_specific_node() -> None:
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    run = Run(
        status="failed",
        dify_run_id="native",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["start", "llm"],
            no_output_dead_branch=False,
            execution_evidence=summary(),
        ),
    )
    card = result_card(run)
    assert card.outcome == "execution_failed"
    assert card.failure_phase == "execution"
    assert card.failure_node_ids == ["llm"]
    assert card.dify_run_id == "native"
    assert "Plugin service" in english_text(card.failure_reason)
    assert "claude-opus-4-8" in english_text(card.failure_reason)


@pytest.mark.parametrize("variant", ["unsealed", "unknown", "no_native"])
def test_runtime_failure_cannot_claim_unknown_or_missing_native_evidence(variant: str) -> None:
    value = {
        "sealed": variant != "unsealed",
        "safety_outcome": "execution_evidence_unknown" if variant == "unknown" else "native_failed",
        "native_run_id": None if variant == "no_native" else "native",
    }
    with pytest.raises(ValidationError):
        ExecutionEvidenceSummary.model_validate(
            {
                "request_id": "request",
                "policy_version": "builder-confirmed-run-v1",
                "mode": "confirmed_run",
                "sandbox_profile": "native",
                "failure_phase": "execution",
                "failure_reason": "service_unavailable",
                "failure_node_ids": ["llm"],
                **value,
            }
        )


def test_runtime_attribution_uses_failed_native_resource_not_code_error_text() -> None:
    from services.dify_builder.native_runtime_failure import plugin_service_failure

    graph = {
        "nodes": [
            {
                "id": "llm",
                "data": {
                    "type": "llm",
                    "model": {"provider": "langgenius/anthropic/anthropic", "name": "claude-opus-4-8"},
                },
            }
        ]
    }
    run = Run(
        status="failed",
        dify_run_id="native",
        per_node=[NodeOutput(node_id="llm", status="failed", error="Request to Plugin Daemon Service failed-500")],
    )
    assert plugin_service_failure(run, graph) == (
        ("model", "langgenius/anthropic/anthropic", "claude-opus-4-8"),
        ("llm",),
    )
    assert plugin_service_failure(replace(run, status="running"), graph) is None
    assert plugin_service_failure(run, {"nodes": [{"id": "llm", "data": {"type": "code"}}]}) is None


@pytest.mark.parametrize("flow", ["build", "edit", "fix"])
@pytest.mark.parametrize(
    "reason",
    [
        "service_unavailable",
        "authentication",
        "permission_denied",
        "credential_unavailable",
        "authorization_lookup_failed",
    ],
)
def test_known_plugin_outage_does_not_ask_llm_to_rewrite_graph(
    flow: str, reason: str, mocker: pytest_mock.MockerFixture
) -> None:
    import importlib

    from core.dify_builder.models import Turn
    from core.dify_builder.state import PcState
    from tests.unit_tests.core.dify_builder.fakes import saved_test_context

    helpers = importlib.import_module(f"tests.unit_tests.core.dify_builder.test_handlers_{flow}")
    env, repo = helpers._new_env()
    state = {
        "build": PcState.BUILD_TEST_AND_REPAIR,
        "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
        "fix": PcState.FIX_VERIFY,
    }[flow]
    session = helpers._session(current_state=state)
    context = saved_test_context(repo, session.id)
    preparation = reason in {"credential_unavailable", "authorization_lookup_failed"}
    evidence = summary().model_dump()
    evidence["failure_reason"] = reason
    if preparation:
        evidence.update(safety_outcome="preparation_failed", native_run_id=None, failure_phase="preparation")
    raw = Run(
        status="failed",
        dify_run_id="" if preparation else "native",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["llm"],
            no_output_dead_branch=False,
            execution_evidence=ExecutionEvidenceSummary.model_validate(evidence),
        ),
    )
    mocker.patch.object(env.dify, "run_draft", return_value=raw)
    mocker.patch.object(env.agent, "diagnose", side_effect=AssertionError("infrastructure is not a graph bug"))
    mocker.patch.object(env.agent, "propose_repair", side_effect=AssertionError("infrastructure is not a graph bug"))
    handler = {
        "build": handlers_build.handle_test_and_repair,
        "edit": handlers_edit.handle_test_affected_paths,
        "fix": handlers_fix.handle_verify,
    }[flow]
    result = handler(env, Turn(actor=helpers._actor()), session, context)
    assert result.context is not None
    assert not result.context.staged_repair
    assert result.run is not None
    assert result.run.dify_run_id == ("" if preparation else "native")
    assert result.next not in {PcState.BUILD_REVIEW, PcState.EDIT_REVIEW}
    env.agent.diagnose.assert_not_called()
    env.agent.propose_repair.assert_not_called()


def native_auth_error(status: int, category: str, *, kind: str = "models") -> str:
    """Synthetic native adapter envelope, matching the observed 401 structure."""
    import json

    description = f"[{kind}] Error: Error with status code {status}: " + json.dumps(
        {"error": {"type": category, "message": "PRIVATE_PROVIDER_BODY", "code": "invalid_api_key"}}
    )
    return "Run failed: PluginInvokeError: " + json.dumps(
        {"args": {"description": description, "traceback": "PRIVATE_TRACEBACK"}, "error_type": "InvokeError"}
    )


@pytest.mark.parametrize(
    ("status", "category", "reason"),
    [(401, "authentication_error", "authentication"), (403, "permission_denied", "permission_denied")],
)
@pytest.mark.parametrize("kind", ["model", "tool"])
def test_terminal_native_resource_auth_attribution(status: int, category: str, reason: str, kind: str) -> None:
    from services.dify_builder.native_runtime_failure import native_resource_failure

    data = (
        {"type": "llm", "model": {"provider": "provider", "name": "model"}}
        if kind == "model"
        else {"type": "tool", "provider_type": "builtin", "provider_id": "provider", "tool_name": "action"}
    )
    run = Run(
        status="failed",
        dify_run_id="native",
        per_node=[
            NodeOutput(
                node_id="exact",
                status="failed",
                error=native_auth_error(status, category, kind="models" if kind == "model" else "tools"),
            )
        ],
    )
    assert native_resource_failure(run, {"nodes": [{"id": "exact", "data": data}, {"id": "other", "data": data}]}) == (
        (kind, "provider", "model" if kind == "model" else "action"),
        ("exact",),
        reason,
    )


@pytest.mark.parametrize(
    "variant", ["code", "unknown", "missing_native", "ambiguous", "missing_graph", "wrong_category", "plain_text"]
)
def test_auth_classification_rejects_unproven_or_ambiguous_native_errors(variant: str) -> None:
    from services.dify_builder.native_runtime_failure import native_resource_failure

    error = native_auth_error(401, "permission_denied" if variant == "wrong_category" else "authentication_error")
    if variant == "plain_text":
        error = "user code says status code 401 authentication_error"
    run = Run(
        status="running" if variant == "unknown" else "failed",
        dify_run_id="" if variant == "missing_native" else "native",
        per_node=[NodeOutput(node_id="exact", status="failed", error=error)],
    )
    if variant == "ambiguous":
        run.per_node.append(NodeOutput(node_id="other", status="failed", error=error))
    data = (
        {"type": "code"} if variant == "code" else {"type": "llm", "model": {"provider": "provider", "name": "model"}}
    )
    graph: Graph = {"nodes": [] if variant == "missing_graph" else [{"id": "exact", "data": data}]}
    assert native_resource_failure(run, graph) is None


@pytest.mark.parametrize("reason", ["authentication", "permission_denied"])
def test_resource_auth_card_has_localized_setup_guidance_and_sanitized_builder_run(reason: str) -> None:
    from services.dify_builder.execution_messages import native_service_failure, sanitize_observed_failure
    from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

    evidence = summary().model_copy(update={"failure_reason": reason})
    run = Run(
        status="failed",
        dify_run_id="native",
        error="PRIVATE_TRACEBACK",
        per_node=[NodeOutput(node_id="llm", status="failed", error="PRIVATE_PROVIDER_BODY")],
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["llm"],
            no_output_dead_branch=False,
            execution_evidence=evidence,
        ),
    )
    projected = sanitize_observed_failure(run)
    assert native_service_failure(projected)
    assert "PRIVATE" not in projected.error
    assert "PRIVATE" not in projected.per_node[0].error
    assert run.error == "PRIVATE_TRACEBACK"
    card = result_card(projected)
    rendered = english_text(card.failure_reason)
    assert "credential" in rendered.lower() or "permission" in rendered.lower()
    assert "claude-opus-4-8" in rendered
    from services.dify_builder.execution_messages import observed_failure_message

    chinese = observed_failure_message(evidence, reply_language="zh-CN")
    assert isinstance(chinese, str)
    assert "凭据" in chinese or "权限" in chinese


@pytest.mark.parametrize("variant", ["unsealed", "wrong_native", "unknown"])
def test_sanitizer_does_not_reclassify_unsealed_mismatched_or_unknown_runs(variant: str) -> None:
    from services.dify_builder.execution_messages import native_service_failure, sanitize_observed_failure

    evidence = summary().model_copy(
        update={
            "failure_reason": "authentication",
            "sealed": variant != "unsealed",
            "native_run_id": "different" if variant == "wrong_native" else "native",
            "safety_outcome": "execution_evidence_unknown" if variant == "unknown" else "native_failed",
        }
    )
    run = Run(
        status="failed",
        dify_run_id="native",
        error="original",
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["llm"],
            no_output_dead_branch=False,
            execution_evidence=evidence,
        ),
    )
    assert not native_service_failure(run)
    assert sanitize_observed_failure(run).error == "original"


def test_observed_native_request_id_envelope_is_classified() -> None:
    from services.dify_builder.native_runtime_failure import _native_reason

    error = "req_id: abc12345678 " + native_auth_error(401, "authentication_error").removeprefix("Run failed: ")
    assert _native_reason(error, "model") == "authentication"


@pytest.mark.parametrize("node_type", ["llm", "code"])
def test_stream_sanitization_requires_exact_resource_node_and_preserves_code(node_type: str) -> None:
    from services.dify_builder.execution_messages import sanitize_resource_failure_event

    error = native_auth_error(401, "authentication_error")
    graph = {"nodes": [{"id": "node", "data": {"type": node_type, "model": {"provider": "provider", "name": "model"}}}]}
    payload = {
        "event": "node_finished",
        "workflow_run_id": "native",
        "data": {"node_id": "node", "status": "failed", "error": error, "outputs": {"answer": "kept"}},
    }
    recognized: dict[str, str] = {}
    safe = sanitize_resource_failure_event(payload, graph=graph, recognized_errors=recognized)
    assert safe["data"]["outputs"] == {"answer": "kept"}
    assert safe["data"]["node_id"] == "node"
    assert payload["data"]["error"] == error
    terminal = {
        "event": "workflow_finished",
        "workflow_run_id": "native",
        "data": {"id": "native", "status": "failed", "error": error},
    }
    safe_terminal = sanitize_resource_failure_event(terminal, graph=graph, recognized_errors=recognized)
    if node_type == "llm":
        assert "PRIVATE" not in safe["data"]["error"]
        assert "PRIVATE" not in safe_terminal["data"]["error"]
        assert "provider/model" in safe["data"]["error"]
    else:
        assert safe == payload
        assert safe_terminal == terminal


@pytest.mark.parametrize("variant", ["no_run", "other_node", "succeeded", "unmatched_terminal"])
def test_stream_sanitizer_preserves_unattributed_error(variant: str) -> None:
    from services.dify_builder.execution_messages import sanitize_resource_failure_event

    payload = {
        "event": "workflow_finished" if variant == "unmatched_terminal" else "node_finished",
        "workflow_run_id": "" if variant == "no_run" else "native",
        "data": {
            "node_id": "other" if variant == "other_node" else "node",
            "status": "succeeded" if variant == "succeeded" else "failed",
            "error": native_auth_error(401, "authentication_error"),
        },
    }
    graph = {"nodes": [{"id": "node", "data": {"type": "llm", "model": {"provider": "provider", "name": "model"}}}]}
    assert sanitize_resource_failure_event(payload, graph=graph, recognized_errors={}) == payload


def test_native_resource_metadata_cannot_echo_provider_urls() -> None:
    from services.dify_builder.native_runtime_failure import native_resource_failure

    run = Run(
        status="failed",
        dify_run_id="native",
        per_node=[NodeOutput(node_id="llm", status="failed", error=native_auth_error(401, "authentication_error"))],
    )
    graph = {
        "nodes": [
            {"id": "llm", "data": {"type": "llm", "model": {"provider": "https://private.example", "name": "model"}}}
        ]
    }
    assert native_resource_failure(run, graph) is None
