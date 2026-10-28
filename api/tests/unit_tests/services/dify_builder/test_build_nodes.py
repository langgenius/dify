import json
import logging
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Literal
from unittest.mock import patch

import pytest

from core.app.app_config.entities import ModelConfig
from core.dify_builder.models import BuildNodesResult, Graph, MutationIntent
from services.dify_builder.agent import build, resources


@pytest.fixture(autouse=True)
def _empty_inventory(monkeypatch: pytest.MonkeyPatch) -> None:
    """build_nodes reads the ready-tool inventory for its generation
    allowlist; keep these tests off the plugin daemon and model providers.
    Tests that need a specific inventory patch ``list_tenant_resources``
    themselves, which overrides this default."""
    monkeypatch.setattr(
        build.resources,
        "list_tenant_resources",
        lambda _tenant_id, **_kwargs: resources.TenantResources(models=[], datasets=[], tools=[]),
    )


_GEN_GRAPH: Graph = {
    "graph": {
        "nodes": [
            {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
            {
                "id": "llm1",
                "type": "custom",
                "data": {
                    "type": "llm",
                    "title": "LLM",
                    "model": {"provider": "wrong", "name": "wrong"},
                    "prompt_template": [{"role": "system", "text": "hi"}],
                    "context": {"enabled": False},
                },
            },
            {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"id": "e1", "source": "s", "target": "llm1"},
            {"id": "e2", "source": "llm1", "target": "e"},
        ],
    },
    "error": "",
    "errors": [],
}


def _fake_mc(provider: str, name: str) -> ModelConfig:
    from core.app.app_config.entities import ModelConfig

    return ModelConfig.model_validate({"provider": provider, "name": name, "mode": "chat", "completion_params": {}})


def test_build_nodes_grounds_model_without_adding_dataset_nodes() -> None:
    fake_resources = resources.TenantResources(
        models=[], datasets=[resources.ResourceRef(id="kb-real", label="Company KB")], tools=[]
    )
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "claude-opus-4-8")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=_GEN_GRAPH,
        ),
        patch.object(build.resources, "list_tenant_resources", return_value=fake_resources),
    ):
        intents = build.build_nodes("t1", {}, ["Retrieve from Company KB", "Summarize"]).intents

    by_type = {}
    for intent in intents:
        if intent.op == "create_node":
            by_type[intent.args["node_type"]] = intent.args["config"]
    assert by_type["llm"]["model"]["provider"] == "anthropic"  # ungrounded model overwritten
    assert by_type["llm"]["model"]["name"] == "claude-opus-4-8"
    # no fabricated params: the fixture's llm node carried no completion_params, and none
    # should be synthesized (e.g. a guessed temperature) during grounding.
    assert "completion_params" not in by_type["llm"]["model"]
    assert "knowledge-retrieval" not in by_type


def test_build_nodes_grounds_to_selected_model_resource() -> None:
    # The user selected a model resource at resource-confirmation; the built
    # workflow nodes must use THAT model, not the Builder's session/cognition
    # model (the bug: nodes were always grounded to the session model, so a
    # selected gpt model got overwritten with the session's deepseek).
    fake_resources = resources.TenantResources(
        models=[resources.ResourceRef(id="langgenius/openai/openai/chat-latest", label="gpt-5.6")],
        datasets=[],
        tools=[],
    )
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("deepseek", "deepseek-chat")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=_GEN_GRAPH,
        ),
        patch.object(build.resources, "list_tenant_resources", return_value=fake_resources),
    ):
        intents = build.build_nodes(
            "t1", {}, ["Summarize"], resource_ids=["langgenius/openai/openai/chat-latest"]
        ).intents

    llm_cfg = next(i.args["config"] for i in intents if i.op == "create_node" and i.args["node_type"] == "llm")
    assert llm_cfg["model"]["provider"] == "langgenius/openai/openai"  # selected model, not deepseek
    assert llm_cfg["model"]["name"] == "chat-latest"


def test_build_nodes_without_selected_model_grounds_to_session_model() -> None:
    # No model resource among the selected ids -> fall back to the session model.
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("deepseek", "deepseek-chat")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=_GEN_GRAPH,
        ),
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(
                models=[], datasets=[resources.ResourceRef(id="kb-1", label="KB")], tools=[]
            ),
        ),
    ):
        intents = build.build_nodes("t1", {}, ["Summarize"], resource_ids=["kb-1"]).intents  # kb-1 dataset, not a model

    llm_cfg = next(i.args["config"] for i in intents if i.op == "create_node" and i.args["node_type"] == "llm")
    assert llm_cfg["model"]["provider"] == "deepseek"
    assert llm_cfg["model"]["name"] == "deepseek-chat"


def test_selected_workflow_model_resolves_model_resource_only() -> None:
    fake_resources = resources.TenantResources(
        models=[resources.ResourceRef(id="langgenius/openai/openai/chat-latest", label="gpt")],
        datasets=[resources.ResourceRef(id="kb-1", label="KB")],
        tools=[],
    )
    with patch.object(build.resources, "list_tenant_resources", return_value=fake_resources):
        # a selected model resource -> ModelConfig split on the last '/'
        mc = build._selected_workflow_model("t1", ["kb-1", "langgenius/openai/openai/chat-latest"])
        assert mc is not None
        assert mc.provider == "langgenius/openai/openai"
        assert mc.name == "chat-latest"
        # only non-model ids selected -> None (don't ground to a dataset/tool)
        assert build._selected_workflow_model("t1", ["kb-1"]) is None
    # empty selection -> None
    assert build._selected_workflow_model("t1", []) is None


def test_build_nodes_instruction_states_workflow_topology() -> None:
    """The instruction sent to the generator must explicitly require a workflow
    topology (start + end node, no answer node). Otherwise the LLM, fed a
    chatbot-shaped plan, emits a chatflow graph (answer node / no end node) that
    fails MISSING_TERMINAL and yields an empty build."""
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=_GEN_GRAPH,
        ) as gen,
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
    ):
        build.build_nodes("t1", {}, ["Say hello to the model and return the reply"])

    instruction = gen.call_args.kwargs["instruction"].lower()
    assert "workflow" in instruction
    assert "'end' node" in instruction  # explicitly requires an end node
    assert "answer" in instruction  # explicitly warns off answer nodes
    assert "say hello to the model and return the reply" in instruction  # plan preserved


def test_build_nodes_retries_with_corrective_instruction_on_terminal_error() -> None:
    """The shared generator does NOT retry a structurally-valid graph that fails
    topology validation (e.g. MISSING_TERMINAL). build_nodes retries ONCE, feeding
    the specific error back, and uses the second attempt's graph."""
    terminal_error: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "Workflow must end with at least one 'end' node",
        "errors": [],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=[terminal_error, _GEN_GRAPH],
        ) as gen,
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
    ):
        intents = build.build_nodes("t1", {}, ["Say hello and return result"]).intents

    assert gen.call_count == 2  # retried after the terminal-node failure
    retry_instruction = gen.call_args_list[1].kwargs["instruction"]
    assert "Workflow must end with at least one 'end' node" in retry_instruction  # error fed back
    assert "end" in retry_instruction.lower()
    assert any(i.op == "create_node" for i in intents)  # the retry's graph was used


