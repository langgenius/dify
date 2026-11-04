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
    canvas_example,
    canvas_node,
    canvas_value,
    with_canvas_defaults,
)
from services.workflow.authoring.fill import fill_graph_document
from services.workflow.authoring.node_options import AgentInviteOptions, NodeOptionKind, list_node_options
from services.workflow.node_defaults import editor_defaults, editor_empties, rewrite_old_shapes

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
    assert {edition.entry for node in CanvasNode for edition in node.editions.values()} <= set(GENERATED)


def test_a_type_without_a_canvas_node_has_none() -> None:
    assert canvas_node(BuiltinNodeTypes.TOOL) is None
    assert canvas_node(BuiltinNodeTypes.AGENT) is None
    assert canvas_node("iteration-start") is None
    assert canvas_node("no-such-node") is None
    assert canvas_node("") is None
    assert canvas_node(BuiltinNodeTypes.LLM) is CanvasNode.LLM


@pytest.mark.parametrize("node", list(CanvasNode))
def test_a_bare_seed_fills_to_the_canvas_node_but_what_it_withholds(node: CanvasNode) -> None:
    bare = {"type": node.value}
    edition = node.edition()
    assert edition is not None

    filled = with_canvas_defaults(bare)

    withheld = edition.withheld(bare)
    assert filled == {"type": node.value, **{key: value for key, value in node.data.items() if key not in withheld}}


V2_ONLY_KEYS = {"recipients_spec", "message_template", "debug_mode"}


def test_a_human_input_node_gets_the_defaults_of_its_version() -> None:
    v1 = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "1"})
    v2 = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "2"})

    assert v1 == {"type": "human-input", "version": "1", **GENERATED["human-input"]}
    assert v2 == {"type": "human-input", "version": "2", **GENERATED["human-input-v2"]}
    assert "delivery_methods" not in v2


@pytest.mark.parametrize("data", [{}, {"version": None}, {"version": "1"}])
def test_a_human_input_node_without_a_version_is_version_one_and_gains_no_v2_key(data: dict[str, object]) -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, **data})

    assert V2_ONLY_KEYS.isdisjoint(filled)
    assert filled["delivery_methods"] == []
    assert filled["timeout_unit"] == "day"


@pytest.mark.parametrize("version", ["3", "", 2, ["2"]])
def test_a_human_input_node_of_an_unknown_version_is_left_alone(version: object) -> None:
    data = {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": version}

    assert with_canvas_defaults(data) == data


def test_a_filled_human_input_node_has_the_keys_of_its_version_only() -> None:
    filled = _filled_data(
        [
            {"id": "v1", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT}},
            {"id": "v1-written", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "1"}},
            {"id": "v2", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "2"}},
        ]
    )

    assert V2_ONLY_KEYS.isdisjoint(filled["v1"])
    assert V2_ONLY_KEYS.isdisjoint(filled["v1-written"])
    assert "delivery_methods" in filled["v1"]
    assert set(filled["v2"]) >= V2_ONLY_KEYS
    assert "delivery_methods" not in filled["v2"]


def test_the_version_is_ignored_for_a_type_with_one_edition() -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.LLM, "version": "7"})

    assert filled == {"type": "llm", "version": "7", **CanvasNode.LLM.data}


def test_a_human_input_edition_has_its_own_defaults_and_purpose() -> None:
    node = CanvasNode.HUMAN_INPUT
    v1, v2 = node.edition("1"), node.edition("2")

    assert v1 is not None
    assert v2 is not None
    assert node.edition() == v1
    assert node.edition("3") is None
    assert (node.data, node.purpose) == (v1.data, v1.purpose)
    assert ("delivery_methods",) in v1.purpose
    assert ("recipients_spec",) in v2.purpose
    assert ("delivery_methods",) not in v2.purpose
    assert canvas_value(BuiltinNodeTypes.HUMAN_INPUT, ("timeout",)) == 3
    assert canvas_value(BuiltinNodeTypes.HUMAN_INPUT, ("timeout",), version="2") == 36
    assert canvas_value(BuiltinNodeTypes.HUMAN_INPUT, ("timeout",), version="3") is None


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


def test_an_llm_for_a_completion_model_gets_no_chat_prompt() -> None:
    written = {"type": BuiltinNodeTypes.LLM, "model": {"mode": "completion", "name": "m"}}

    filled = with_canvas_defaults(written)

    assert "prompt_template" not in filled
    assert filled["model"] == {
        "mode": "completion",
        "name": "m",
        "provider": "",
        "completion_params": {"temperature": 0.7},
    }
    assert filled["vision"] == CanvasNode.LLM.data["vision"]


@pytest.mark.parametrize("model", [{"mode": "chat"}, {"name": "m"}, "gpt", None])
def test_an_llm_not_written_for_a_completion_model_gets_the_chat_prompt(model: object) -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.LLM, "model": model})

    assert filled["prompt_template"] == CanvasNode.LLM.data["prompt_template"]


def test_a_prompt_written_for_a_completion_model_is_kept() -> None:
    prompt = {"text": "Say hi"}
    written = {"type": BuiltinNodeTypes.LLM, "model": {"mode": "completion"}, "prompt_template": prompt}

    assert with_canvas_defaults(written)["prompt_template"] == prompt


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
        for edition in node.editions.values():
            assert len(set(edition.purpose)) == len(edition.purpose), node
            for loc in edition.purpose:
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


def test_old_shapes_are_rewritten_apart_from_the_empty_containers() -> None:
    conditions = [{"variable_selector": ["start", "x"], "comparison_operator": "is", "value": "1"}]
    legacy = {"type": BuiltinNodeTypes.IF_ELSE, "conditions": conditions}

    rewritten = rewrite_old_shapes(legacy)

    assert rewritten["cases"] == [{"case_id": "true", "logical_operator": "and", "conditions": conditions}]
    assert rewrite_old_shapes({"type": BuiltinNodeTypes.IF_ELSE}) == {"type": BuiltinNodeTypes.IF_ELSE}
    assert rewrite_old_shapes({"type": BuiltinNodeTypes.CODE}) == {"type": BuiltinNodeTypes.CODE}
    assert rewrite_old_shapes({"type": None}) == {"type": None}
    assert editor_defaults({"type": BuiltinNodeTypes.IF_ELSE}) == {"type": BuiltinNodeTypes.IF_ELSE, "cases": []}
    assert editor_defaults(legacy) == editor_empties(rewritten)


def test_a_bare_if_else_fills_to_the_canvas_case() -> None:
    filled = _filled_data([{"id": "branch", "data": {"type": BuiltinNodeTypes.IF_ELSE}}])

    assert filled["branch"]["cases"] == [{"case_id": "true", "conditions": [], "logical_operator": "and"}]


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


@pytest.mark.parametrize("node", [CanvasNode.ITERATION, CanvasNode.LOOP])
def test_a_container_gets_no_start_node_id_but_keeps_a_written_one(node: CanvasNode) -> None:
    bare = {"type": node.value}
    written = {"type": node.value, "start_node_id": "inner-start"}

    assert "start_node_id" not in with_canvas_defaults(bare)
    assert canvas_example(bare, ("start_node_id",)) is None
    assert with_canvas_defaults(written)["start_node_id"] == "inner-start"


def test_a_container_start_child_is_never_touched() -> None:
    filled = _filled_data(
        [
            {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}},
            {"id": "inner-start", "parentId": "loop", "data": {"type": BuiltinNodeTypes.ITERATION_START}},
        ]
    )

    assert filled["inner-start"] == {"type": BuiltinNodeTypes.ITERATION_START}
