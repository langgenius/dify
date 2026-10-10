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