def test_terminal_retry_instruction_includes_every_error_and_reference_guidance() -> None:
    """The retry must feed back EVERY structured error (not just the first) and,
    for UNRESOLVED_REFERENCE, name the fix in the generator's own vocabulary --
    the producing node must declare that exact output name, or the consumer must
    reference one of the producer's real outputs."""
    result: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [
            {
                "code": "UNRESOLVED_REFERENCE",
                "detail": "Reference {#node3.deck#} not declared on node 'node3'",
                "node_id": "node3",
            },
            {
                "code": "UNKNOWN_TOOL",
                "detail": "Tool acme/render is not installed for this tenant",
                "node_id": "node5",
            },
        ],
    }

    instruction = build._terminal_retry_instruction("PLAN TEXT", result)

    # every error's detail and node id -- not just the first
    assert "Reference {#node3.deck#} not declared on node 'node3'" in instruction
    assert "node3" in instruction
    assert "Tool acme/render is not installed for this tenant" in instruction
    assert "node5" in instruction
    # error codes are carried too, so the model can see the machine-readable class
    assert "UNRESOLVED_REFERENCE" in instruction
    assert "UNKNOWN_TOOL" in instruction
    # reference-specific guidance in the generator's own vocabulary
    assert "outputs" in instruction  # code node's outputs map
    assert "parameters" in instruction  # parameter-extractor's parameters[].name
    assert "structured" in instruction.lower()  # llm structured output
    assert "'text'" in instruction  # a schema-less llm's only real output
    assert "PLAN TEXT" in instruction  # base instruction preserved


def test_terminal_retry_instruction_keeps_topology_text_for_a_topology_error() -> None:
    """A pure topology failure (no UNRESOLVED_REFERENCE) still gets the
    start/end/answer guidance the retry has always carried."""
    result: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [
            {
                "code": "MISSING_START",
                "detail": "Workflow must have exactly one 'start' node (found 0)",
            }
        ],
    }

    instruction = build._terminal_retry_instruction("PLAN TEXT", result)

    assert "Workflow must have exactly one 'start' node (found 0)" in instruction
    assert "'start' node" in instruction
    assert "'end' node" in instruction
    assert "answer" in instruction.lower()
    assert "PLAN TEXT" in instruction
    # the reference-specific guidance is keyed on the error CODE -- absent when
    # no error is UNRESOLVED_REFERENCE
    assert build._UNRESOLVED_REFERENCE_GUIDANCE not in instruction


def test_build_nodes_retries_twice_then_succeeds_within_budget() -> None:
    """Two corrective retries are allowed (three generations total). A stub
    that fails on the first two attempts and succeeds on the third must use
    that third attempt's graph."""
    unresolved: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [
            {
                "code": "UNRESOLVED_REFERENCE",
                "detail": "Reference {#node3.deck#} not declared on node 'node3'",
                "node_id": "node3",
            }
        ],
    }
    missing_terminal: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [{"code": "MISSING_TERMINAL", "detail": "Workflow must end with at least one 'end' node"}],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=[unresolved, missing_terminal, _GEN_GRAPH],
        ) as gen,
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
    ):
        result = build.build_nodes("t1", {}, ["Say hello and return result"])

    assert gen.call_count == 3
    assert result.error == ""
    assert any(i.op == "create_node" for i in result.intents)  # the 3rd attempt's graph was used


def test_build_nodes_stops_after_three_attempts_and_reports_every_error() -> None:
    """The retry budget is at most 3 generations total (first + 2 retries). A
    stub that keeps failing must stop there, and the error card must carry
    every error of the final attempt, not just the first."""
    attempt1: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [
            {
                "code": "UNRESOLVED_REFERENCE",
                "detail": "Reference {#node3.deck#} not declared on node 'node3'",
                "node_id": "node3",
            }
        ],
    }
    attempt2: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [{"code": "MISSING_TERMINAL", "detail": "Workflow must end with at least one 'end' node"}],
    }
    attempt3: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "",
        "errors": [
            {
                "code": "UNKNOWN_TOOL",
                "detail": "Tool acme/render is not installed for this tenant",
                "node_id": "h",
            },
            {"code": "DANGLING_EDGE", "detail": "Edge target node not found: 'e9'"},
        ],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=[attempt1, attempt2, attempt3],
        ) as gen,
    ):
        result = build.build_nodes("t1", {}, ["x"])

    assert gen.call_count == 3  # budget respected: no 4th attempt
    assert result.intents == []
    # the final attempt's errors are ALL present in the card -- not truncated to the first
    assert "Tool acme/render is not installed for this tenant" in result.error
    assert "Edge target node not found: 'e9'" in result.error
    # the offending node id travels with its error, so a build with several tool
    # nodes tells the user WHICH one -- not just that "a" tool is missing
    assert "'h'" in result.error
    # Assert the CARD TEXT, not the join argument: each error is already
    # bullet-prefixed, so joining them with "; " rendered
    # "- X (node 'h'); - Y" -- one run-on line with a stray bullet mid-sentence.
    assert result.error == (
        "- UNKNOWN_TOOL: Tool acme/render is not installed for this tenant (node 'h')\n"
        "- DANGLING_EDGE: Edge target node not found: 'e9'"
    )
    assert len(result.diagnostics) == 3


def test_build_nodes_degrades_to_empty_on_generator_error() -> None:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value={"graph": {"nodes": [], "edges": []}, "error": "boom", "errors": []},
        ),
    ):
        assert build.build_nodes("t1", {}, ["x"]).intents == []


def test_build_nodes_grounds_model_on_question_classifier_node() -> None:
    gen_graph_qc: Graph = {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "qc1",
                    "type": "custom",
                    "data": {
                        "type": "question-classifier",
                        "title": "Classify",
                        "model": {"provider": "wrong", "name": "wrong"},
                        "classes": [{"id": "result", "name": "Result"}],
                        "query_variable_selector": ["sys", "query"],
                    },
                },
                {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [
                {"id": "e1", "source": "s", "target": "qc1"},
                {"id": "e2", "source": "qc1", "target": "e", "sourceHandle": "result"},
            ],
        },
        "error": "",
        "errors": [],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "claude-opus-4-8")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=gen_graph_qc,
        ),
    ):
        intents = build.build_nodes("t1", {}, ["Classify the request"]).intents

    by_type = {}
    for intent in intents:
        if intent.op == "create_node":
            by_type[intent.args["node_type"]] = intent.args["config"]
    assert by_type["question-classifier"]["model"]["provider"] == "anthropic"  # ungrounded model overwritten
    assert by_type["question-classifier"]["model"]["name"] == "claude-opus-4-8"
    # no fabricated params: the fixture's node carried no completion_params, and none
    # should be synthesized (e.g. a guessed temperature) during grounding.
    assert "completion_params" not in by_type["question-classifier"]["model"]


def test_build_nodes_refuses_generated_retrieval_nodes_through_corrective_path() -> None:
    gen_graph_two_kb: Graph = {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "kb1",
                    "type": "custom",
                    "data": {
                        "type": "knowledge-retrieval",
                        "title": "KB1",
                        "dataset_ids": [],
                        "retrieval_mode": "multiple",
                        "query_variable_selector": ["sys", "query"],
                        "multiple_retrieval_config": {"top_k": 3, "reranking_enable": False},
                    },
                },
                {
                    "id": "kb2",
                    "type": "custom",
                    "data": {
                        "type": "knowledge-retrieval",
                        "title": "KB2",
                        "dataset_ids": [],
                        "retrieval_mode": "multiple",
                        "query_variable_selector": ["sys", "query"],
                        "multiple_retrieval_config": {"top_k": 3, "reranking_enable": False},
                    },
                },
                {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [
                {"id": "e1", "source": "s", "target": "kb1"},
                {"id": "e2", "source": "kb1", "target": "kb2"},
                {"id": "e3", "source": "kb2", "target": "e"},
            ],
        },
        "error": "",
        "errors": [],
    }
    fake_resources = resources.TenantResources(
        models=[], datasets=[resources.ResourceRef(id="kb-real", label="Company KB")], tools=[]
    )
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "claude-opus-4-8")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=gen_graph_two_kb,
        ),
        patch.object(build.resources, "list_tenant_resources", return_value=fake_resources),
    ):
        result = build.build_nodes("t1", {}, ["Retrieve from Company KB"])

    assert result.intents == []
    assert "first phase" in result.error
    assert "knowledge-retrieval" in result.error
    assert len(result.diagnostics) == build._MAX_GENERATION_ATTEMPTS
    assert gen_graph_two_kb["graph"]["nodes"][1]["data"]["dataset_ids"] == []


