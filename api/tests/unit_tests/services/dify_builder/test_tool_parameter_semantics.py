"""Semantic tool-binding guidance and deterministic generated-graph execution.

The model replies are explicit fixtures, not actual-model acceptance. Only the
fixture's local parser and Graphon's pure parameter renderer execute; no GitHub
request, credentials, native graph execution, or sandbox service is involved.
"""

import json
import re
from collections.abc import Callable, Iterator
from copy import deepcopy
from typing import cast

import pytest

from core.dify_builder.models import Diagnosis, Graph
from core.model_manager import ModelInstance
from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeParameter
from graphon.runtime import VariablePool
from services.dify_builder import graph_ops
from services.dify_builder.agent import edit, fix
from services.workflow_generation.runner import WorkflowGenerator
from tests.unit_tests.core.model_fixtures import make_model_config
from tests.unit_tests.services.dify_builder.installed_tool_inventory import forbid_secret_and_business_calls


@pytest.fixture(autouse=True)
def no_external_calls(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    calls = forbid_secret_and_business_calls(monkeypatch)
    yield
    assert calls == []


# Representative declared tool contract. Production obtains the selected action
# from the actor-scoped inventory; this fixture does not assert it is installed.
_ENTRY = cast(
    ToolCatalogueEntry,
    {
        "provider_name": "langgenius/github/github",
        "provider_type": "builtin",
        "plugin_id": "langgenius/github",
        "tool_name": "list_issues",
        "tool_label": "List Issues",
        "description": "List repository issues",
        "parameters": [
            {
                "name": "owner",
                "type": "string",
                "form": "llm",
                "required": True,
                "llm_description": "The repository owner (a user or organization), not a repository URL",
            },
            {
                "name": "repo",
                "type": "string",
                "form": "llm",
                "required": True,
                "llm_description": "The repository name without its owner or URL",
            },
        ],
    },
)
_START_INPUT = {"variable": "repository", "label": "Repository (owner/repo or GitHub URL)", "type": "text-input"}
# This is the deterministic model's generated Code response, not a production
# normalizer. Production must generate such a transformation from the contract.
_PARSER = """from urllib.parse import urlsplit

def main(repository: str) -> dict:
    value = repository.strip()
    if "://" in value:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.netloc != "github.com":
            raise ValueError("Expected an HTTPS GitHub repository URL")
        value = parsed.path.strip("/")
    parts = value.split("/")
    if len(parts) != 2 or not all(parts):
        raise ValueError("Expected owner/repo")
    owner, repo = parts
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not repo:
        raise ValueError("Expected repository name")
    return {"owner": owner, "repo": repo}
"""
_PLAN = {
    "title": "Repository Issues",
    "description": "Read issues",
    "mode": "workflow",
    "start_inputs": [_START_INPUT],
    "nodes": [
        {"id": "node1", "label": "Start", "node_type": "start", "purpose": "Receive repository"},
        {
            "id": "node2",
            "label": "Parse Repository",
            "node_type": "code",
            "purpose": "Parse owner/repo or GitHub URL into separate owner and repo strings",
        },
        {
            "id": "node3",
            "label": "List Issues",
            "node_type": "tool",
            "purpose": "Use github/list_issues",
            "tool": {"provider_id": _ENTRY["provider_name"], "tool_name": _ENTRY["tool_name"]},
        },
        {"id": "node4", "label": "End", "node_type": "end", "purpose": "Return issues"},
    ],
    "edges": [{"source": f"node{i}", "target": f"node{i + 1}"} for i in range(1, 4)],
    "node_outputs": {"node2": ["owner", "repo"]},
}
_CONFIGS = {
    "node1": {"variables": [{**_START_INPUT, "required": True, "max_length": 512, "options": []}]},
    "node2": {
        "code_language": "python3",
        "code": _PARSER,
        "variables": [{"variable": "repository", "value_selector": ["node1", "repository"]}],
        "outputs": {name: {"type": "string", "children": None} for name in ("owner", "repo")},
    },
    "node3": {
        "provider_id": _ENTRY["provider_name"],
        "provider_type": "builtin",
        "provider_name": _ENTRY["provider_name"],
        "tool_name": _ENTRY["tool_name"],
        "tool_label": "List Issues",
        "tool_configurations": {},
        "tool_parameters": {name: {"type": "variable", "value": ["node2", name]} for name in ("owner", "repo")},
    },
    "node4": {"outputs": [{"variable": "issues", "value_selector": ["node3", "text"]}]},
}


def _model(monkeypatch: pytest.MonkeyPatch) -> ModelInstance:
    config = make_model_config(provider="fixture", model="fixture", mode="chat")
    model = ModelInstance(provider_model_bundle=config.provider_model_bundle, model=config.model, credentials={})
    monkeypatch.setattr(model, "get_model_schema", lambda: config.model_schema)
    return model


def _generate(monkeypatch: pytest.MonkeyPatch) -> tuple[Graph, dict[str, str]]:
    model = _model(monkeypatch)
    prompts: dict[str, str] = {}

    def invoke_llm(*, prompt_messages, **_kwargs):
        prompt = "\n".join(str(message.content) for message in prompt_messages)
        if "workflow planner" in str(prompt_messages[0].content):
            prompts["planner"] = prompt
            payload = _PLAN
        else:
            match = re.search(r"id=(node\d+), type=", prompt)
            assert match is not None
            node_id = match[1]
            prompts[node_id] = prompt
            payload = {"config": _CONFIGS[node_id]}
        return LLMResult(
            model="fixture",
            prompt_messages=prompt_messages,
            message=AssistantPromptMessage(content=json.dumps(payload)),
            usage=LLMUsage.empty_usage(),
        )

    # Patch the real provider invocation boundary; all graph generation and
    # response entities remain production owners, with no credential resolution.
    monkeypatch.setattr(model, "invoke_llm", invoke_llm)
    result = WorkflowGenerator.generate_workflow_graph(
        model_instance=model,
        model_parameters={},
        provider="fixture",
        model_name="fixture",
        model_mode="chat",
        mode="workflow",
        instruction="List issues from a repository entered as owner/repo or a full GitHub URL.",
        tool_catalogue_entries=[_ENTRY],
        installed_tools={(_ENTRY["provider_name"], _ENTRY["tool_name"])},
    )
    assert result["error"] == "", result
    return cast(Graph, result["graph"]), prompts


def _render(graph: Graph, repository: str) -> dict[str, object]:
    configs = {node["id"]: node["data"] for node in graph["nodes"]}
    # Evaluate exactly the generated parser config and bind its declared inputs.
    namespace: dict[str, object] = {}
    exec(configs["node2"]["code"], namespace)  # noqa: S102 -- explicit local model fixture only
    start_values = {"node1": {"repository": repository}}
    arguments = {
        item["variable"]: start_values[item["value_selector"][0]][item["value_selector"][1]]
        for item in configs["node2"]["variables"]
    }
    outputs = cast(Callable[..., dict[str, str]], namespace["main"])(**arguments)
    assert set(outputs) == set(configs["node2"]["outputs"])
    pool = VariablePool()
    for name, value in outputs.items():
        pool.add(["node2", name], value)
    # This real native method is pure; no Tool runtime lookup/invocation occurs.
    return ToolNode.__new__(ToolNode)._generate_parameters(
        tool_parameters=[ToolRuntimeParameter(name=name, required=True) for name in ("owner", "repo")],
        variable_pool=pool,
        node_data=ToolNodeData.model_validate(configs["node3"]),
    )


def test_planner_and_builders_receive_semantic_binding_rules() -> None:
    for prompt in (
        PLANNER_SYSTEM_PROMPT,
        get_node_builder_system_prompt("tool"),
        get_node_builder_system_prompt("code"),
    ):
        assert "Tool parameter semantics:" in prompt
        assert "composite input" in prompt
        assert "Authorization cannot add undeclared parameters or capabilities" in prompt
        assert "unsupported setting as pending setup" in prompt
        assert "constant" in prompt
        assert "node1.owner" in prompt


@pytest.mark.parametrize(
    "repository", ["langgenius/dify", "https://github.com/langgenius/dify", "https://github.com/langgenius/dify.git/"]
)
def test_generated_parser_feeds_distinct_native_tool_parameters(
    monkeypatch: pytest.MonkeyPatch, repository: str
) -> None:
    graph, model = _generate(monkeypatch)
    assert "Tool parameter semantics:" in model["planner"]
    assert "owner: string, form=llm, required" in model["node3"]
    assert "The repository name without its owner or URL" in model["node3"]
    assert "Repository (owner/repo or GitHub URL)" in model["node2"]
    assert _render(graph, repository) == {"owner": "langgenius", "repo": "dify"}


@pytest.mark.parametrize("agent", ["edit", "fix"])
def test_repair_reference_literals_uses_real_selector_shape(monkeypatch: pytest.MonkeyPatch, agent: str) -> None:
    graph, _ = _generate(monkeypatch)
    graph["nodes"][2]["data"]["tool_parameters"] = {
        "owner": {"type": "constant", "value": "node1.owner"},
        "repo": {"type": "constant", "value": "https://github.com/langgenius/dify"},
    }
    seen: list[str] = []
    users: list[str] = []

    def invoke(_model, *, system, user, **_kwargs):
        seen.append(system)
        users.append(user)
        return {
            "intents": [
                {
                    "op": "set_node_config",
                    "args": {
                        "node_id": "node3",
                        "path": "tool_parameters",
                        "value": deepcopy(_CONFIGS["node3"]["tool_parameters"]),
                    },
                }
            ],
            "risk": {"level": "low", "reason": "Bind parsed repository", "has_external_side_effect": False},
        }

    monkeypatch.setattr(fix.llm, "invoke_json", invoke)
    if agent == "fix":
        intents, _ = fix.propose_repair(
            _model(monkeypatch), Diagnosis(culprit_node_id="node3", root_cause="Wrong owner/repo bindings"), graph
        )
    else:
        intents = edit.build_edit_intents(_model(monkeypatch), {"goal": "Bind parsed owner/repo parameters"}, graph)
    assert "SOURCE VALUE DECLARATIONS:" in users[0]
    assert "Repository (owner/repo or GitHub URL)" in users[0]
    assert '"node2"' in users[0]
    assert '"owner": "string"' in users[0]
    assert '"repo": "string"' in users[0]
    assert "Tool parameter semantics:" in seen[0]
    assert "node1.owner" in seen[0]
    assert "constant" in seen[0]
    assert len(intents) == 1
    repaired, _ = graph_ops.apply_set_node_config(graph, **intents[0].args)
    assert _render(repaired, "https://github.com/langgenius/dify") == {"owner": "langgenius", "repo": "dify"}


@pytest.mark.parametrize("agent_method", ["propose_repair", "build_edit_intents"])
def test_missing_parser_repair_receives_installed_contract_and_start_schema(
    monkeypatch: pytest.MonkeyPatch, agent_method: str
) -> None:
    from services.dify_builder.agent import resources
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    graph, _ = _generate(monkeypatch)
    graph["nodes"] = [node for node in graph["nodes"] if node["id"] != "node2"]
    graph["edges"] = [
        {"id": "input-tool", "source": "node1", "target": "node3"},
        {"id": "tool-end", "source": "node3", "target": "node4"},
    ]
    graph["nodes"][1]["data"]["tool_parameters"] = {
        name: {"type": "variable", "value": ["node1", "repository"]} for name in ("owner", "repo")
    }
    lookup_tenants: list[str] = []

    def lookup(tenant_id: str) -> list[ToolCatalogueEntry]:
        lookup_tenants.append(tenant_id)
        return [_ENTRY]

    monkeypatch.setattr(resources, "_list_tools", lookup)
    seen: list[str] = []

    def invoke(_model, *, user, **_kwargs):
        seen.append(user)
        return {
            "intents": [
                {
                    "op": "insert_between",
                    "args": {
                        "edge": {"source": "node1", "target": "node3"},
                        "node_type": "code",
                        "node_id": "node2",
                        "config": deepcopy(_CONFIGS["node2"]),
                    },
                },
                {
                    "op": "set_node_config",
                    "args": {
                        "node_id": "node3",
                        "path": "tool_parameters",
                        "value": deepcopy(_CONFIGS["node3"]["tool_parameters"]),
                    },
                },
            ],
            "risk": {"level": "high", "reason": "Add missing parser", "has_external_side_effect": False},
        }

    monkeypatch.setattr(fix.llm, "invoke_json", invoke)
    agent = LlmBuilderAgent("tenant-visible", {}, account_id="actor")
    model = _model(monkeypatch)
    monkeypatch.setattr(agent, "model_or_none", lambda: model)
    if agent_method == "propose_repair":
        intents, risk = agent.propose_repair(
            Diagnosis(culprit_node_id="node3", root_cause="Whole repository passed twice"), graph
        )
        assert risk.level == "high"
    else:
        intents = agent.build_edit_intents(
            {"goal": "Parse repository before tool"}, graph, edit_target_node_ids=["node3"]
        )
    assert lookup_tenants == ["tenant-visible"]
    assert "Repository (owner/repo or GitHub URL)" in seen[0]
    assert "owner: string, form=llm, required" in seen[0]
    assert "The repository name without its owner or URL" in seen[0]
    assert "provider_id" in seen[0]
    assert len(intents) == 2
    for intent in intents:
        graph, _ = graph_ops.APPLY_FNS[intent.op](graph, **intent.args)
    for value in ("langgenius/dify", "https://github.com/langgenius/dify"):
        assert _render(graph, value) == {"owner": "langgenius", "repo": "dify"}


def test_source_declarations_exclude_values_and_code(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import graph_prompt

    graph, _ = _generate(monkeypatch)
    graph["nodes"][0]["data"]["variables"][0]["default"] = "private-start-default"
    graph["nodes"][1]["data"]["code"] = "private-code-body"
    graph["nodes"][1]["data"]["outputs"]["owner"]["description"] = "private-output-description"
    context = graph_prompt.source_value_declarations(graph)
    assert "Repository (owner/repo or GitHub URL)" in context
    assert '"owner": "string"' in context
    for private in ("private-start-default", "private-code-body", "private-output-description"):
        assert private not in context


def test_repair_contract_matches_exact_provider_action_and_type(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import resources

    graph, _ = _generate(monkeypatch)
    unrelated = {**_ENTRY, "provider_name": "other/provider", "description": "unrelated-private-action"}
    wrong_type = {**_ENTRY, "provider_type": "api", "description": "wrong-type-private-action"}
    monkeypatch.setattr(resources, "_list_tools", lambda _tenant: [unrelated, wrong_type, _ENTRY])
    context = resources.tool_parameter_context("tenant", graph)
    assert "The repository name without its owner or URL" in context
    assert "unrelated-private-action" not in context
    assert "wrong-type-private-action" not in context


def test_repair_contract_source_failure_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import resources

    graph, _ = _generate(monkeypatch)

    def unavailable(_tenant: str) -> list[ToolCatalogueEntry]:
        raise RuntimeError("private-source-error")

    monkeypatch.setattr(resources, "_list_tools", unavailable)
    context = resources.tool_parameter_context("tenant", graph)
    assert "declarations unavailable" in context
    assert "private-source-error" not in context
    assert "owner:" not in context
