"""Credential observations change display guidance, never execution provenance."""

import importlib
import json
from collections.abc import Callable

import pytest

from core.dify_builder.models import Actor, Graph, Inputs, NodeEvent, NodeOutput, Run, RunVerification, Turn
from core.dify_builder.state import PcState
from core.tools.errors import ToolProviderCredentialValidationError
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from services.dify_builder import trace_diagnostics
from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
from services.dify_builder.application.verification import result_card
from services.enterprise.plugin_manager_service import CredentialPolicyViolationError
from tests.unit_tests.core.dify_builder.fakes import saved_test_context
from tests.unit_tests.services.dify_builder.presentation_helpers import english_text

GLOBAL_ERROR = "Failed to get tool runtime: Credentials not available: Please use ENTERPRISE global credentials"
TOOL_GRAPH: Graph = {
    "nodes": [
        {
            "id": "search",
            "data": {
                "type": "tool",
                "title": "LLM model",
                "provider_type": "builtin",
                "provider_id": "langgenius/google/google",
                "tool_name": "google_search",
            },
        }
    ],
    "edges": [],
}


@pytest.mark.parametrize("flow", ["build", "edit", "fix"])
@pytest.mark.parametrize("reply_language", ["en-US", "zh-CN"])
def test_handler_attributes_global_credentials_to_exact_failed_tool(
    flow: str, reply_language: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    helpers = importlib.import_module(f"tests.unit_tests.core.dify_builder.test_handlers_{flow}")
    env, repo = helpers._new_env()
    env.fake_dify.graph = TOOL_GRAPH
    session = helpers._session(
        current_state={
            "build": PcState.BUILD_TEST_AND_REPAIR,
            "edit": PcState.EDIT_TEST_AFFECTED_PATHS,
            "fix": PcState.FIX_VERIFY,
        }[flow]
    )
    context = saved_test_context(repo, session.id, reply_language=reply_language)
    raw = credential_run()
    assert raw.verification is not None
    assert raw.verification.execution_evidence is not None
    original_evidence = raw.verification.execution_evidence.model_dump()
    calls = []

    def run_draft(
        app_id: str, actor: Actor, inputs: Inputs, on_event: Callable[[NodeEvent], None], **kwargs: object
    ) -> Run:
        del on_event
        assert app_id == session.app_id
        assert actor == helpers._actor()
        assert kwargs["test_input_id"] == context.test_input_ref
        calls.append((app_id, inputs))
        return raw

    monkeypatch.setattr(env.dify, "run_draft", run_draft)
    handler = {
        "build": handlers_build.handle_test_and_repair,
        "edit": handlers_edit.handle_test_affected_paths,
        "fix": handlers_fix.handle_verify,
    }[flow]
    result = handler(env, Turn(actor=helpers._actor()), session, context)
    card = next(item for item in result.items if item.kind == "test_result")
    assistant = next(item for item in result.items if item.kind == "assistant_turn")
    rendered = english_text(card.payload["failure_reason"]) + english_text(assistant.payload["reply_text"])
    assert "langgenius/google/google/google_search" in rendered
    assert "search" in rendered
    if reply_language.startswith("zh"):
        assert "工具" in rendered
        assert "企业全局凭据" in rendered
    else:
        assert "Tool" in rendered
        assert "enterprise global credential" in rendered
    assert "model-configuration" not in rendered.lower()
    assert result.context is not None
    assert result.context.staged_repair == []
    assert not any(item.kind == "change_set" for item in result.items)
    assert result.run is not None
    assert result.run.status == "failed"
    assert result.run.dify_run_id == "native"
    assert result.run.verification is not None
    assert result.run.verification.execution_evidence is not None
    assert result.run.verification.execution_evidence.model_dump() == original_evidence
    assert len(calls) == 1
    assert raw.error == GLOBAL_ERROR
    assert result_card(raw).safety_outcome == card.payload["safety_outcome"]


@pytest.mark.parametrize(
    "error",
    [
        GLOBAL_ERROR,
        "credential unavailable token=SECRET_CANARY",
        "Tool provider google does not exist token=SECRET_CANARY",
        "HTTP provider not configured token=SECRET_CANARY",
    ],
)
def test_bare_credentials_and_tool_providers_are_not_model_configuration(error: str) -> None:
    run = Run(status="failed", per_node=[NodeOutput(node_id="search", status="failed", error=error)])
    assert handlers_fix.model_config_error_text(run) is None


@pytest.mark.parametrize(
    ("failure", "reason", "scope"),
    [
        (ToolProviderCredentialValidationError("token=SECRET_CANARY"), "credential_unavailable", None),
        (
            CredentialPolicyViolationError("Credentials not available: Please use ENTERPRISE global credentials"),
            "permission_denied",
            "enterprise_global",
        ),
        (
            CredentialPolicyViolationError("policy lookup failed token=SECRET_CANARY"),
            "authorization_lookup_failed",
            None,
        ),
        (RuntimeError(GLOBAL_ERROR + " token=SECRET_CANARY"), "unknown", None),
    ],
)
def test_typed_tool_credential_diagnostics_are_bounded(failure: Exception, reason: str, scope: str | None) -> None:
    records = []
    with trace_diagnostics.scope(records.append, "native-test"):
        trace_diagnostics.report("native_preparation_failed", error=failure)
    assert records[0]["reason"] == reason
    assert records[0].get("credential_scope") == scope
    assert "SECRET_CANARY" not in json.dumps(records)


def credential_run() -> Run:
    from services.dify_builder.revision import executable_graph_revision

    verification = RunVerification(
        execution_revision="h0",
        executed_graph_revision=executable_graph_revision(TOOL_GRAPH),
        terminal_outputs=None,
        output_findings=[],
        executed_node_ids=["search"],
        no_output_dead_branch=False,
        execution_evidence=ExecutionEvidenceSummary(
            request_id="request",
            policy_version="builder-confirmed-run-v1",
            mode="confirmed_run",
            sealed=True,
            safety_outcome="native_failed",
            sandbox_profile="native",
            native_run_id="native",
        ),
    )
    return Run(
        status="failed",
        dify_run_id="native",
        error=GLOBAL_ERROR,
        per_node=[NodeOutput(node_id="search", status="failed", error=GLOBAL_ERROR)],
        verification=verification,
    )


@pytest.mark.parametrize(
    "variant",
    [
        "unknown",
        "unsealed",
        "foreign",
        "stale",
        "missing",
        "model",
        "title",
        "ambiguous",
        "duplicate",
        "workflow_only",
        "generic",
        "secret",
        "unsafe_resource",
        "running",
    ],
)
def test_observational_tool_fallback_rejects_unbound_or_ambiguous_evidence(variant: str) -> None:
    from copy import deepcopy

    from services.dify_builder.execution_messages import tool_credential_failure_message
    from services.dify_builder.revision import executable_graph_revision

    run = credential_run()
    graph = deepcopy(TOOL_GRAPH)
    assert run.verification is not None
    assert run.verification.execution_evidence is not None
    summary = run.verification.execution_evidence
    if variant in {"unknown", "unsealed", "foreign"}:
        run.verification.execution_evidence = summary.model_copy(
            update={
                "safety_outcome": "execution_evidence_unknown" if variant == "unknown" else "native_failed",
                "sealed": variant != "unsealed",
                "native_run_id": "foreign" if variant == "foreign" else "native",
            }
        )
    elif variant == "stale":
        run.verification.executed_graph_revision = "different-graph"
    elif variant == "missing":
        run.verification = None
    elif variant in {"model", "title"}:
        graph["nodes"][0]["data"]["type"] = "llm" if variant == "model" else "code"
        graph["nodes"][0]["data"]["title"] = "Tool credentials"
        run.verification.executed_graph_revision = executable_graph_revision(graph)
    elif variant == "ambiguous":
        run.per_node.append(NodeOutput(node_id="other", status="failed", error=GLOBAL_ERROR))
    elif variant == "duplicate":
        graph["nodes"].append(deepcopy(graph["nodes"][0]))
        run.verification.executed_graph_revision = executable_graph_revision(graph)
    elif variant == "workflow_only":
        run.per_node[0].error = ""
    elif variant in {"generic", "secret"}:
        run.per_node[0].error = (
            "credential unavailable token=SECRET_CANARY"
            if variant == "generic"
            else GLOBAL_ERROR + " token=SECRET_CANARY"
        )
    elif variant == "unsafe_resource":
        graph["nodes"][0]["data"]["provider_id"] = "https://private?token=SECRET_CANARY"
        run.verification.executed_graph_revision = executable_graph_revision(graph)
    elif variant == "running":
        run.status = "running"
    assert tool_credential_failure_message(run, graph=graph, graph_revision=executable_graph_revision(graph)) is None


def test_missing_tool_credentials_do_not_claim_enterprise_policy() -> None:
    from services.dify_builder.execution_messages import tool_credential_failure_message
    from services.dify_builder.revision import executable_graph_revision

    run = credential_run()
    run.per_node[0].error = "Failed to get tool runtime: Credentials not available"
    message = tool_credential_failure_message(
        run, graph=TOOL_GRAPH, graph_revision=executable_graph_revision(TOOL_GRAPH)
    )
    assert isinstance(message, str)
    assert "Tool" in message
    assert "credential missing" in message
    assert "enterprise" not in message


@pytest.mark.parametrize("kind", ["model", "tool"])
@pytest.mark.parametrize("reply_language", ["en-US", "zh-CN"])
def test_sealed_credentials_name_resource_kind_without_copying_provider_error(kind: str, reply_language: str) -> None:
    from services.dify_builder.execution_messages import observed_failure_message
    from tests.unit_tests.services.dify_builder.test_native_runtime_failure import summary

    evidence = summary().model_copy(
        update={"failure_reason": "authentication", "failure_resource": (kind, "provider", "resource")}
    )
    message = observed_failure_message(evidence, reply_language=reply_language)
    assert isinstance(message, str)
    assert "provider/resource" in message
    assert (
        ("工具" if kind == "tool" else "模型") in message
        if reply_language.startswith("zh")
        else ("Tool" if kind == "tool" else "Model") in message
    )


def test_credential_scope_uses_only_explicit_typed_cause_and_never_error_text() -> None:
    policy = CredentialPolicyViolationError("Credentials not available: Please use ENTERPRISE global credentials")
    wrapped = RuntimeError("token=SECRET_CANARY")
    wrapped.__cause__ = policy
    implicit = RuntimeError("token=SECRET_CANARY")
    implicit.__context__ = policy
    assert trace_diagnostics.credential_scope(wrapped) == "enterprise_global"
    assert trace_diagnostics.credential_scope(implicit) is None
    assert trace_diagnostics.credential_scope(RuntimeError(GLOBAL_ERROR)) is None


def test_legacy_model_exception_details_are_not_echoed_to_public_copy() -> None:
    run = Run(status="failed", error="ModelNotExistError: token=SECRET_CANARY https://private")
    message = handlers_fix.model_config_error_text(run)
    assert message is not None
    assert "SECRET_CANARY" not in message
    assert "https://private" not in message
