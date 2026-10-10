"""Sensitive repair changes must override a model-authored low-risk verdict."""

from copy import deepcopy
from itertools import starmap

import pytest

from core.dify_builder.models import MutationIntent, Risk
from services.dify_builder.agent import fix


def _graph(node_type, **config):
    return {"nodes": [{"id": "n1", "data": {"type": node_type, **config}}], "edges": []}


def _set(path, value):
    return MutationIntent(op="set_node_config", args={"node_id": "n1", "path": path, "value": value})


@pytest.mark.parametrize(
    ("graph", "path", "value"),
    [
        (_graph("llm", model={"provider": "provider-a", "name": "model-a"}), "model.provider", "provider-b"),
        (_graph("llm", model={"provider": "provider-a", "name": "model-a"}), "model.name", "model-b"),
        (_graph("llm", model={"completion_params": {"max_tokens": 100}}), "model.completion_params.max_tokens", 10000),
        (_graph("tool", credential_id="credential-a"), "credential_id", "credential-b"),
        (_graph("tool", provider_id="resource-a"), "provider_id", "resource-b"),
        (_graph("start", variables=[{"variable": "query", "required": False}]), "variables.0.required", True),
        (
            _graph("end", outputs=[{"variable": "result", "value_selector": ["llm", "text"]}]),
            "outputs.0.variable",
            "answer",
        ),
        (_graph("http-request", url="https://old.example.test"), "url", "https://new.example.test"),
        (
            _graph("http-request", authorization={"type": "no-auth"}),
            "authorization",
            {"type": "api-key", "config": {"type": "bearer", "api_key": "private-token"}},
        ),
        (
            _graph("assigner", items=[{"variable_selector": ["conversation", "old"], "value": "value"}]),
            "items.0.variable_selector",
            ["conversation", "new"],
        ),
        (
            _graph("llm", context={"enabled": False, "variable_selector": ["retrieval", "result"]}),
            "context.enabled",
            True,
        ),
        (_graph("llm", memory=None), "memory", {"window": {"enabled": True, "size": 10}}),
        (_graph("knowledge-retrieval", dataset_ids=["dataset-a"]), "dataset_ids", ["dataset-b"]),
    ],
    ids=[
        "llm-provider",
        "llm-name",
        "llm-cost-config",
        "tool-credential",
        "tool-resource",
        "start-contract",
        "end-contract",
        "http-target",
        "http-auth",
        "conversation-variable",
        "llm-context-access",
        "conversation-memory",
        "dataset",
    ],
)
def test_sensitive_changes_require_approval_despite_low_model_verdict(graph, path, value):
    risk = fix._shape_risk([_set(path, value)], graph, Risk(level="low", reason="safe config repair"))

    assert risk.level == "high"
    assert risk.reason != "safe config repair"
    assert "private-token" not in risk.reason


@pytest.mark.parametrize("replace_all_config", [False, True])
def test_prompt_repair_with_unchanged_model_remains_low_risk(replace_all_config):
    graph = _graph(
        "llm",
        model={"provider": "provider-a", "name": "model-a", "mode": "chat", "completion_params": {}},
        context={"enabled": False},
        prompt_template=[{"role": "user", "text": "old prompt"}],
    )
    intents = [_set("prompt_template", [{"role": "user", "text": "fixed prompt"}])]
    if replace_all_config:
        intents = list(starmap(_set, graph["nodes"][0]["data"].items())) + intents
    before = deepcopy((graph, intents))

    risk = fix._shape_risk(intents, graph, Risk(level="low"))

    assert risk.level == "low"
    assert (graph, intents) == before


