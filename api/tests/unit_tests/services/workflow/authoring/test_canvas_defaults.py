import copy
import json
from collections.abc import Sequence
from pathlib import Path

import pytest
from typing_extensions import TypedDict

from graphon.enums import BuiltinNodeTypes
from models import AppMode
from services.workflow.authoring import FillContext, canvas_defaults
from services.workflow.authoring.canvas_defaults import (
    WILDCARD,
    CanvasNode,
    canvas_node,
    canvas_value,
    with_canvas_defaults,
)
from services.workflow.authoring.fill import fill_graph_document
from services.workflow.authoring.node_options import AgentInviteOptions, NodeOptionKind, list_node_options

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
GENERATED = json.loads(Path(canvas_defaults.__file__).with_name("canvas_defaults.json").read_text())


class _NoRoster:
    def list_invite_options(self, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("the roster is not read for blocks")


class _Node(TypedDict, total=False, closed=True):
    id: str
    data: dict[str, object]
    parentId: str


class _Graph(TypedDict, closed=True):
    nodes: list[_Node]
    edges: list[dict[str, str]]


def _offered_block_types() -> set[str]:
    roster: AgentInviteOptions = _NoRoster()
    return {
        option.type
        for mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
        for option in list_node_options(
            ctx=CTX,
            mode=mode,
            kind=NodeOptionKind.BLOCK,
            keyword=None,
            accessible_agent_ids=lambda: None,
            roster=roster,
        )
    }


def _filled_data(nodes: Sequence[_Node]) -> dict[str, dict[str, object]]:
    graph = _Graph(nodes=list(nodes), edges=[])
    document = {"app": {"mode": AppMode.WORKFLOW.value, "name": "App"}, "workflow": {"graph": graph}}
    fill_graph_document(document, CTX)
    return {node["id"]: node["data"] for node in graph["nodes"]}


def _walk(value: object, path: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], object]]:
    found = [(path, value)]
    if isinstance(value, dict):
        for key, item in value.items():
            found += _walk(item, (*path, key))
    if isinstance(value, list):
        for item in value:
            found += _walk(item, (*path, WILDCARD))
    return found


def test_each_block_type_offered_has_a_generated_entry() -> None:
    offered = _offered_block_types()

    assert offered <= set(GENERATED)
    assert {node.value for node in CanvasNode} == offered


def test_a_type_without_a_canvas_node_has_none() -> None:
    assert canvas_node(BuiltinNodeTypes.TOOL) is None
    assert canvas_node(BuiltinNodeTypes.AGENT) is None
    assert canvas_node("iteration-start") is None
    assert canvas_node("no-such-node") is None
    assert canvas_node("") is None
    assert canvas_node(BuiltinNodeTypes.LLM) is CanvasNode.LLM


@pytest.mark.parametrize("node", list(CanvasNode))
def test_a_bare_seed_fills_to_the_canvas_node(node: CanvasNode) -> None:
    filled = with_canvas_defaults({"type": node.value})

    assert filled == {"type": node.value, **node.data}
    for key, value in node.data.items():
        assert filled[key] == value


def test_a_written_value_wins_at_every_depth() -> None:
    written = {
        "type": BuiltinNodeTypes.HTTP_REQUEST,
        "method": "post",
        "timeout": {"max_read_timeout": 30},
        "retry_config": {"retry_enabled": False},
    }

    filled = with_canvas_defaults(written)

    assert filled["method"] == "post"
    assert filled["timeout"] == {"max_connect_timeout": 0, "max_read_timeout": 30, "max_write_timeout": 0}
    assert filled["retry_config"] == {"retry_enabled": False, "max_retries": 3, "retry_interval": 100}
    assert filled["url"] == ""


def test_a_nested_dict_the_node_wrote_is_not_merged_a_second_level_down() -> None:
    written = {"type": BuiltinNodeTypes.LLM, "model": {"name": "gpt-4", "completion_params": {"top_p": 0.5}}}

    filled = with_canvas_defaults(written)

    assert filled["model"] == {"name": "gpt-4", "completion_params": {"top_p": 0.5}, "provider": "", "mode": "chat"}


@pytest.mark.parametrize(
    "authorization",
    [
        {"config": {"type": "bearer", "api_key": "k"}},
        {"type": "api-key", "config": {"type": "bearer", "api_key": "k"}},
    ],
)
def test_a_block_whose_type_was_not_written_is_left_alone(authorization: dict[str, object]) -> None:
    written = {"type": BuiltinNodeTypes.HTTP_REQUEST, "authorization": authorization}

    filled = with_canvas_defaults(written)

    assert filled["authorization"] == authorization


def test_a_block_whose_type_matches_gets_the_missing_keys() -> None:
    written = {"type": BuiltinNodeTypes.HTTP_REQUEST, "body": {"type": "none"}}

    assert with_canvas_defaults(written)["body"] == {"type": "none", "data": []}