def test_build_nodes_logs_when_generator_reports_error(caplog: pytest.LogCaptureFixture) -> None:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value={"graph": {}, "error": "generator boom", "errors": []},
        ),
        caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.build"),
    ):
        out = build.build_nodes("t1", {}, ["do a thing"]).intents

    assert out == []
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "no graph" in warnings[0].getMessage()
    assert "generator boom" in warnings[0].getMessage()


def test_build_nodes_logs_traceback_when_generation_raises(caplog: pytest.LogCaptureFixture) -> None:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=RuntimeError("kaboom"),
        ),
        caplog.at_level(logging.ERROR, logger="services.dify_builder.agent.build"),
    ):
        out = build.build_nodes("t1", {}, ["do a thing"]).intents

    assert out == []
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "generation failed" in errors[0].getMessage()
    assert errors[0].exc_info is not None


def test_build_nodes_returns_specific_generator_error_reason() -> None:
    """On generation failure, the result carries the generator's SPECIFIC reason
    (e.g. UNRESOLVED_REFERENCE) so the handler can surface it in the error card
    instead of a hardcoded generic 'couldn't build' message."""
    reason = "UNRESOLVED_REFERENCE: Reference {#node4.response#} not declared"
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value={"graph": {"nodes": [], "edges": []}, "error": reason, "errors": []},
        ),
    ):
        result = build.build_nodes("t1", {}, ["x"])

    assert result.intents == []
    assert result.error == reason  # verbatim reason, not a generic fallback


def test_build_nodes_returns_exception_text_as_error_reason() -> None:
    """A provider/runtime failure (e.g. credit_balance_exhausted) surfaces its
    message as the result error, so the user learns WHY the build failed."""
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=RuntimeError("credit_balance_exhausted"),
        ),
    ):
        result = build.build_nodes("t1", {}, ["x"])

    assert result.intents == []
    assert "credit_balance_exhausted" in result.error


def test_build_nodes_error_reason_joins_errors_list_when_no_top_level_error() -> None:
    """When the generator reports failure via the structured ``errors`` list (no
    top-level ``error`` string), the result error joins those details rather than
    falling back to the generic message."""
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value={
                "graph": {"nodes": [], "edges": []},
                "error": "",
                "errors": [{"code": "NON_OBJECT_JSON", "detail": "top-level value was a list, not an object"}],
            },
        ),
    ):
        result = build.build_nodes("t1", {}, ["x"])

    assert result.intents == []
    assert "top-level value was a list" in result.error


def test_build_nodes_records_structured_diagnostics_for_the_debug_export() -> None:
    """Server logs are lost when the api pod restarts, so the generator's own
    diagnostic ("structural validation failed") must travel back with the result:
    structured code/detail/node_id plus a server timestamp, so the exported debug
    log carries it and can be correlated with pod logs."""
    failing: Graph = {
        "graph": {"nodes": [], "edges": []},
        "error": "UNRESOLVED_REFERENCE: Reference {#node2.response#} not declared on node 'node2'",
        "errors": [
            {
                "code": "UNRESOLVED_REFERENCE",
                "detail": "Reference {#node2.response#} not declared on node 'node2'",
                "node_id": "node2",
            }
        ],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=failing,
        ),
    ):
        result = build.build_nodes("t1", {}, ["call the GitHub API and summarize"])

    assert result.intents == []
    # one diagnostic per generation attempt (initial + up to two corrective retries)
    assert len(result.diagnostics) == 3
    first = result.diagnostics[0]
    assert first["source"] == "workflow-generator"
    # the same text the server logged as the "%s" of "structural validation failed: %s"
    assert "Reference {#node2.response#} not declared" in first["message"]
    assert first["codes"] == ["UNRESOLVED_REFERENCE"]
    assert first["attempt"] == 1
    assert result.diagnostics[1]["attempt"] == 2
    assert result.diagnostics[2]["attempt"] == 3
    # structured detail survives -- code AND the offending node id
    assert first["errors"][0]["code"] == "UNRESOLVED_REFERENCE"
    assert first["errors"][0]["node_id"] == "node2"
    # a server timestamp to locate the corresponding pod-log lines
    datetime.fromisoformat(first["at"])  # parses -> real ISO-8601
    assert first["at"].endswith("+00:00")  # UTC, unambiguous across pods


def test_build_nodes_records_diagnostic_when_generation_raises() -> None:
    """A provider/runtime failure must also leave a timestamped breadcrumb."""
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            side_effect=RuntimeError("credit_balance_exhausted"),
        ),
    ):
        result = build.build_nodes("t1", {}, ["x"])

    assert result.intents == []
    assert len(result.diagnostics) == 1
    d = result.diagnostics[0]
    assert d["source"] == "build_nodes"
    assert d["exception"] == "RuntimeError"
    assert "credit_balance_exhausted" in d["message"]
    datetime.fromisoformat(d["at"])


def test_build_nodes_refuses_complete_candidate_when_one_edge_is_rejected(caplog: pytest.LogCaptureFixture) -> None:
    """A bad branch handle must trigger bounded correction rather than silently
    returning a partial graph that omits the user's branch."""
    graph: Graph = {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "branch",
                    "type": "custom",
                    "data": {
                        "type": "if-else",
                        "title": "Check",
                        "cases": [{"case_id": "true", "logical_operator": "and", "conditions": []}],
                    },
                },
                {"id": "yes", "type": "custom", "data": {"type": "end", "title": "Yes", "outputs": []}},
                {"id": "no", "type": "custom", "data": {"type": "end", "title": "No", "outputs": []}},
            ],
            "edges": [
                {"source": "s", "target": "branch"},
                {"source": "branch", "target": "yes", "sourceHandle": "true"},
                {"source": "branch", "target": "no", "sourceHandle": "maybe"},
            ],
        },
        "error": "",
        "errors": [],
    }
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=graph,
        ),
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
        caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.build"),
    ):
        result = build.build_nodes("t1", {}, ["Branch on a check"])

    assert result.intents == []
    assert "has no handle 'maybe'" in result.error
    assert len(result.diagnostics) == 3
    assert [diagnostic["attempt"] for diagnostic in result.diagnostics] == [1, 2, 3]
    assert all("has no handle 'maybe'" in diagnostic["message"] for diagnostic in result.diagnostics)
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "'maybe'" in warnings[0]


# ---- ESQ1-302: placeholder endpoints -----------------------------------------

_HTTP_BODY = {"type": "json", "data": [{"type": "text", "key": "", "value": "{}"}]}


def _gen_graph_with_http(url: str) -> Graph:
    return {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "h",
                    "type": "custom",
                    "data": {
                        "type": "http-request",
                        "title": "Call PPT API",
                        "method": "post",
                        "url": url,
                        "authorization": {"type": "no-auth", "config": None},
                        "headers": "",
                        "params": "",
                        "body": _HTTP_BODY,
                    },
                },
                {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [{"id": "e1", "source": "s", "target": "h"}, {"id": "e2", "source": "h", "target": "e"}],
        },
        "error": "",
        "errors": [],
    }


def _build_with(gen_graph: Graph, *, trusted_text: str = "") -> list[MutationIntent]:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value=gen_graph,
        ),
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
    ):
        return build.build_nodes("t1", {}, ["Call the PPT API"], trusted_text=trusted_text).intents


def test_build_nodes_grounds_a_placeholder_endpoint_into_a_required_start_variable() -> None:
    """The ESQ1-302 draft called ``https://api.example.com/ppt/generate`` -- an
    endpoint the model invented. A placeholder URL now becomes a required start
    variable, so the test-data gate asks the user for the real endpoint instead
    of the run failing against a host that does not exist."""
    intents = _build_with(_gen_graph_with_http("https://api.example.com/ppt/generate"))

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "{{#s.h_url#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_url")
    assert var["type"] == "text-input"
    assert var["required"] is True
    assert "Call PPT API" in var["label"]