@pytest.mark.parametrize(
    ("config", "path", "value"),
    [
        ({"model": {"provider": "a", "name": "one"}}, "model", {"provider": "a", "name": "two"}),
        ({"binding": {"credential_id": "old"}}, "binding", {}),
        ({"binding": {"provider_id": "old"}}, "binding.provider_id", "new"),
        (
            {"variables": [{"value_selector": ["conversation", "old"]}]},
            "variables",
            [{"value_selector": ["conversation", "new"]}],
        ),
        (
            {"prompt_template": [{"text": "Use {{#conversation.old#}}"}]},
            "prompt_template.0.text",
            "Use {{#conversation.new#}}",
        ),
    ],
    ids=["model-object", "credential-removal", "nested-resource", "variable-binding", "prompt-data-binding"],
)
def test_parent_replacements_and_nested_bindings_cannot_bypass_approval(config, path, value):
    assert fix._shape_risk([_set(path, value)], _graph("llm", **config), Risk(level="low")).level == "high"


def test_policy_compares_final_batch_effect_and_preserves_evidence():
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    graph = _graph("llm", model={"provider": "a", "name": "one"}, prompt_template=[{"text": "old"}])
    intents = [_set("model.name", "two"), _set("model.name", "one"), _set("prompt_template.0.text", "fixed")]
    before = deepcopy((graph, intents))

    assert sensitive_change_reasons(graph, intents) == []
    assert (graph, intents) == before


@pytest.mark.parametrize(
    ("graph", "intent"),
    [
        (_graph("tool", provider_id="old"), _set("provider_id", "new")),
        (_graph("tool", credential_id="old"), _set("credential_id", "new")),
        (_graph("http-request", url="https://old.test"), _set("url", "https://new.test")),
        (_graph("http-request", authorization={"type": "no-auth"}), _set("authorization", {"type": "api-key"})),
    ],
    ids=["tool-resource", "tool-credential", "http-target", "http-auth"],
)
def test_policy_detects_sensitive_external_changes_independently_of_external_guard(graph, intent):
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    assert sensitive_change_reasons(graph, [intent])


def test_identical_resource_model_and_data_access_fields_do_not_escalate_title_repair():
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    graph = _graph(
        "llm",
        title="old",
        model={"provider": "a", "name": "one"},
        context={"enabled": True, "variable_selector": ["knowledge", "result"]},
        binding={"resource_id": "resource-a", "credential_id": "credential-a"},
    )
    intents = list(starmap(_set, graph["nodes"][0]["data"].items())) + [_set("title", "fixed")]

    assert sensitive_change_reasons(graph, intents) == []
    assert fix._shape_risk(intents, graph, Risk(level="low")).level == "low"


def test_changing_node_type_cannot_bypass_existing_external_guard():
    graph = _graph("code", type_marker="compute")

    assert fix._shape_risk([_set("type", "http-request")], graph, Risk(level="low")).level == "high"


@pytest.mark.parametrize("grouped", [False, True], ids=["ordinary", "grouped"])
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_native_aggregator_selector_changes_require_approval_only_when_final_access_changes(grouped, effect):
    """Missing aggregator projection would auto-approve an upstream data-source switch."""
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    graph = _graph(
        "variable-aggregator",
        title="Aggregator",
        output_type="string",
        variables=[["source-a", "text"]],
        advanced_settings={
            "group_enabled": grouped,
            "groups": [{"group_name": "answer", "output_type": "string", "variables": [["source-a", "text"]]}],
        },
    )
    path = "advanced_settings.groups.0.variables" if grouped else "variables"
    intents = [_set(path, [["source-a" if effect == "identical" else "source-b", "text"]])]
    if effect == "reverted":
        intents.append(_set(path, [["source-a", "text"]]))
    intents.append(_set("title", "Corrected aggregator"))
    before = deepcopy((graph, intents))

    reasons = sensitive_change_reasons(graph, intents)
    risk = fix._shape_risk(intents, graph, Risk(level="low", reason="safe config repair"))

    assert bool(reasons) is (effect == "switch")
    assert risk.level == ("high" if effect == "switch" else "low")
    assert (graph, intents) == before