def test_lists_and_scalars_are_never_merged() -> None:
    written = {
        "type": BuiltinNodeTypes.LLM,
        "prompt_template": [{"role": "user", "text": "hi"}],
        "context": "none",
        "vision": None,
    }

    filled = with_canvas_defaults(written)

    assert filled["prompt_template"] == [{"role": "user", "text": "hi"}]
    assert filled["context"] == "none"
    assert filled["vision"] is None


@pytest.mark.parametrize("model", ["gpt", ["gpt"], 3, None])
def test_a_wrong_type_value_is_kept(model: object) -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.LLM, "model": model})

    assert filled["model"] == model


def test_the_input_and_the_table_are_not_changed_by_a_fill() -> None:
    written = {"type": BuiltinNodeTypes.LLM, "model": {"name": "gpt-4"}}
    before = copy.deepcopy(written)
    table = copy.deepcopy(GENERATED)

    filled = with_canvas_defaults(written)
    model = filled["model"]
    prompt = filled["prompt_template"]
    assert isinstance(model, dict)
    assert isinstance(prompt, list)
    model["completion_params"]["temperature"] = 9
    prompt[0]["text"] = "changed"

    assert written == before
    assert CanvasNode.LLM.data == table["llm"]


def test_filling_twice_changes_nothing() -> None:
    once = [with_canvas_defaults({"type": node.value}) for node in CanvasNode]

    assert [with_canvas_defaults(data) for data in once] == once


@pytest.mark.parametrize("data", [{}, {"type": None}, {"type": 3}, {"type": "tool", "a": 1}, {"type": "mystery"}])
def test_data_without_a_canvas_node_is_returned_as_it_is(data: dict[str, object]) -> None:
    assert with_canvas_defaults(data) == data


def test_no_generated_key_starts_with_an_underscore_and_no_value_is_none() -> None:
    for path, value in _walk(GENERATED):
        assert value is not None, path
        assert not (path and path[-1].startswith("_")), path


def test_every_purpose_loc_names_a_field() -> None:
    for node in CanvasNode:
        assert len(set(node.purpose)) == len(node.purpose), node
        for loc in node.purpose:
            assert loc, node
            assert loc[0] != WILDCARD, node


def test_canvas_value_is_the_canvas_value_at_a_loc() -> None:
    assert canvas_value(BuiltinNodeTypes.LLM, ("model", "provider")) == ""
    assert canvas_value(BuiltinNodeTypes.LLM, ("prompt_template", WILDCARD, "role")) == "system"
    assert canvas_value(BuiltinNodeTypes.LLM, ("prompt_template", 0, "text")) == ""
    assert canvas_value(BuiltinNodeTypes.CODE, ("code_language",)) == "python3"


@pytest.mark.parametrize(
    ("node_type", "loc"),
    [
        (BuiltinNodeTypes.LLM, ("nothing",)),
        (BuiltinNodeTypes.LLM, ("model", "provider", "deeper")),
        (BuiltinNodeTypes.LLM, ("prompt_template", 5)),
        (BuiltinNodeTypes.LLM, ("model", WILDCARD)),
        (BuiltinNodeTypes.END, ("outputs", WILDCARD)),
        (BuiltinNodeTypes.TOOL, ("tool_parameters",)),
        ("mystery", ("anything",)),
    ],
)
def test_canvas_value_is_none_where_the_canvas_has_nothing(node_type: str, loc: tuple[str | int, ...]) -> None:
    assert canvas_value(node_type, loc) is None


def test_canvas_value_is_a_copy() -> None:
    value = canvas_value(BuiltinNodeTypes.LLM, ("model",))
    assert isinstance(value, dict)
    value["name"] = "changed"

    assert CanvasNode.LLM.data["model"] == GENERATED["llm"]["model"]


def test_legacy_if_else_conditions_get_no_extra_case() -> None:
    conditions = [{"variable_selector": ["start", "x"], "comparison_operator": "is", "value": "1"}]

    filled = _filled_data(
        [
            {
                "id": "branch",
                "data": {"type": BuiltinNodeTypes.IF_ELSE, "logical_operator": "or", "conditions": conditions},
            }
        ]
    )

    assert filled["branch"]["cases"] == [{"case_id": "true", "logical_operator": "or", "conditions": conditions}]


def test_a_container_child_gets_canvas_defaults() -> None:
    filled = _filled_data(
        [
            {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}},
            {"id": "child", "parentId": "loop", "data": {"type": BuiltinNodeTypes.LLM}},
            {"id": "plain", "data": {"type": BuiltinNodeTypes.LLM}},
        ]
    )

    assert filled["child"]["model"] == filled["plain"]["model"] == CanvasNode.LLM.data["model"]
    assert filled["loop"]["parallel_nums"] == 10


def test_a_container_start_child_is_never_touched() -> None:
    filled = _filled_data(
        [
            {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}},
            {"id": "inner-start", "parentId": "loop", "data": {"type": BuiltinNodeTypes.ITERATION_START}},
        ]
    )

    assert filled["inner-start"] == {"type": BuiltinNodeTypes.ITERATION_START}
