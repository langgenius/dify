import logging
from datetime import datetime
from unittest.mock import patch

from services.dify_builder.agent import build, resources

_GEN_GRAPH = {
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
                },
            },
            {"id": "kb1", "type": "custom", "data": {"type": "knowledge-retrieval", "title": "KB", "dataset_ids": []}},
            {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
        ],
        "edges": [
            {"id": "e1", "source": "s", "target": "llm1"},
            {"id": "e2", "source": "llm1", "target": "kb1"},
            {"id": "e3", "source": "kb1", "target": "e"},
        ],
    },
    "error": "",
    "errors": [],
}


def _fake_mc(provider, name):
    from core.app.app_config.entities import ModelConfig

    return ModelConfig.model_validate({"provider": provider, "name": name, "mode": "chat", "completion_params": {}})


def test_build_nodes_grounds_model_and_dataset():
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
    assert by_type["knowledge-retrieval"]["dataset_ids"] == ["kb-real"]  # dataset injected by label match


def test_build_nodes_grounds_to_selected_model_resource():
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


def test_build_nodes_without_selected_model_grounds_to_session_model():
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


def test_selected_workflow_model_resolves_model_resource_only():
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


def test_build_nodes_instruction_states_workflow_topology():
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


def test_build_nodes_retries_with_corrective_instruction_on_terminal_error():
    """The shared generator does NOT retry a structurally-valid graph that fails
    topology validation (e.g. MISSING_TERMINAL). build_nodes retries ONCE, feeding
    the specific error back, and uses the second attempt's graph."""
    terminal_error = {
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


def test_build_nodes_degrades_to_empty_on_generator_error():
    with (
        patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")),
        patch(
            "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
            return_value={"graph": {"nodes": [], "edges": []}, "error": "boom", "errors": []},
        ),
    ):
        assert build.build_nodes("t1", {}, ["x"]).intents == []


def test_build_nodes_grounds_model_on_question_classifier_node():
    gen_graph_qc = {
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
                        "classes": [],
                    },
                },
                {"id": "e", "type": "custom", "data": {"type": "end", "title": "End", "outputs": []}},
            ],
            "edges": [
                {"id": "e1", "source": "s", "target": "qc1"},
                {"id": "e2", "source": "qc1", "target": "e"},
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


def test_build_nodes_dataset_ids_are_independent_lists_per_node():
    gen_graph_two_kb = {
        "graph": {
            "nodes": [
                {"id": "s", "type": "custom", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "kb1",
                    "type": "custom",
                    "data": {"type": "knowledge-retrieval", "title": "KB1", "dataset_ids": []},
                },
                {
                    "id": "kb2",
                    "type": "custom",
                    "data": {"type": "knowledge-retrieval", "title": "KB2", "dataset_ids": []},
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
        intents = build.build_nodes("t1", {}, ["Retrieve from Company KB"]).intents

    kb_configs = [
        intent.args["config"]
        for intent in intents
        if intent.op == "create_node" and intent.args["node_type"] == "knowledge-retrieval"
    ]
    assert len(kb_configs) == 2
    assert kb_configs[0]["dataset_ids"] == ["kb-real"]
    assert kb_configs[1]["dataset_ids"] == ["kb-real"]
    assert kb_configs[0]["dataset_ids"] is not kb_configs[1]["dataset_ids"]


def test_build_nodes_logs_when_generator_reports_error(caplog):
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


def test_build_nodes_logs_traceback_when_generation_raises(caplog):
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


def test_build_nodes_returns_specific_generator_error_reason():
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


def test_build_nodes_returns_exception_text_as_error_reason():
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


def test_build_nodes_error_reason_joins_errors_list_when_no_top_level_error():
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


def test_build_nodes_records_structured_diagnostics_for_the_debug_export():
    """Server logs are lost when the api pod restarts, so the generator's own
    diagnostic ("structural validation failed") must travel back with the result:
    structured code/detail/node_id plus a server timestamp, so the exported debug
    log carries it and can be correlated with pod logs."""
    failing = {
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
    # one diagnostic per generation attempt (initial + the single corrective retry)
    assert len(result.diagnostics) == 2
    first = result.diagnostics[0]
    assert first["source"] == "workflow-generator"
    # the same text the server logged as the "%s" of "structural validation failed: %s"
    assert "Reference {#node2.response#} not declared" in first["message"]
    assert first["codes"] == ["UNRESOLVED_REFERENCE"]
    assert first["attempt"] == 1
    assert result.diagnostics[1]["attempt"] == 2
    # structured detail survives -- code AND the offending node id
    assert first["errors"][0]["code"] == "UNRESOLVED_REFERENCE"
    assert first["errors"][0]["node_id"] == "node2"
    # a server timestamp to locate the corresponding pod-log lines
    datetime.fromisoformat(first["at"])  # parses -> real ISO-8601
    assert first["at"].endswith("+00:00")  # UTC, unambiguous across pods


def test_build_nodes_records_diagnostic_when_generation_raises():
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


def test_build_nodes_keeps_the_applicable_intents_and_records_a_partial_reject(caplog):
    """An edge the generator's postprocess could not re-home (the if-else below
    declares only "true" / "false") is refused by apply_connect in the dry run.
    The rest of the build still applies, but the dropped connect must leave a
    warning and a debug-export diagnostic instead of vanishing."""
    graph = {
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

    # the applicable intents survive: 4 creates + the 2 connects on declared handles
    assert result.error == ""
    assert [i.op for i in result.intents].count("create_node") == 4
    connects = [(i.args["from_node"], i.args["to_node"]) for i in result.intents if i.op == "connect"]
    assert connects == [("s", "branch"), ("branch", "yes")]

    # ...and the dropped connect is named in a diagnostic
    assert len(result.diagnostics) == 1
    diagnostic = result.diagnostics[0]
    assert diagnostic["source"] == "build_nodes"
    datetime.fromisoformat(diagnostic["at"])
    assert len(diagnostic["rejected"]) == 1
    rejected = diagnostic["rejected"][0]
    assert rejected["intent"] == "connect"
    assert rejected["args"] == {"from_node": "branch", "to_node": "no", "source_handle": "maybe"}
    assert "has no handle 'maybe'" in rejected["reason"]

    # ...and in a server warning
    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "connect" in warnings[0]
    assert "'maybe'" in warnings[0]
    assert "has no handle" in warnings[0]


# ---- ESQ1-302: placeholder endpoints -----------------------------------------

_HTTP_BODY = {"type": "json", "data": [{"type": "text", "key": "", "value": "{}"}]}


def _gen_graph_with_http(url: str) -> dict:
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


def _build_with(gen_graph: dict, *, trusted_text: str = ""):
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


def test_build_nodes_grounds_a_placeholder_endpoint_into_a_required_start_variable():
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
    authorization: dict | None = None,
) -> dict:
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
    authorization: dict | None = None,
) -> dict:
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


def test_build_nodes_grounds_each_placeholder_endpoint_into_its_own_start_variable():
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


def test_build_nodes_does_not_duplicate_an_endpoint_variable_the_start_node_already_declares():
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


def test_build_nodes_leaves_a_real_endpoint_and_a_templated_url_alone():
    for url in ("https://api.openai.com/v1/chat", "{{#s.endpoint#}}/generate"):
        intents = _build_with(_gen_graph_with_http(url))
        http = next(i for i in intents if i.args.get("node_type") == "http-request")
        start = next(i for i in intents if i.args.get("node_type") == "start")
        assert http.args["config"]["url"] == url
        assert start.args["config"]["variables"] == []


def test_build_nodes_grounds_an_endpoint_the_user_never_supplied_even_when_not_placeholder_shaped():
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


def test_build_nodes_leaves_an_endpoint_alone_when_the_user_actually_supplied_its_host():
    """The mirror case: trusted_text literally names the same host the
    generated URL uses, so it is not a fabrication and must be left alone."""
    goal = "Call https://api.pptrender.io to render a slide deck from bullet points."
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=goal)

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    start = next(i for i in intents if i.args.get("node_type") == "start")
    assert http.args["config"]["url"] == "https://api.pptrender.io/v1/render"
    assert start.args["config"]["variables"] == []


def test_is_placeholder_endpoint_recognises_the_usual_inventions():
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


def test_build_nodes_grounds_an_invented_credential_header_into_a_required_start_variable():
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


def test_build_nodes_leaves_a_header_credential_alone_when_the_user_actually_supplied_it():
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


def test_build_nodes_grounds_an_invented_api_key_authorization_config():
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


def test_build_nodes_grounds_an_invented_api_key_param():
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


def test_build_nodes_grounds_a_bare_key_param():
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


def test_build_nodes_leaves_cache_key_and_key_points_params_alone():
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


def test_build_nodes_grounds_an_empty_api_key_authorization_config():
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


def test_build_nodes_grounds_an_empty_credential_header_line():
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


def test_build_nodes_leaves_an_already_templated_credential_header_alone():
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


def test_build_nodes_grounds_a_bare_scheme_word_keeping_it():
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


def test_build_nodes_grounds_a_credential_header_preserving_crlf_line_endings():
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


def test_build_nodes_grounds_an_invented_secret_absent_from_trusted_text():
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


def test_build_nodes_leaves_a_non_placeholder_secret_alone_in_placeholder_only_mode():
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


def test_build_nodes_grounds_both_an_invented_url_and_an_invented_header_on_the_same_node():
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


def _as_graph(intents) -> dict:
    """The node dicts ``endpoint_variable_names`` reads, built from the intents."""
    nodes = [
        {"id": i.args["node_id"], "data": {"type": i.args["node_type"], **(i.args.get("config") or {})}}
        for i in intents
        if i.op == "create_node"
    ]
    return {"nodes": nodes, "edges": []}


def test_build_nodes_grounds_only_the_origin_of_an_invented_url_with_a_templated_query():
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


def test_build_nodes_grounds_only_the_origin_of_an_invented_url_with_a_templated_path():
    intents = _build_with(
        _gen_graph_with_http("https://api.pptrender.io/v1/{{#node1.topic#}}/render"),
        trusted_text=_NO_URL_GOAL,
    )

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["url"] == "{{#s.h_url#}}/v1/{{#node1.topic#}}/render"


def test_build_nodes_grounds_only_the_origin_of_a_placeholder_url_with_a_templated_path():
    """Placeholder-only mode (no trusted text) too: the whole-URL replacement
    would silently drop the data template the node reads."""
    intents = _build_with(_gen_graph_with_http("https://api.example.com/ppt/{{#s.topic#}}"))

    http = next(i for i in intents if i.args.get("node_type") == "http-request")
    assert http.args["config"]["url"] == "{{#s.h_url#}}/ppt/{{#s.topic#}}"


def test_build_nodes_keeps_the_whole_url_label_for_a_url_without_templates():
    intents = _build_with(_gen_graph_with_http("https://api.pptrender.io/v1/render"), trusted_text=_NO_URL_GOAL)

    start = next(i for i in intents if i.args.get("node_type") == "start")
    var = next(v for v in start.args["config"]["variables"] if v["variable"] == "h_url")
    assert var["label"] == "Call PPT API URL"


def test_build_nodes_leaves_a_url_whose_host_is_a_template_alone():
    for url in ("{{#s.h_url#}}/v1/render", "https://{{#s.host#}}/v1", "{{#s.h_url#}}/{tenant}/x"):
        intents = _build_with(_gen_graph_with_http(url), trusted_text=_NO_URL_GOAL)
        http = next(i for i in intents if i.args.get("node_type") == "http-request")
        start = next(i for i in intents if i.args.get("node_type") == "start")
        assert http.args["config"]["url"] == url
        assert start.args["config"]["variables"] == []


def test_grounding_a_templated_url_is_idempotent():
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


def test_every_variable_url_grounding_creates_is_excluded_from_mocks_and_path_data_is_not():
    """Reviewer check (a): the grounding side and ``endpoint_variable_names``
    agree after the origin-only substitution -- the grounded ``h_url`` is a
    value a human must supply, the ``topic`` in the path/query stays mockable."""
    from core.dify_builder.handlers_fix import endpoint_variable_names

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
