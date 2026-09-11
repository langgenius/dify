import logging
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
    with patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")), \
         patch(
             "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
             return_value={"graph": {}, "error": "generator boom", "errors": []},
         ), \
         caplog.at_level(logging.WARNING, logger="services.dify_builder.agent.build"):
        out = build.build_nodes("t1", {}, ["do a thing"]).intents

    assert out == []
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "no graph" in warnings[0].getMessage()
    assert "generator boom" in warnings[0].getMessage()


def test_build_nodes_logs_traceback_when_generation_raises(caplog):
    with patch.object(build, "_generator_model_config", return_value=_fake_mc("anthropic", "x")), \
         patch(
             "services.dify_builder.agent.build.WorkflowGeneratorService.generate_workflow_graph",
             side_effect=RuntimeError("kaboom"),
         ), \
         caplog.at_level(logging.ERROR, logger="services.dify_builder.agent.build"):
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