def _http_node(
    node_id: str,
    title: str,
    url: str,
    *,
    headers: str = "",
    params: str = "",
    authorization: Graph | None = None,
) -> Graph:
    return {
        "id": node_id,
        "type": "custom",
        "data": {
            "type": "http-request",
            "title": title,
            "method": "post",
            "url": url,
            "authorization": authorization or {"type": "no-auth", "config": None},
            "headers": headers,
            "params": params,
            "body": _HTTP_BODY,
        },
    }


def _gen_graph_with_http_full(
    url: str,
    *,
    headers: str = "",
    params: str = "",
    authorization: Graph | None = None,
) -> Graph:
    return {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                _http_node("h", "Call PPT API", url, headers=headers, params=params, authorization=authorization),
                {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [{"id": "e1", "source": "s", "target": "h"}, {"id": "e2", "source": "h", "target": "e"}],
        },
        "error": "",
        "errors": [],
    }


def test_build_nodes_grounds_each_placeholder_endpoint_into_its_own_start_variable() -> None:
    gen_graph = _gen_graph_with_http("https://api.example.com/ppt/generate")
    nodes = gen_graph["graph"]["nodes"]
    nodes.insert(2, _http_node("h2", "Upload PPT", "https://your-api.com/v1/upload"))
    gen_graph["graph"]["edges"] = [
        {"id": "e1", "source": "s", "target": "h"},
        {"id": "e2", "source": "h", "target": "h2"},
        {"id": "e3", "source": "h2", "target": "e"},
    ]

    intents = _build_with(gen_graph)

    urls = {i.args["node_id"]: i.args["config"]["url"] for i in intents if i.args.get("node_type") == "http-request"}
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert urls == {"h": "{{#s.h_url#}}", "h2": "{{#s.h2_url#}}"}
    assert [v["variable"] for v in start.args["config"]["variables"]] == ["h_url", "h2_url"]
    assert all(v["required"] is True for v in start.args["config"]["variables"])


def test_build_nodes_does_not_duplicate_an_endpoint_variable_the_start_node_already_declares() -> None:
    gen_graph = _gen_graph_with_http("https://api.example.com/ppt/generate")
    start_node = gen_graph["graph"]["nodes"][0]
    start_node["data"]["variables"] = [
        {"variable": "h_url", "label": "PPT API URL", "type": "text-input", "required": True, "max_length": 2048}
    ]

    intents = _build_with(gen_graph)

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "{{#s.h_url#}}"
    assert [v["variable"] for v in start.args["config"]["variables"]] == ["h_url"]
    assert start.args["config"]["variables"][0]["label"] == "PPT API URL"  # the declared one is kept


def test_build_nodes_leaves_a_real_endpoint_and_a_templated_url_alone() -> None:
    for url in ("https://api.openai.com/v1/chat", "{{#s.endpoint#}}/generate"):
        intents = _build_with(_gen_graph_with_http(url))
        http = next(i for i in intents if i.args.get("node_type") == "http-request")
        start = next(i for i in intents if i.args.get("node_type") == "start")
        assert http.args["config"]["url"] == url
        assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_an_endpoint_the_user_never_supplied_even_when_not_placeholder_shaped() -> None:
    """A plausible, real-looking host the model invented (S5b/ESQ1-302's shape
    one step earlier: ``api.pptrender.io``) must still be grounded once
    trusted_text is available -- ``_is_placeholder_endpoint`` alone would miss
    it, since nothing about the URL LOOKS invented the way ``example.com`` or
    ``your-api.com`` do."""
    goal = "Build a workflow that renders a slide deck from bullet points and returns a download link."
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=goal)

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "{{#s.h_url#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_url")
    assert var["required"] is True


def test_build_nodes_leaves_an_endpoint_alone_when_the_user_actually_supplied_its_host() -> None:
    """The mirror case: trusted_text literally names the same host the
    generated URL uses, so it is not a fabrication and must be left alone."""
    goal = "Call https://api.pptrender.io to render a slide deck from bullet points."
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=goal)

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "https://api.pptrender.io/v1/render"
    assert start.args["config"]["variables"] == []


def test_is_placeholder_endpoint_recognises_the_usual_inventions() -> None:
    assert build._is_placeholder_endpoint("https://api.example.com/ppt/generate")
    assert build._is_placeholder_endpoint("http://example.org/x")
    assert build._is_placeholder_endpoint("https://your-api.com/v1")
    assert build._is_placeholder_endpoint("https://<your-domain>/generate")
    assert build._is_placeholder_endpoint("https://api.acme.com/{tenant}/x")
    assert build._is_placeholder_endpoint("")
    assert build._is_placeholder_endpoint("http://localhost:11434/api")  # the host IS localhost
    assert not build._is_placeholder_endpoint("https://api.openai.com/v1")
    assert not build._is_placeholder_endpoint("{{#s.endpoint#}}/x")  # a Dify template is a real reference
    assert not build._is_placeholder_endpoint(
        "https://abc123.localhost.run/webhook"
    )  # a real tunnel domain, not the localhost host


# ---- Task 3: invented credentials become an input ---------------------------


