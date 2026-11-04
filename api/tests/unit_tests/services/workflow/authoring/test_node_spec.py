from typing import Literal

import pytest
from pydantic import BaseModel, Field

from core.plugin.impl.tool import PluginToolManager
from core.workflow.node_factory import resolve_workflow_node_class
from graphon.enums import BuiltinNodeTypes
from services.workflow.authoring import FillContext
from services.workflow.authoring.node_spec import FieldHint, NodeSpec, field_hint, node_spec, read_node, schema_at
from services.workflow.authoring.plugins import NO_DEFAULT
from services.workflow.node_defaults import node_data_schema

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")


class _Leaf(BaseModel):
    name: str = Field(description="The leaf's name")
    shade: Literal["light", "dark"] = "light"


class _Tree(BaseModel):
    leaf: _Leaf
    leaves: list[_Leaf] = Field(default_factory=list)
    maybe: _Leaf | None = None
    by_key: dict[str, _Leaf] = Field(default_factory=dict)
    size: int = Field(3, description="How big")


SCHEMA = _Tree.model_json_schema()


@pytest.mark.parametrize(
    "loc",
    [("leaf", "name"), ("leaves", 0, "name"), ("maybe", "name"), ("by_key", "any", "name")],
)
def test_schema_at_follows_refs_items_any_of_and_mapping_values(loc: tuple[str | int, ...]) -> None:
    found = schema_at(SCHEMA, loc)

    assert found is not None
    assert found["type"] == "string"
    assert found["description"] == "The leaf's name"


def test_schema_at_resolves_a_ref_it_ends_on() -> None:
    found = schema_at(SCHEMA, ("leaf",))

    assert found is not None
    assert found["type"] == "object"
    assert "name" in found["properties"]


@pytest.mark.parametrize("loc", [("nope",), ("leaf", "nope"), ("leaf", "name", "deeper"), ("leaf", 0), ("size", "x")])
def test_schema_at_is_none_once_the_path_leaves_the_schema(loc: tuple[str | int, ...]) -> None:
    assert schema_at(SCHEMA, loc) is None


def test_the_empty_path_is_the_root() -> None:
    assert schema_at(SCHEMA, ()) == SCHEMA


def test_field_hint_reads_type_options_description_and_default() -> None:
    assert field_hint(_Tree, ("leaf", "shade"), required=False) == FieldHint(
        loc=("leaf", "shade"),
        type="string",
        options=("light", "dark"),
        description=None,
        required=False,
        default="light",
    )
    assert field_hint(_Tree, ("size",), required=False) == FieldHint(
        loc=("size",), type="integer", options=(), description="How big", required=False, default=3
    )


def test_field_hint_of_an_optional_model_names_both_types() -> None:
    hint = field_hint(_Tree, ("maybe",), required=False)

    assert hint.type == "object | null"
    assert hint.default is None


def test_field_hint_without_a_declared_default_has_none() -> None:
    assert field_hint(_Tree, ("leaf", "name"), required=True).default is NO_DEFAULT


def test_field_hint_off_the_schema_still_locates_the_field() -> None:
    assert field_hint(_Tree, ("gone",), required=True) == FieldHint(
        loc=("gone",), type=None, options=(), description=None, required=True, default=NO_DEFAULT
    )


def test_a_list_hint_carries_its_item_fields_required_ones_first() -> None:
    hint = field_hint(_Tree, ("leaves",), required=False)

    assert hint.items == (
        FieldHint(
            loc=("name",), type="string", options=(), description="The leaf's name", required=True, default=NO_DEFAULT
        ),
        FieldHint(
            loc=("shade",), type="string", options=("light", "dark"), description=None, required=False, default="light"
        ),
    )


class _Bud(BaseModel):
    kind: Literal["bud"] = "bud"


class _Grove(BaseModel):
    maybe_leaves: list[_Leaf] | None = None
    leaves_or_gaps: list[_Leaf | None] = Field(default_factory=list)
    shapes: list[_Leaf | _Bud] = Field(default_factory=list)
    shapes_or_gaps: list[_Leaf | _Bud | None] = Field(default_factory=list)