@pytest.mark.parametrize(
    ("graph", "path", "original", "replacement"),
    [
        (
            _graph("list-operator", variable=["s", "public_items"]),
            "variable",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
        (
            _graph("iteration", iterator_selector=["s", "public_items"]),
            "iterator_selector",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
        (
            _graph("iteration", output_selector=["s", "public_items"]),
            "output_selector",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
        (
            _graph("agent", agent_parameters={"query": {"type": "variable", "value": ["s", "public_items"]}}),
            "agent_parameters.query.value",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
        (
            _graph("agent", agent_parameters={"query": {"type": "constant", "value": ["s", "public_items"]}}),
            "agent_parameters.query.type",
            "constant",
            "variable",
        ),
    ],
    ids=["list-source", "iteration-input", "iteration-output", "agent-source", "agent-access-activation"],
)
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_native_data_access_requires_approval_for_final_selector_or_activation_changes(
    graph, path, original, replacement, effect
):
    """Native selector fields and Agent binding modes must override a low model verdict."""
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    intents = [_set(path, original if effect == "identical" else replacement)]
    if effect == "reverted":
        intents.append(_set(path, original))
    intents.append(_set("title", "Corrected node"))
    before = deepcopy((graph, intents))

    risk = fix._shape_risk(intents, graph, Risk(level="low"))
    reasons = sensitive_change_reasons(graph, intents)

    assert risk.level == ("high" if effect == "switch" else "low")
    assert bool(reasons) is (effect == "switch")
    assert (graph, intents) == before


@pytest.mark.parametrize("input_type", ["constant", "mixed"])
@pytest.mark.parametrize(
    ("original", "replacement", "sensitive"),
    [
        ("old prompt", "fixed prompt", False),
        (["s", "public_items"], ["s", "private_items"], False),
        (["conversation", "public_items"], ["conversation", "private_items"], False),
        ("Use {{#s.public_items#}}", "Use {{#s.private_items#}}", True),
        ("Use {{#s.public_items#}}", "Corrected prompt using {{#s.public_items#}}", False),
    ],
    ids=[
        "ordinary-prompt",
        "static-source-looking-list",
        "static-conversation-looking-list",
        "actual-template-binding",
        "unchanged-template-binding",
    ],
)
def test_agent_literal_inputs_preserve_static_repairs_and_protect_actual_template_access(
    input_type, original, replacement, sensitive
):
    graph = _graph("agent", agent_parameters={"query": {"type": input_type, "value": original}})

    risk = fix._shape_risk([_set("agent_parameters.query.value", replacement)], graph, Risk(level="low"))

    assert risk.level == ("high" if sensitive else "low")


def test_agent_constant_to_mixed_with_static_value_does_not_activate_selector_access():
    graph = _graph("agent", agent_parameters={"query": {"type": "constant", "value": ["s", "public_items"]}})

    assert fix._shape_risk([_set("agent_parameters.query.type", "mixed")], graph, Risk(level="low")).level == "low"


@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_agent_native_memory_access_is_reviewed_by_final_effect(effect):
    graph = _graph("agent", memory=None)
    memory = {"window": {"enabled": False, "size": 10}}  # runtime reads history when memory is present
    intents = [_set("memory", None if effect == "identical" else memory)]
    if effect == "reverted":
        intents.append(_set("memory", None))
    intents.append(_set("title", "Corrected agent"))

    assert fix._shape_risk(intents, graph, Risk(level="low")).level == ("high" if effect == "switch" else "low")


@pytest.mark.parametrize(
    ("enabled", "auto", "input_type", "path", "original", "replacement", "sensitive"),
    [
        (True, 0, "variable", "value.value", ["s", "public_items"], ["s", "private_items"], True),
        (True, 1, "variable", "auto", 1, 0, True),
        (False, 0, "variable", "enabled", False, True, True),
        (True, 0, "constant", "value.type", "constant", "variable", True),
        (False, 0, "variable", "value.value", ["s", "public_items"], ["s", "private_items"], False),
        (True, 1, "variable", "value.value", ["s", "public_items"], ["s", "private_items"], False),
        (True, 0, "constant", "value.value", ["s", "public_items"], ["s", "private_items"], False),
        (False, 1, "variable", "auto", 1, 0, False),
    ],
    ids=[
        "manual-source",
        "auto-activates",
        "enabled-activates",
        "type-activates",
        "disabled-source",
        "automatic-source",
        "literal-source",
        "disabled-auto-metadata",
    ],
)
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_agent_native_tool_access_metadata_controls_selector_projection(
    enabled, auto, input_type, path, original, replacement, sensitive, effect
):
    tool = {
        "enabled": enabled,
        "provider_name": "provider-a",
        "tool_name": "search",
        "parameters": {"query": {"auto": auto, "value": {"type": input_type, "value": ["s", "public_items"]}}},
    }
    graph = _graph("agent", agent_parameters={"dynamic_tools": {"type": "constant", "value": [tool]}})
    prefix = "agent_parameters.dynamic_tools.value.0"
    native_path = prefix + (".enabled" if path == "enabled" else ".parameters.query." + path)
    intents = [_set(native_path, original if effect == "identical" else replacement)]
    if effect == "reverted":
        intents.append(_set(native_path, original))
    before = deepcopy((graph, intents))

    risk = fix._shape_risk(intents, graph, Risk(level="low"))

    assert risk.level == ("high" if sensitive and effect == "switch" else "low")
    assert (graph, intents) == before


def test_list_filter_enabled_metadata_is_an_ordinary_configuration_repair():
    graph = _graph("list-operator", variable=["s", "public_items"], filter_by={"enabled": False})

    assert fix._shape_risk([_set("filter_by.enabled", True)], graph, Risk(level="low")).level == "low"


@pytest.mark.parametrize(
    ("path", "original", "replacement"),
    [
        ("provider", "provider-a", "provider-b"),
        ("model", "model-a", "model-b"),
        ("completion_params.max_tokens", 100, 10000),
    ],
)
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_agent_model_selector_under_dynamic_parameter_name_requires_review(path, original, replacement, effect):
    graph = _graph(
        "agent",
        agent_parameters={
            "dynamic_engine": {
                "type": "constant",
                "value": {
                    "provider": "provider-a",
                    "model": "model-a",
                    "mode": "chat",
                    "completion_params": {"max_tokens": 100},
                },
            },
        },
    )
    native_path = "agent_parameters.dynamic_engine.value." + path
    intents = [_set(native_path, original if effect == "identical" else replacement)]
    if effect == "reverted":
        intents.append(_set(native_path, original))

    assert fix._shape_risk(intents, graph, Risk(level="low")).level == ("high" if effect == "switch" else "low")


@pytest.mark.parametrize(
    ("node_type", "config", "path", "original", "replacement"),
    [
        (
            "parameter-extractor",
            {"query": ["s", "public_items"]},
            "query",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
        ("parameter-extractor", {"memory": None}, "memory", None, {"window": {"enabled": False, "size": 10}}),
        ("question-classifier", {"memory": {"window": {"enabled": False, "size": 1}}}, "memory.window.size", 1, 10),
        ("question-classifier", {"memory": None}, "memory", None, {"window": {"enabled": False, "size": 10}}),
        ("parameter-extractor", {"memory": {"window": {"enabled": False, "size": 1}}}, "memory.window.size", 1, 10),
        (
            "parameter-extractor",
            {"vision": {"enabled": False, "configs": {"variable_selector": ["s", "files"]}}},
            "vision.enabled",
            False,
            True,
        ),
        (
            "question-classifier",
            {"vision": {"enabled": False, "configs": {"variable_selector": ["s", "files"]}}},
            "vision.enabled",
            False,
            True,
        ),
        (
            "knowledge-index",
            {"index_chunk_variable_selector": ["s", "public_items"]},
            "index_chunk_variable_selector",
            ["s", "public_items"],
            ["s", "private_items"],
        ),
    ],
    ids=[
        "extractor-query",
        "extractor-history-presence",
        "classifier-history-scope",
        "classifier-history-presence",
        "extractor-history-scope",
        "extractor-vision-activation",
        "classifier-vision-activation",
        "index-chunk-source",
    ],
)
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_native_model_and_index_access_requires_review_of_final_effect(
    node_type, config, path, original, replacement, effect
):
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    graph = _graph(node_type, instruction="old prompt", **config)
    intents = [_set(path, original if effect == "identical" else replacement)]
    if effect == "reverted":
        intents.append(_set(path, original))
    intents.append(_set("instruction", "Corrected prompt"))
    before = deepcopy((graph, intents))

    assert fix._shape_risk(intents, graph, Risk(level="low")).level == ("high" if effect == "switch" else "low")
    assert bool(sensitive_change_reasons(graph, intents)) is (effect == "switch")
    assert (graph, intents) == before


@pytest.mark.parametrize("node_type", ["parameter-extractor", "question-classifier"])
def test_native_model_instruction_repair_preserves_unchanged_access_configuration(node_type):
    config = {
        "model": {"provider": "provider-a", "name": "model-a", "mode": "chat", "completion_params": {}},
        "query" if node_type == "parameter-extractor" else "query_variable_selector": ["s", "public_items"],
        "memory": {"window": {"enabled": False, "size": 10}},
        "vision": {"enabled": False, "configs": {"variable_selector": ["s", "files"]}},
        "instruction": "old prompt",
    }
    graph = _graph(node_type, **config)
    intents = list(starmap(_set, config.items())) + [_set("instruction", "Corrected prompt")]

    assert fix._shape_risk(intents, graph, Risk(level="low")).level == "low"


@pytest.mark.parametrize(
    ("input_type", "path", "original", "replacement", "sensitive"),
    [
        ("variable", "value", ["s", "public_items"], ["s", "private_items"], True),
        ("constant", "value_type", "constant", "variable", True),
        ("constant", "value", ["s", "public_items"], ["s", "private_items"], False),
        ("constant", "value", ["conversation", "public_items"], ["conversation", "private_items"], False),
        ("constant", "value", "old prompt", "Corrected prompt", False),
        ("constant", "value", "Use {{#s.public_items#}}", "Use {{#s.private_items#}}", False),
    ],
    ids=[
        "loop-source",
        "loop-access-activation",
        "loop-static-list",
        "loop-static-conversation-list",
        "loop-static-prose",
        "loop-literal-template",
    ],
)
@pytest.mark.parametrize("effect", ["switch", "identical", "reverted"])
def test_native_loop_typed_inputs_project_active_access_only(
    input_type, path, original, replacement, sensitive, effect
):
    from services.dify_builder.mutation_policy import sensitive_change_reasons

    graph = _graph(
        "loop",
        loop_variables=[
            {
                "label": "items",
                "var_type": "string" if path == "value" and isinstance(original, str) else "array[string]",
                "value_type": input_type,
                "value": original if path == "value" else ["s", "public_items"],
            }
        ],
    )
    native_path = "loop_variables.0." + path
    intents = [_set(native_path, original if effect == "identical" else replacement)]
    if effect == "reverted":
        intents.append(_set(native_path, original))
    intents.append(_set("title", "Corrected loop"))
    before = deepcopy((graph, intents))

    assert fix._shape_risk(intents, graph, Risk(level="low")).level == (
        "high" if sensitive and effect == "switch" else "low"
    )
    assert bool(sensitive_change_reasons(graph, intents)) is (sensitive and effect == "switch")
    assert (graph, intents) == before