def test_build_nodes_grounds_an_invented_credential_header_into_a_required_start_variable() -> None:
    """S5b/F2: requirements analysis invented an ``Authorization: Bearer
    YOUR_API_KEY`` header the goal never supplied. Grounding it into a start
    variable means the test-data gate asks the user for the real key instead
    of the workflow shipping a header the run can never satisfy. The
    Content-Type line is not a credential and must pass through byte-identical."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Content-Type: application/json\nAuthorization: Bearer YOUR_API_KEY",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == ("Content-Type: application/json\nAuthorization: Bearer {{#s.h_api_key#}}")
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["type"] == "text-input"
    assert var["required"] is True
    assert var["max_length"] == 2048
    assert "Call PPT API" in var["label"]


def test_build_nodes_leaves_a_header_credential_alone_when_the_user_actually_supplied_it() -> None:
    """The mirror case: the goal literally names the secret, so it is not a
    fabrication and must be left alone."""
    goal = "Call https://api.acme.com/v1/render with Authorization: Bearer sk-live-abc123."
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization: Bearer sk-live-abc123",
        ),
        trusted_text=goal,
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization: Bearer sk-live-abc123"
    assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_an_invented_api_key_authorization_config() -> None:
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            authorization={"type": "api-key", "config": {"type": "bearer", "api_key": "YOUR_TOKEN"}},
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["authorization"]["config"]["api_key"] == "{{#s.h_api_key#}}"
    assert http.args["config"]["authorization"]["config"]["type"] == "bearer"  # untouched
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_grounds_an_invented_api_key_param() -> None:
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            params="api_key: xxxxxxxx",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["params"] == "api_key: {{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


# ---- Task 3 review fix round 1 ------------------------------------------


def test_build_nodes_grounds_a_bare_key_param() -> None:
    """Review item 2: a raw ``?key=...`` param is a common way an API names
    its key; ``is_credential_key("key")`` alone is False (its last-segment
    rule needs a qualifying prefix), so params get a params-only rule that
    also treats a bare, whole ``key`` as a credential."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            params="key: YOUR_API_KEY",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["params"] == "key: {{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_leaves_cache_key_and_key_points_params_alone() -> None:
    """The params-only bare-``key`` rule must not fire on a key that merely
    ENDS in "key" as part of a longer word/segment."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            params="cache_key: YOUR_API_KEY\nkey_points: YOUR_API_KEY",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["params"] == "cache_key: YOUR_API_KEY\nkey_points: YOUR_API_KEY"
    assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_an_empty_api_key_authorization_config() -> None:
    """Review item 3: an empty ``config.api_key`` is never a valid credential
    either -- it must ground exactly like a placeholder one, not pass through
    and fail every run."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            authorization={"type": "api-key", "config": {"type": "bearer", "api_key": ""}},
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["authorization"]["config"]["api_key"] == "{{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_grounds_an_empty_credential_header_line() -> None:
    """Review item 3, header/param side: ``Authorization:`` with nothing
    after the colon is an empty credential, not a real one -- it must
    ground too."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization:",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization:{{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_leaves_an_already_templated_credential_header_alone() -> None:
    """Review item 4: a header that already reads a start variable (e.g.
    from an earlier grounding pass, or one the model wrote itself) must
    never be re-grounded -- even though the variable NAME can itself look
    placeholder-shaped (``your_api_key`` matches CREDENTIAL_PLACEHOLDER_RE's
    ``YOUR...KEY`` pattern). The template check must run BEFORE the
    placeholder-shape check."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization: Bearer {{#s.your_api_key#}}",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization: Bearer {{#s.your_api_key#}}"
    assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_a_bare_scheme_word_keeping_it() -> None:
    """Review minor (b): a value that is EXACTLY a scheme word (nothing
    after it -- ``strip_auth_scheme`` only strips a scheme FOLLOWED by
    whitespace, so a bare word isn't recognised as empty by that helper
    alone) is grounded while keeping the scheme word."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization: Bearer",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization: Bearer {{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_grounds_a_credential_header_preserving_crlf_line_endings() -> None:
    """Review minor (a): ``_replace_credential_value`` used to strip only
    `` \\t``, so a ``\\r\\n``-terminated line's trailing ``\\r`` was treated
    as part of the secret and silently dropped instead of preserved as a
    line-ending character."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Content-Type: application/json\r\nAuthorization: Bearer YOUR_API_KEY\r\n",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["headers"] == (
        "Content-Type: application/json\r\nAuthorization: Bearer {{#s.h_api_key#}}\r\n"
    )


def test_build_nodes_grounds_an_invented_secret_absent_from_trusted_text() -> None:
    """Review minor (c), test 1: in trusted mode, a non-placeholder-shaped
    but still invented secret (absent from what the user actually typed)
    must ground -- not just an obviously placeholder-shaped one."""
    goal = "Call https://api.acme.com/v1/render to render a slide deck."
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization: Bearer sk-invented",
        ),
        trusted_text=goal,
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization: Bearer {{#s.h_api_key#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_api_key")
    assert var["required"] is True


def test_build_nodes_leaves_a_non_placeholder_secret_alone_in_placeholder_only_mode() -> None:
    """Review minor (c), test 2: with no trusted_text at all, only an
    unmistakably placeholder-shaped credential grounds -- a real-looking
    secret is left alone rather than treated as invented just because there
    is no goal text to check it against (mirrors the URL grounding's own
    placeholder-only-mode behaviour)."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="Authorization: Bearer sk-live-abc123",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["headers"] == "Authorization: Bearer sk-live-abc123"
    assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_both_an_invented_url_and_an_invented_header_on_the_same_node() -> None:
    """Review minor (c), test 3: a node with both an invented URL and an
    invented credential header gets BOTH a ``<node>_url`` and a
    ``<node>_api_key`` start variable -- the two grounding passes share the
    start-variable insertion write without clobbering each other."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.example.com/ppt/generate",
            headers="Authorization: Bearer YOUR_API_KEY",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "{{#s.h_url#}}"
    assert http.args["config"]["headers"] == "Authorization: Bearer {{#s.h_api_key#}}"
    assert {v["variable"] for v in start.args["config"]["variables"]} == {"h_url", "h_api_key"}


# ---- Final review F1: a templated path/query must not hide an invented host --

_NO_URL_GOAL = "Build a workflow that renders a slide deck from bullet points and returns a download link."


def _as_graph(intents: list[MutationIntent]) -> Graph:
    """The node dicts ``endpoint_variable_names`` reads, built from the intents."""
    nodes = [
        {"id": i.args["node_id"], "data": {"type": i.args["node_type"], **(i.args.get("config") or {})}}
        for i in intents
        if i.op == "create_node"
    ]
    return {"nodes": nodes, "edges": []}


def test_build_nodes_grounds_only_the_origin_of_an_invented_url_with_a_templated_query() -> None:
    """The S5b URL with the topic in its query string: the host is still
    invented, so it must be grounded -- but only ``scheme://host`` becomes the
    input; the path, the query and the data template in it stay verbatim."""
    intents = _build_with(
        _gen_graph_with_http("https://api.pptrender.io/v1/render?topic={{#node1.topic#}}"),
        trusted_text=_NO_URL_GOAL,
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "{{#s.h_url#}}/v1/render?topic={{#node1.topic#}}"
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_url")
    assert var["required"] is True
    assert var["label"] == "Call PPT API base URL"


def test_build_nodes_grounds_only_the_origin_of_an_invented_url_with_a_templated_path() -> None:
    intents = _build_with(
        _gen_graph_with_http("https://api.pptrender.io/v1/{{#node1.topic#}}/render"),
        trusted_text=_NO_URL_GOAL,
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["url"] == "{{#s.h_url#}}/v1/{{#node1.topic#}}/render"


def test_build_nodes_grounds_only_the_origin_of_a_placeholder_url_with_a_templated_path() -> None:
    """Placeholder-only mode (no trusted text) too: the whole-URL replacement
    would silently drop the data template the node reads."""
    intents = _build_with(_gen_graph_with_http("https://api.example.com/ppt/{{#s.topic#}}"))

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["url"] == "{{#s.h_url#}}/ppt/{{#s.topic#}}"


def test_build_nodes_keeps_the_whole_url_label_for_a_url_without_templates() -> None:
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=_NO_URL_GOAL)

    start = next(i for i in intents if i.args.get("node_type") == "start")
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_url")
    assert var["label"] == "Call PPT API URL"


def test_build_nodes_leaves_a_url_whose_host_is_a_template_alone() -> None:
    for url in ("{{#s.h_url#}}/v1/render", "https://{{#s.host#}}/v1", "{{#s.h_url#}}/{tenant}/x"):
        intents = _build_with(_gen_graph_with_http(url), trusted_text=_NO_URL_GOAL)
        http = next(i for i in intents if i.args.get("node_type") == "http-request")
        start = next(i for i in intents if i.args.get("node_type") == "start")
        assert http.args["config"]["url"] == url
        assert start.args["config"]["variables"] == []


def test_grounding_a_templated_url_is_idempotent() -> None:
    intents = _build_with(
        _gen_graph_with_http("https://api.pptrender.io/v1/render?topic={{#node1.topic#}}"),
        trusted_text=_NO_URL_GOAL,
    )
    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    url_before = http.args["config"]["url"]
    variables_before = list(start.args["config"]["variables"])

    assert build._ground_placeholder_endpoints(intents, trusted_text=_NO_URL_GOAL) == []
    assert http.args["config"]["url"] == url_before
    assert start.args["config"]["variables"] == variables_before


def test_every_variable_url_grounding_creates_is_excluded_from_mocks_and_path_data_is_not() -> None:
    """Reviewer check (a): the grounding side and ``endpoint_variable_names``
    agree after the origin-only substitution -- the grounded ``h_url`` is a
    value a human must supply, the ``topic`` in the path/query stays mockable."""
    from services.dify_builder.application.handlers_fix import endpoint_variable_names

    for url in (
        "https://api.pptrender.io/v1/render?topic={{#s.topic#}}",
        "https://api.pptrender.io/v1/{{#s.topic#}}/render",
        "https://api.pptrender.io/v1/render",
    ):
        intents = _build_with(_gen_graph_with_http(url), trusted_text=_NO_URL_GOAL)
        start = next(i for i in intents if i.args.get("node_type") == "start")
        created = {v["variable"] for v in start.args["config"]["variables"]}

        assert created == {"h_url"}
        assert endpoint_variable_names(_as_graph(intents)) == created


# ---- Final review F2: a host the user typed without a scheme is not invented --


def test_build_nodes_leaves_a_url_whose_host_the_goal_names_without_a_scheme() -> None:
    from services.dify_builder.agent.user_supplied import trusted_text_for

    goal = "Render a slide deck from bullet points. Our renderer is at api.pptrender.io/v1/render."
    intents = _build_with(
        _gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=trusted_text_for(goal, {})
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "https://api.pptrender.io/v1/render"
    assert start.args["config"]["variables"] == []


def test_build_nodes_leaves_a_url_whose_host_a_requirement_names_without_a_scheme() -> None:
    from services.dify_builder.agent.user_supplied import trusted_text_for

    trusted = trusted_text_for(_NO_URL_GOAL, {"render_api_url": "api.pptrender.io/v1/render"})
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=trusted)

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["url"] == "https://api.pptrender.io/v1/render"


# ---- Final review minors ------------------------------------------------------


def test_build_nodes_grounds_a_bearer_key_the_goal_only_mentions_as_a_word() -> None:
    """M1: ``Bearer key`` is not user-supplied just because the goal says "key"."""
    intents = _build_with(
        _gen_graph_with_http_full("https://api.acme.com/v1/render", headers="Authorization: Bearer key"),
        trusted_text="Call https://api.acme.com/v1/render with my API key.",
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["headers"] == "Authorization: Bearer {{#s.h_api_key#}}"


def test_build_nodes_grounds_an_invented_azure_subscription_key_header() -> None:
    """M2: ``Ocp-Apim-Subscription-Key`` is a credential header."""
    intents = _build_with(
        _gen_graph_with_http_full("https://api.acme.com/v1/render", headers="Ocp-Apim-Subscription-Key: abc123"),
        trusted_text="Call https://api.acme.com/v1/render.",
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["headers"] == "Ocp-Apim-Subscription-Key: {{#s.h_api_key#}}"


def test_build_nodes_replaces_a_bare_scheme_word_wholesale_off_an_authorization_line() -> None:
    """M3: a bare ``Bearer``/``Basic``/``Token`` is an auth SCHEME only on an
    ``Authorization``/``Proxy-Authorization`` line; under any other credential
    key it is just an invented value and is replaced whole."""
    intents = _build_with(
        _gen_graph_with_http_full(
            "https://api.acme.com/v1/render",
            headers="X-Auth-Token: token\nProxy-Authorization: Basic",
            params="api_key: token",
        )
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["headers"] == (
        "X-Auth-Token: {{#s.h_api_key#}}\nProxy-Authorization: Basic {{#s.h_api_key#}}"
    )
    assert http.args["config"]["params"] == "api_key: {{#s.h_api_key#}}"


# ENG-1161: validate complete grounded candidates before returning build intents.
def _gen_graph_with_list_limit(size: int | str, *, dynamic_input: bool = False) -> Graph:
    variables = (
        [{"variable": "issue_limit", "label": "Issue limit", "type": "number", "required": True}]
        if dynamic_input
        else list[object]()
    )
    return {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": variables}},
                {
                    "id": "issues",
                    "type": "custom",
                    "data": {
                        "type": "code",
                        "title": "Issues",
                        "code_language": "python3",
                        "code": "def main():\n    return {'issues': []}",
                        "variables": [],
                        "outputs": {"issues": {"type": "array[object]", "children": None}},
                    },
                },
                {
                    "id": "limit",
                    "type": "custom",
                    "data": {
                        "type": "list-operator",
                        "title": "Limit issues",
                        "variable": ["issues", "issues"],
                        "filter_by": {"enabled": False, "conditions": []},
                        "order_by": {"enabled": False, "key": "", "value": "asc"},
                        "extract_by": {"enabled": False, "serial": "1"},
                        "limit": {"enabled": True, "size": size},
                    },
                },
                {
                    "id": "e",
                    "type": "custom",
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "issues", "value_selector": ["limit", "result"]}],
                    },
                },
            ],
            "edges": [
                {"source": "s", "target": "issues"},
                {"source": "issues", "target": "limit"},
                {"source": "limit", "target": "e"},
            ],
        },
        "error": "",
        "errors": [],
    }


def _build_list_candidates(generate: Callable[..., Graph], *, trusted_text: str) -> BuildNodesResult:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch.object(build.WorkflowGeneratorService, "generate_workflow_graph", side_effect=generate),
        patch.object(
            build.resources,
            "list_tenant_resources",
            return_value=resources.TenantResources(models=[], datasets=[], tools=[]),
        ),
    ):
        return build.build_nodes(
            "t1", {}, ["Sort Issues and slice according to the optional processing count"], trusted_text=trusted_text
        )


def test_build_nodes_corrects_list_schema_before_returning_complete_intents() -> None:
    # Removing the real candidate preflight would return the template on attempt 1.
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        if len(instructions) == 1:
            return _gen_graph_with_list_limit("{{#s.issue_limit#}}", dynamic_input=True)
        return _gen_graph_with_list_limit(20)

    result = _build_list_candidates(generate, trusted_text="Process at most 20 Issues and at most 5 high-risk Issues.")

    assert result.error == ""
    assert len(instructions) == 2
    assert "node 'limit' (list-operator)" in instructions[1]
    assert "limit.size" in instructions[1]
    assert "int_parsing" in instructions[1]
    assert [intent.args["node_id"] for intent in result.intents if intent.op == "create_node"] == [
        "s",
        "issues",
        "limit",
        "e",
    ]
    limit = next(intent for intent in result.intents if intent.args.get("node_id") == "limit")
    assert limit.args["config"]["limit"] == {"enabled": True, "size": 20}
    assert len([intent for intent in result.intents if intent.op == "connect"]) == 3
    assert len(result.diagnostics) == 1
    assert "limit.size" in result.diagnostics[0]["message"]


def test_build_nodes_preserves_original_fixed_constraints_absent_from_plan() -> None:
    # Dropping trusted_text from generation loses both literal constraints and
    # lets the approved plan's invented input replace the user's fixed maximum.
    trusted = "Process at most 20 Issues and at most 5 high-risk Issues."
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instruction = instruction
        instructions.append(instruction)
        if trusted in instruction:
            return _gen_graph_with_list_limit(20)
        return _gen_graph_with_list_limit("{{#s.issue_limit#}}", dynamic_input=True)

    result = _build_list_candidates(generate, trusted_text=trusted)

    assert result.error == ""
    assert len(instructions) == 1
    assert trusted in instructions[0]
    assert "Sort Issues and slice according to the optional processing count" in instructions[0]
    start = next(intent for intent in result.intents if intent.args.get("node_id") == "s")
    limit = next(intent for intent in result.intents if intent.args.get("node_id") == "limit")
    assert start.args["config"]["variables"] == []
    assert limit.args["config"]["limit"]["size"] == 20


def test_build_nodes_refuses_dynamic_template_after_bounded_schema_attempts() -> None:
    # Removing preflight or casting a dynamic template to a guessed constant
    # would return a misleading successful build with otherwise valid siblings.
    instructions: list[str] = []
    trusted = "Let the user supply the maximum issue count at runtime."

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        return _gen_graph_with_list_limit("{{#s.issue_limit#}}", dynamic_input=True)

    result = _build_list_candidates(generate, trusted_text=trusted)

    assert result.intents == []
    assert "node 'limit' (list-operator)" in result.error
    assert "limit.size" in result.error
    assert "int_parsing" in result.error
    assert len(instructions) == 3
    assert all(trusted in instruction for instruction in instructions)
    assert [diagnostic["attempt"] for diagnostic in result.diagnostics] == [1, 2, 3]
    assert all("limit.size" in diagnostic["message"] for diagnostic in result.diagnostics)


def test_build_nodes_valid_list_candidate_succeeds_without_correction() -> None:
    # Rejecting a valid constant or spending retries after success breaks this.
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        return _gen_graph_with_list_limit(20)

    result = _build_list_candidates(generate, trusted_text="Process at most 20 Issues.")

    assert result.error == ""
    assert len(result.intents) == 7
    assert len(instructions) == 1
    assert result.diagnostics == []


# ENG1107: a full generated candidate must connect its executable nodes to End.
def _healthcheck_candidate(*, missing_edges: Sequence[tuple[str, str]] = ()) -> Graph:
    nodes: list[Graph] = [
        {
            "id": "node1",
            "data": {
                "type": "start",
                "variables": [{"variable": "api_url", "label": "API URL", "type": "text-input", "required": True}],
            },
        },
        {
            "id": "node2",
            "data": {
                "type": "http-request",
                "method": "get",
                "url": "{{#node1.api_url#}}",
                "authorization": {"type": "no-auth", "config": None},
                "headers": "",
                "params": "",
                "body": {"type": "none", "data": []},
                "timeout": {"connect": 10, "read": 10, "write": 10},
                "retry_config": {"retry_enabled": False, "max_retries": 0, "retry_interval": 100},
            },
        },
        {
            "id": "node3",
            "data": {
                "type": "if-else",
                "cases": [
                    {
                        "case_id": "true",
                        "logical_operator": "and",
                        "conditions": [
                            {
                                "id": "status_is_200",
                                "variable_selector": ["node2", "status_code"],
                                "comparison_operator": "=",
                                "value": "200",
                            }
                        ],
                    }
                ],
            },
        },
        {"id": "node4", "data": {"type": "template-transform", "template": "healthy", "variables": []}},
        {"id": "node5", "data": {"type": "template-transform", "template": "unhealthy", "variables": []}},
        {
            "id": "node6",
            "data": {
                "type": "variable-aggregator",
                "output_type": "string",
                "variables": [["node4", "output"], ["node5", "output"]],
            },
        },
        {
            "id": "node7",
            "data": {"type": "end", "outputs": [{"variable": "status", "value_selector": ["node6", "output"]}]},
        },
    ]
    edges = [
        {"source": "node1", "target": "node2"},
        {"source": "node2", "target": "node3"},
        {"source": "node3", "target": "node4", "sourceHandle": "true"},
        {"source": "node3", "target": "node5", "sourceHandle": "false"},
        {"source": "node4", "target": "node6"},
        {"source": "node5", "target": "node6"},
        {"source": "node6", "target": "node7"},
    ]
    return {
        "graph": {"nodes": nodes, "edges": [e for e in edges if (e["source"], e["target"]) not in missing_edges]},
        "error": "",
        "errors": [],
    }


def _build_healthcheck_candidates(generate: Callable[..., Graph]) -> BuildNodesResult:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch.object(build.WorkflowGeneratorService, "generate_workflow_graph", side_effect=generate),
    ):
        return build.build_nodes(
            "t1",
            {},
            ["Start api_url; HTTP GET; branch status_code=200; healthy/unhealthy templates; aggregate; End status"],
            trusted_text="Check api_url and return status healthy for HTTP 200, otherwise unhealthy.",
        )


@pytest.mark.parametrize(
    "missing_edges",
    [
        (("node4", "node6"),),
        (("node5", "node6"),),
        (("node6", "node7"),),
        (("node4", "node6"), ("node5", "node6"), ("node6", "node7")),
    ],
)
def test_full_build_rejects_disconnected_convergence_before_returning_intents(
    missing_edges: tuple[tuple[str, str], tuple[str, str], tuple[str, str]] | tuple[tuple[str, str]],
) -> None:
    # Removing the candidate topology guard would return an incomplete build on attempt one.
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        return _healthcheck_candidate(missing_edges=missing_edges)

    result = _build_healthcheck_candidates(generate)

    assert result.intents == []
    assert len(instructions) == 3
    assert result.error
    assert len(result.diagnostics) == 3
    assert all("node" in diagnostic["message"] for diagnostic in result.diagnostics)
    assert all(result.diagnostics[0]["errors"][0]["detail"] in instruction for instruction in instructions[1:])


def test_full_build_corrects_disconnected_healthcheck_within_existing_retry_budget() -> None:
    # A partial first candidate must not prevent the corrected complete graph from being returned.
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        return _healthcheck_candidate(
            missing_edges=(("node4", "node6"), ("node5", "node6"), ("node6", "node7")) if len(instructions) == 1 else ()
        )

    result = _build_healthcheck_candidates(generate)

    assert result.error == ""
    assert len(instructions) == 2
    assert len(result.diagnostics) == 1
    assert len(result.intents) == 14
    assert {
        (intent.args["from_node"], intent.args["to_node"], intent.args.get("source_handle", "source"))
        for intent in result.intents
        if intent.op == "connect"
    } == {
        ("node1", "node2", "source"),
        ("node2", "node3", "source"),
        ("node3", "node4", "true"),
        ("node3", "node5", "false"),
        ("node4", "node6", "source"),
        ("node5", "node6", "source"),
        ("node6", "node7", "source"),
    }


def test_full_build_accepts_complete_healthcheck_without_retry_or_rewiring() -> None:
    instructions: list[str] = []

    def generate(*, instruction: str, **_kwargs: object) -> Graph:
        instructions.append(instruction)
        return _healthcheck_candidate()

    result = _build_healthcheck_candidates(generate)

    assert result.error == ""
    assert result.diagnostics == []
    assert len(instructions) == 1
    assert len(result.intents) == 14


def test_full_build_completeness_preserves_legacy_aggregator_identity() -> None:
    from copy import deepcopy

    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph = _healthcheck_candidate()["graph"]
    graph["nodes"][5]["data"]["type"] = "variable-assigner"
    before = deepcopy(graph)

    assert generated_graph_completeness_problems(graph, mode="workflow", current_graph=None) == []
    assert graph == before


def test_full_build_allows_a_separate_terminal_on_each_branch() -> None:
    candidate = _healthcheck_candidate()
    candidate["graph"]["nodes"][5]["data"] = {
        "type": "end",
        "outputs": [{"variable": "status", "value_selector": ["node4", "output"]}],
    }
    candidate["graph"]["nodes"][6]["data"]["outputs"][0]["value_selector"] = ["node5", "output"]
    candidate["graph"]["edges"] = candidate["graph"]["edges"][:4] + [
        {"source": "node4", "target": "node6"},
        {"source": "node5", "target": "node7"},
    ]

    result = _build_healthcheck_candidates(lambda **_kwargs: candidate)

    assert result.error == ""
    assert result.diagnostics == []
    assert len(result.intents) == 13


def test_full_build_completeness_does_not_change_authored_partial_edit_preflight() -> None:
    from core.dify_builder.models import MutationIntent
    from services.dify_builder.preflight import vet_intents

    partial = _healthcheck_candidate(missing_edges=(("node4", "node6"), ("node5", "node6"), ("node6", "node7")))[
        "graph"
    ]
    rename = MutationIntent(op="set_node_config", args={"node_id": "node1", "path": "title", "value": "Input URL"})

    vetted = vet_intents(partial, [rename], build._ALLOWED_NODE_TYPES)

    assert vetted.rejections == []
    assert vetted.applicable == [rename]


@pytest.mark.parametrize(("mode", "terminal"), [("workflow", "end"), ("advanced-chat", "answer")])
def test_full_build_completeness_uses_the_actual_mode_terminal(
    mode: Literal["advanced-chat", "workflow"], terminal: str
) -> None:
    from copy import deepcopy

    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph: Graph = {
        "nodes": [{"id": "entry", "data": {"type": "start"}}, {"id": "exit", "data": {"type": terminal}}],
        "edges": [{"source": "entry", "target": "exit"}],
    }
    before = deepcopy(graph)

    assert generated_graph_completeness_problems(graph, mode=mode, current_graph=None) == []
    assert graph == before
    graph["nodes"][1]["data"]["type"] = "answer" if terminal == "end" else "end"
    assert generated_graph_completeness_problems(graph, mode=mode, current_graph=None)


def test_full_build_completeness_leaves_refinement_context_unrestricted() -> None:
    from copy import deepcopy

    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    partial = _healthcheck_candidate(missing_edges=(("node4", "node6"), ("node5", "node6"), ("node6", "node7")))[
        "graph"
    ]
    before = deepcopy(partial)

    assert generated_graph_completeness_problems(partial, mode="workflow", current_graph=before) == []
    assert generated_graph_completeness_problems(partial, mode="workflow", current_graph={}) == []
    assert partial == before


def test_full_build_completeness_treats_nested_container_children_as_internal_execution() -> None:
    from copy import deepcopy

    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph: Graph = {
        "nodes": [
            {"id": "entry", "data": {"type": "start"}},
            {"id": "outer", "data": {"type": "iteration"}},
            {"id": "outerstart", "parentId": "outer", "data": {"type": "iteration-start"}},
            {"id": "inner", "parentId": "outer", "data": {"type": "loop"}},
            {"id": "innerstart", "parentId": "inner", "data": {"type": "loop-start"}},
            {"id": "leaf", "parentId": "inner", "data": {"type": "template-transform"}},
            {"id": "done", "parentId": "outer", "data": {"type": "template-transform"}},
            {"id": "exit", "data": {"type": "end"}},
            {"id": "note", "type": "custom-note", "data": {}},
        ],
        "edges": [
            {"source": "entry", "target": "outer"},
            {"source": "outer", "target": "exit"},
            {"source": "outerstart", "target": "inner"},
            {"source": "inner", "target": "done"},
            {"source": "innerstart", "target": "leaf"},
        ],
    }
    before = deepcopy(graph)

    assert generated_graph_completeness_problems(graph, mode="workflow", current_graph=None) == []
    assert graph == before
    graph["edges"].pop(1)
    assert generated_graph_completeness_problems(graph, mode="workflow", current_graph=None)


@pytest.mark.parametrize("parent", ["missing", "entry", "leaf"])
def test_full_build_completeness_does_not_hide_unowned_children(parent: str) -> None:
    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph = {
        "nodes": [
            {"id": "entry", "data": {"type": "start"}},
            {"id": "exit", "data": {"type": "end"}},
            {"id": "leaf", "parentId": parent, "data": {"type": "template-transform"}},
        ],
        "edges": [{"source": "entry", "target": "exit"}],
    }

    problems = generated_graph_completeness_problems(graph, mode="workflow", current_graph=None)

    assert problems
    assert "leaf" in problems[0]


@pytest.mark.parametrize("extra_start", [False, True])
def test_full_build_completeness_requires_one_actual_start(extra_start: bool) -> None:
    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph: Graph = {
        "nodes": [{"id": "exit", "data": {"type": "end"}}],
        "edges": [],
    }
    if extra_start:
        graph["nodes"] += [{"id": "a", "data": {"type": "start"}}, {"id": "b", "data": {"type": "start"}}]
        graph["edges"] += [{"source": "a", "target": "exit"}, {"source": "b", "target": "exit"}]

    assert generated_graph_completeness_problems(graph, mode="workflow", current_graph=None)


def test_full_build_accepts_native_assembled_nested_containers() -> None:
    from services.workflow_generation.runner import WorkflowGenerator

    plan_nodes = [
        {"id": "entry", "label": "Start", "node_type": "start", "purpose": "Begin"},
        {"id": "items", "label": "Items", "node_type": "code", "purpose": "Publish items"},
        {"id": "outer", "label": "Each Item", "node_type": "iteration", "purpose": "Iterate items"},
        {"id": "inner", "label": "Repeat", "node_type": "loop", "purpose": "Repeat once", "parent": "outer"},
        {"id": "leaf", "label": "Literal", "node_type": "template-transform", "purpose": "Render", "parent": "inner"},
        {"id": "done", "label": "Done", "node_type": "template-transform", "purpose": "Render", "parent": "outer"},
        {"id": "exit", "label": "End", "node_type": "end", "purpose": "Return items"},
    ]
    graph = WorkflowGenerator._assemble_parallel_graph(
        plan_nodes=plan_nodes,
        plan_edges=[
            {"source": "entry", "target": "items"},
            {"source": "items", "target": "outer"},
            {"source": "outer", "target": "exit"},
            {"source": "inner", "target": "done"},
        ],
        configs_by_id={
            "entry": {"variables": []},
            "items": {
                "code_language": "python3",
                "code": "def main():\n    return {'items': ['one']}",
                "variables": [],
                "outputs": {"items": {"type": "array[string]", "children": None}},
            },
            "outer": {"iterator_selector": ["items", "items"], "output_selector": ["done", "output"]},
            "inner": {"loop_count": 1, "break_conditions": [], "logical_operator": "and"},
            "leaf": {"template": "one", "variables": []},
            "done": {"template": "done", "variables": []},
            "exit": {"outputs": [{"variable": "items", "value_selector": ["outer", "output"]}]},
        },
        existing_by_id={},
    )
    result = _build_healthcheck_candidates(lambda **_kwargs: {"graph": graph, "error": "", "errors": []})

    assert result.error == ""
    assert result.diagnostics == []
    assert len(result.intents) == 15  # Nine native nodes (including two start markers), six edges.
    creates = {intent.args["node_id"]: intent.args for intent in result.intents if intent.op == "create_node"}
    assert creates["inner"]["parent_id"] == "outer"
    assert creates["inner"]["config"]["iteration_id"] == "outer"
    assert creates["leaf"]["parent_id"] == "inner"
    assert creates["leaf"]["config"]["loop_id"] == "inner"
    assert creates["innerstart"]["flow_type"] == "custom-loop-start"
    assert creates["outerstart"]["flow_type"] == "custom-iteration-start"


@pytest.mark.parametrize(
    "metadata", [{"isInIteration": True, "iteration_id": "entry"}, {"isInLoop": True, "loop_id": "entry"}]
)
def test_full_build_completeness_does_not_trust_data_only_container_markers(metadata: Graph) -> None:
    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph = {
        "nodes": [
            {"id": "entry", "data": {"type": "start"}},
            {"id": "exit", "data": {"type": "end"}},
            {"id": "leaf", "data": {"type": "template-transform", **metadata}},
        ],
        "edges": [{"source": "entry", "target": "exit"}],
    }

    problems = generated_graph_completeness_problems(graph, mode="workflow", current_graph=None)

    assert problems
    assert "leaf" in problems[0]


def test_full_build_completeness_accepts_complete_parallel_fanout_only() -> None:
    from services.dify_builder.generated_graph_completeness import generated_graph_completeness_problems

    graph = {
        "nodes": [
            {"id": "entry", "data": {"type": "start"}},
            {"id": "a", "data": {"type": "template-transform"}},
            {"id": "b", "data": {"type": "template-transform"}},
            {"id": "exit", "data": {"type": "end"}},
        ],
        "edges": [
            {"source": "entry", "target": "a"},
            {"source": "entry", "target": "b"},
            {"source": "a", "target": "exit"},
            {"source": "b", "target": "exit"},
        ],
    }

    assert generated_graph_completeness_problems(graph, mode="workflow", current_graph=None) == []
    graph["edges"].pop()
    problems = generated_graph_completeness_problems(graph, mode="workflow", current_graph=None)
    assert len(problems) == 1
    assert "'b'" in problems[0]


def test_build_nodes_passes_confirmed_failure_policy_to_generator() -> None:
    """A concise approved plan cannot erase authoritative failure/HTTP constraints."""
    requirements = {"error_status_value": 0, "continue_on_post_failure": False, "health_success_status": 404}
    trusted_text = "ORIGINAL GOAL:\nPOST then fetch health\nCONFIRMED REQUIREMENTS:\n" + json.dumps(requirements)
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch.object(build.WorkflowGeneratorService, "generate_workflow_graph", return_value=_GEN_GRAPH) as generate,
    ):
        result = build.build_nodes("tenant", {}, ["code node calls both endpoints"], trusted_text=trusted_text)

    assert result.intents
    instruction = generate.call_args.kwargs["instruction"]
    assert trusted_text in instruction
    assert "follow the original source" in instruction


def test_build_nodes_forwards_session_reply_language() -> None:
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("p", "m")),
        patch.object(build.WorkflowGeneratorService, "generate_workflow_graph", return_value=_GEN_GRAPH) as generate,
    ):
        build.build_nodes("t1", {}, ["Return customer_id"], reply_language="zh-CN")
    assert generate.call_args.kwargs["reply_language"] == "zh-CN"