@pytest.mark.parametrize("field", ["maybe_leaves", "leaves_or_gaps"])
def test_a_list_whose_items_are_one_object_or_null_carries_its_item_fields(field: str) -> None:
    hint = field_hint(_Grove, (field,), required=False)

    assert [item.loc for item in hint.items] == [("name",), ("shade",)]


@pytest.mark.parametrize("field", ["shapes", "shapes_or_gaps"])
def test_a_list_whose_items_take_several_shapes_has_no_items(field: str) -> None:
    assert field_hint(_Grove, (field,), required=False).items == ()


def test_human_input_inputs_take_several_shapes_and_have_no_items() -> None:
    node = read_node({"id": "ask", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT}}, CTX)
    assert node is not None

    assert node.hint(("inputs",), required=False).items == ()


def test_an_item_field_carries_no_items_of_its_own() -> None:
    node = read_node({"id": "branch", "data": {"type": BuiltinNodeTypes.IF_ELSE}}, CTX)
    assert node is not None

    items = {item.loc: item for item in node.hint(("cases",), required=True).items}

    assert ("conditions",) in items
    assert items[("conditions",)].items == ()


@pytest.mark.parametrize(
    ("node_type", "loc"),
    [
        (BuiltinNodeTypes.END, ("outputs", 0, "value_selector")),
        (BuiltinNodeTypes.END, ("outputs", 0, "variable")),
        (BuiltinNodeTypes.LLM, ("model",)),
    ],
)
def test_a_hint_for_a_scalar_list_or_a_non_list_has_no_items(node_type: str, loc: tuple[str | int, ...]) -> None:
    node = read_node({"id": "n", "data": {"type": node_type}}, CTX)
    assert node is not None

    assert node.hint(loc, required=True).items == ()


def _spec(raw_node: dict[str, object]) -> NodeSpec:
    node = read_node(raw_node, CTX)
    assert node is not None
    return node_spec(node)


def _time_tool(**data: object) -> dict[str, object]:
    return {
        "id": "now",
        "data": {
            "type": BuiltinNodeTypes.TOOL,
            "provider_type": "builtin",
            "provider_id": "time",
            "tool_name": "current_time",
            "tool_node_version": "2",
            **data,
        },
    }


def test_a_tool_node_spec_lists_the_tool_parameters() -> None:
    spec = _spec(_time_tool())

    assert spec.node_id == "now"
    assert spec.type == BuiltinNodeTypes.TOOL
    assert [parameter.name for parameter in spec.plugin_parameters] == ["format", "timezone"]


def test_a_tool_not_found_has_no_parameters(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)
    spec = _spec(_time_tool(provider_id="missing"))

    assert spec.plugin_parameters == ()


def test_the_spec_schema_is_the_one_describe_node_type_serves() -> None:
    spec = _spec({"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}})
    node_class = resolve_workflow_node_class(node_type=BuiltinNodeTypes.LLM, node_version="1")

    assert spec.schema == node_data_schema(node_class)
    assert spec.version == node_class.version()


def test_open_fields_are_every_top_level_field_the_data_lacks() -> None:
    spec = _spec({"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "title": "LLM"}})

    fields = {hint.loc: hint for hint in spec.open_fields}
    assert ("type",) not in fields
    assert ("title",) not in fields
    assert fields[("model",)].required is True
    assert fields[("model",)].type == "object"
    assert fields[("memory",)].required is False
    assert fields[("memory",)].default is None


def test_open_fields_list_required_fields_first() -> None:
    spec = _spec({"id": "llm", "data": {"type": BuiltinNodeTypes.LLM, "title": "LLM"}})

    order = [(not hint.required, hint.loc) for hint in spec.open_fields]
    assert order == sorted(order)
    assert spec.open_fields[0].required is True
    assert spec.open_fields[-1].required is False


@pytest.mark.parametrize(
    "node",
    [
        {"id": "note", "type": "custom-note", "data": {"type": "", "text": "a note"}},
        {"id": "future", "data": {"type": "node-from-the-future"}},
        {"id": "typeless", "data": {}},
        {"id": "dataless"},
        {"id": "broken", "data": "not a mapping"},
        {"data": {"type": BuiltinNodeTypes.LLM}},
    ],
)
def test_a_node_it_cannot_read_is_not_read(node: dict[str, object]) -> None:
    assert read_node(node, CTX) is None
