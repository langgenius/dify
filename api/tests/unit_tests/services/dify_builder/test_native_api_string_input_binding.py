"""Generated API text bindings remain editable and native-render equivalent."""

import json
from collections.abc import Iterator
from copy import deepcopy
from pathlib import Path
from typing import cast

import pytest

from core.app.apps.base_app_generator import BaseAppGenerator
from core.tools.utils.parser import ApiBasedToolSchemaParser
from core.workflow.generator.runner import WorkflowGenerator
from core.workflow.generator.tool_catalogue import ToolCatalogueEntry
from core.workflow.generator.types import GraphDict
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.exc import ToolParameterError
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeParameter
from graphon.runtime import VariablePool
from graphon.variables.input_entities import VariableEntity, VariableEntityType
from graphon.variables.segments import NoneSegment, StringSegment
from tests.unit_tests.services.dify_builder.installed_tool_inventory import forbid_secret_and_business_calls


@pytest.fixture(autouse=True)
def no_business_or_credential_calls(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    calls = forbid_secret_and_business_calls(monkeypatch)
    yield
    assert calls == []


_PROVIDER = "14076462-4152-4ef0-aad2-3eaea9369b1a"
_ACTION = "qa_news_search"


def _entry() -> ToolCatalogueEntry:
    fixture = Path(__file__).parents[1] / "tools" / "fixtures" / "qa_news_search_openapi.json"
    schema = cast(dict[str, object], json.loads(fixture.read_text()))
    bundle = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(schema)[0]
    assert bundle.parameters is not None
    return cast(
        ToolCatalogueEntry,
        {
            "provider_name": _PROVIDER,
            "provider_type": "api",
            "plugin_id": "",
            "tool_name": _ACTION,
            "tool_label": "QA News Search",
            "description": "Controlled public metadata",
            "needs_credentials": False,
            "parameters": [parameter.model_dump(mode="json") for parameter in bundle.parameters],
            "output_schema": {},
        },
    )


def _graph(
    binding: object, *, source_type: str = "text-input", source_id: str = "node1", field: str = "keyword"
) -> GraphDict:
    return cast(
        GraphDict,
        {
            "nodes": [
                {"id": source_id, "data": {"type": "start", "variables": [{"variable": field, "type": source_type}]}},
                {
                    "id": "node2",
                    "data": {
                        "type": "tool",
                        "provider_id": _PROVIDER,
                        "tool_name": _ACTION,
                        "tool_parameters": {
                            "query": binding,
                            "timespan": {"type": "constant", "value": "24h"},
                            "maxrecords": {"type": "constant", "value": 5},
                        },
                    },
                },
            ],
            "edges": [],
        },
    )


def _hydrate(graph: GraphDict, entry: ToolCatalogueEntry) -> dict[str, object]:
    WorkflowGenerator._hydrate_tool_nodes(
        graph=graph,
        plan_nodes=[
            {"id": "node2", "node_type": "tool", "tool": {"provider_id": entry["provider_name"], "tool_name": _ACTION}}
        ],
        tool_catalogue_entries=[entry],
    )
    return cast(dict[str, object], graph["nodes"][1]["data"])


@pytest.mark.parametrize("source_type", ["text-input", "paragraph"])
def test_hydration_normalizes_public_api_string_start_binding(source_type: str) -> None:
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    graph = _graph(binding, source_type=source_type)
    entry = _entry()
    source_before, entry_before = deepcopy(graph["nodes"][0]), deepcopy(entry)
    data = _hydrate(graph, entry)
    assert data["tool_parameters"] == {
        "query": {"type": "mixed", "value": "{{#node1.keyword#}}"},
        "timespan": {"type": "constant", "value": "24h"},
        "maxrecords": {"type": "constant", "value": 5},
    }
    assert data["provider_id"] == _PROVIDER
    assert data["tool_name"] == _ACTION
    assert graph["nodes"][0] == source_before
    assert entry == entry_before
    assert binding == {"type": "variable", "value": ["node1", "keyword"]}


@pytest.mark.parametrize("source_type", ["select", "text-input", "paragraph"])
@pytest.mark.parametrize(("source_id", "field"), [("node_1", "keyword"), ("123", "q_2")])
def test_representable_start_strings_keep_exact_selector(source_type: str, source_id: str, field: str) -> None:
    graph = _graph(
        {"type": "variable", "value": [source_id, field]}, source_type=source_type, source_id=source_id, field=field
    )
    parameters = cast(dict[str, object], _hydrate(graph, _entry())["tool_parameters"])
    assert parameters["query"] == {"type": "mixed", "value": "{{#" + source_id + "." + field + "#}}"}


@pytest.mark.parametrize(
    "binding",
    [
        {"type": "constant", "value": "fixed"},
        {"type": "mixed", "value": "prefix {{#node1.keyword#}}"},
        {"type": "variable", "value": "node1.keyword"},
        {"type": "variable", "value": []},
        {"type": "variable", "value": ["node1"]},
        {"type": "variable", "value": ["node1", "keyword", "field"]},
        {"type": "variable", "value": ["node1", 3]},
        {"type": "variable", "value": ["unknown", "keyword"]},
        {"type": "variable", "value": ["node1", "unknown"]},
        {"type": "variable", "value": [" node1", "keyword"]},
        {"type": "variable", "value": None},
        {"value": ["node1", "keyword"]},
        "malformed",
        None,
    ],
)
def test_existing_and_unproven_bindings_are_preserved(binding: object) -> None:
    graph = _graph(deepcopy(binding))
    parameters = cast(dict[str, object], _hydrate(graph, _entry())["tool_parameters"])
    assert parameters["query"] == binding


@pytest.mark.parametrize(
    "source_type", ["number", "checkbox", "file", "file-list", "json_object", "object", "array", "unknown"]
)
def test_nonstring_start_types_are_preserved(source_type: str) -> None:
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    parameters = cast(
        dict[str, object], _hydrate(_graph(binding, source_type=source_type), _entry())["tool_parameters"]
    )
    assert parameters["query"] == binding


@pytest.mark.parametrize(
    ("source_id", "field"),
    [
        ("node-1", "keyword"),
        ("node1", "with.dot"),
        ("node1", "with-hyphen"),
        ("node1", "1leading"),
        ("n" * 51, "keyword"),
        ("node1", "x" * 31),
        ("node1", ""),
    ],
)
def test_unrepresentable_selector_grammar_is_preserved(source_id: str, field: str) -> None:
    binding = {"type": "variable", "value": [source_id, field]}
    graph = _graph(binding, source_id=source_id, field=field)
    parameters = cast(dict[str, object], _hydrate(graph, _entry())["tool_parameters"])
    assert parameters["query"] == binding


@pytest.mark.parametrize(
    ("provider_type", "provider_id"),
    [
        ("builtin", _PROVIDER),
        ("plugin", _PROVIDER),
        ("workflow", _PROVIDER),
        ("api", "unknown"),
    ],
)
def test_other_provider_identities_are_preserved(provider_type: str, provider_id: str) -> None:
    entry = _entry()
    entry["provider_type"], entry["provider_name"] = provider_type, provider_id
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    parameters = cast(dict[str, object], _hydrate(_graph(binding), entry)["tool_parameters"])
    assert parameters["query"] == binding


@pytest.mark.parametrize(
    ("parameter_type", "form"),
    [
        ("number", "llm"),
        ("file", "llm"),
        ("files", "llm"),
        ("object", "llm"),
        ("array", "llm"),
        ("boolean", "llm"),
        ("string", "schema"),
        ("string", ""),
    ],
)
def test_only_exact_public_string_llm_declarations_convert(parameter_type: str, form: str) -> None:
    entry = _entry()
    parameters = entry["parameters"]
    parameters[0]["type"], parameters[0]["form"] = parameter_type, form
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    hydrated = cast(dict[str, object], _hydrate(_graph(binding), entry)["tool_parameters"])
    assert hydrated["query"] == binding


@pytest.mark.parametrize(
    "mutation",
    ["not_start", "missing_type", "missing_variables", "duplicate_field", "duplicate_node", "duplicate_parameter"],
)
def test_unproven_or_ambiguous_source_declarations_are_preserved(mutation: str) -> None:
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    graph, entry = _graph(binding), _entry()
    start = cast(dict[str, object], graph["nodes"][0]["data"])
    if mutation == "not_start":
        start["type"] = "code"
    elif mutation == "missing_type":
        cast(list[dict[str, object]], start["variables"])[0].pop("type")
    elif mutation == "missing_variables":
        start.pop("variables")
    elif mutation == "duplicate_field":
        cast(list[dict[str, object]], start["variables"]).append({"type": "number", "variable": "keyword"})
    elif mutation == "duplicate_node":
        graph["nodes"].append(deepcopy(graph["nodes"][0]))
    else:
        entry["parameters"].append(deepcopy(entry["parameters"][0]))
    parameters = cast(dict[str, object], _hydrate(graph, entry)["tool_parameters"])
    assert parameters["query"] == binding


def _render_parameters(data: dict[str, object], pool: VariablePool) -> dict[str, object]:
    # This real native method is pure: self is unused. No constructor, installed
    # runtime lookup, invocation, transport, graph execution or Code executor runs.
    node = ToolNode.__new__(ToolNode)
    return node._generate_parameters(
        tool_parameters=[
            ToolRuntimeParameter(name=name, required=True) for name in ("query", "timespan", "maxrecords")
        ],
        variable_pool=pool,
        node_data=ToolNodeData.model_validate({"title": "Controlled Tool", "tool_configurations": {}, **data}),
    )


@pytest.mark.parametrize("keyword", ["alpha", "beta"])
def test_native_present_string_rendering_is_equivalent(keyword: str) -> None:
    graph = _graph({"type": "variable", "value": ["node1", "keyword"]})
    original = deepcopy(cast(dict[str, object], graph["nodes"][1]["data"]))
    data = _hydrate(graph, _entry())
    before = {**data, "tool_parameters": original["tool_parameters"]}
    pool = VariablePool()
    pool.add(["node1", "keyword"], keyword)
    assert isinstance(pool.get(["node1", "keyword"]), StringSegment)
    assert (
        _render_parameters(before, pool)
        == _render_parameters(data, pool)
        == {
            "query": keyword,
            "timespan": "24h",
            "maxrecords": "5",
        }
    )


def test_missing_selector_is_a_separate_native_diagnostic_not_string_equivalence() -> None:
    graph = _graph({"type": "variable", "value": ["node1", "keyword"]})
    original = deepcopy(cast(dict[str, object], graph["nodes"][1]["data"])["tool_parameters"])
    data = _hydrate(graph, _entry())
    pool = VariablePool()
    with pytest.raises(ToolParameterError, match="does not exist"):
        _render_parameters({**data, "tool_parameters": original}, pool)
    assert _render_parameters(data, pool)["query"] == "node1.keyword"


def test_complete_start_input_preparation_registers_optional_absence_as_none() -> None:
    generator = BaseAppGenerator()
    variables = [
        VariableEntity(variable="keyword", label="Keyword", type=VariableEntityType.TEXT_INPUT, required=False)
    ]
    inputs = generator._prepare_user_inputs(user_inputs={}, variables=variables, tenant_id="fixture")
    assert inputs == {"keyword": None}
    pool = VariablePool()
    add_node_inputs_to_pool(pool, node_id="node1", inputs=inputs)
    assert isinstance(pool.get(["node1", "keyword"]), NoneSegment)
    graph = _graph({"type": "variable", "value": ["node1", "keyword"]})
    original = deepcopy(cast(dict[str, object], graph["nodes"][1]["data"])["tool_parameters"])
    data = _hydrate(graph, _entry())
    assert _render_parameters({**data, "tool_parameters": original}, pool)["query"] is None
    assert _render_parameters(data, pool)["query"] == ""


@pytest.mark.parametrize(
    "source_type", [VariableEntityType.TEXT_INPUT, VariableEntityType.PARAGRAPH, VariableEntityType.SELECT]
)
def test_native_start_string_type_proof(source_type: VariableEntityType) -> None:
    variable = VariableEntity(variable="keyword", label="Keyword", type=source_type, required=True, options=["alpha"])
    generator = BaseAppGenerator()
    assert generator._validate_inputs(variable_entity=variable, value="alpha") == "alpha"
    with pytest.raises(ValueError, match="must be a string"):
        generator._validate_inputs(variable_entity=variable, value=123)


def test_missing_installed_catalogue_entry_does_not_normalize() -> None:
    graph = _graph({"type": "variable", "value": ["node1", "keyword"]})
    before = deepcopy(graph)
    WorkflowGenerator._hydrate_tool_nodes(
        graph=graph,
        plan_nodes=[{"id": "node2", "node_type": "tool", "tool": {"provider_id": _PROVIDER, "tool_name": _ACTION}}],
        tool_catalogue_entries=[],
    )
    assert graph == before


@pytest.mark.parametrize("source_type", [None, [], {}])
def test_malformed_start_type_is_preserved(source_type: object) -> None:
    binding = {"type": "variable", "value": ["node1", "keyword"]}
    graph = _graph(binding)
    start = cast(dict[str, object], graph["nodes"][0]["data"])
    cast(list[dict[str, object]], start["variables"])[0]["type"] = source_type
    parameters = cast(dict[str, object], _hydrate(graph, _entry())["tool_parameters"])
    assert parameters["query"] == binding
