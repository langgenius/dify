import copy
import json
from collections.abc import Sequence
from pathlib import Path

import pytest
import yaml
from pydantic import BaseModel, ValidationError
from typing_extensions import TypedDict

from core.workflow.node_factory import (
    LATEST_VERSION,
    get_node_type_classes_mapping,
    node_data_model,
    resolve_workflow_node_class,
)
from graphon.enums import BuiltinNodeTypes
from models import AppMode
from services.workflow.authoring import FillContext, canvas_defaults
from services.workflow.authoring.canvas_defaults import (
    CanvasEdition,
    CanvasNode,
    _without_required_empties,
    canvas_node,
    with_canvas_defaults,
)
from services.workflow.authoring.fill import fill_graph_document
from services.workflow.authoring.node_options import AgentInviteOptions, NodeOptionKind, block_seed, list_node_options
from services.workflow.node_defaults import editor_defaults, fill_graph, rewrite_old_shapes
from tests.unit_tests.services.workflow.authoring.conftest import V2_ONLY_KEYS

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
LIST_ITEM = "*"
GENERATED = json.loads(Path(canvas_defaults.__file__).with_name("canvas_defaults.json").read_text())
EDITIONS = [(node, edition) for node in CanvasNode for edition in node.editions.values()]
MISSING_ERROR_TYPE = "missing"
# The engine types if-else `cases` as `list[Case] | None`, which the sub-model walk does not reach, so fill keeps the
# canvas's empty conditions of a case.
UNREACHED_REQUIRED_EMPTIES: dict[str, list[tuple[str | int, ...]]] = {
    CanvasNode.IF_ELSE.value: [("cases", 0, "conditions")]
}

type _Loc = tuple[str | int, ...]


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
            found += _walk(item, (*path, LIST_ITEM))
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
def test_a_bare_seed_fills_to_the_canvas_node(node: CanvasNode) -> None:
    assert with_canvas_defaults({"type": node.value}) == {"type": node.value, **node.data}


def test_a_human_input_node_gets_the_defaults_of_its_version() -> None:
    v1 = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "1"})
    v2 = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "2"})

    assert v1 == {"type": "human-input", "version": "1", **CanvasNode.HUMAN_INPUT.editions["1"].data}
    assert v2 == {"type": "human-input", "version": "2", **CanvasNode.HUMAN_INPUT.editions["2"].data}
    assert "delivery_methods" not in v2


@pytest.mark.parametrize("data", [{}, {"version": None}, {"version": "1"}])
def test_a_human_input_node_without_a_version_is_version_one_and_gains_no_v2_key(data: dict[str, object]) -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.HUMAN_INPUT, **data})

    assert V2_ONLY_KEYS.isdisjoint(filled)
    assert filled["timeout_unit"] == "day"


@pytest.mark.parametrize("version", ["3", "", 2, ["2"]])
def test_a_human_input_node_of_an_unknown_version_is_left_alone(version: object) -> None:
    data = {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": version}

    assert with_canvas_defaults(data) == data


def test_each_human_input_version_gets_no_key_of_the_other() -> None:
    filled = _filled_data(
        [
            {"id": "v1", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT}},
            {"id": "v1-written", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "1"}},
            {"id": "v2", "data": {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "2"}},
        ]
    )

    assert V2_ONLY_KEYS.isdisjoint(filled["v1"])
    assert V2_ONLY_KEYS.isdisjoint(filled["v1-written"])
    assert "timeout_unit" in filled["v1"]
    assert "delivery_methods" not in filled["v2"]
    assert CanvasNode.HUMAN_INPUT.editions["2"].data.keys() <= filled["v2"].keys()


def test_the_version_is_ignored_for_a_type_with_one_edition() -> None:
    filled = with_canvas_defaults({"type": BuiltinNodeTypes.LLM, "version": "7"})

    assert filled == {"type": "llm", "version": "7", **CanvasNode.LLM.data}


def test_a_human_input_edition_has_its_own_defaults() -> None:
    node = CanvasNode.HUMAN_INPUT
    v1, v2 = node.edition("1"), node.edition("2")

    assert v1 is not None
    assert v2 is not None
    assert node.edition() == v1
    assert node.edition("3") is None
    assert node.data == v1.data
    assert v1.data["timeout"] == 3
    assert v2.data["timeout"] == 36


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
    assert "url" not in filled


def test_a_nested_dict_the_node_wrote_is_not_merged_a_second_level_down() -> None:
    written = {"type": BuiltinNodeTypes.LLM, "model": {"name": "gpt-4", "completion_params": {"top_p": 0.5}}}

    filled = with_canvas_defaults(written)

    assert filled["model"] == {"name": "gpt-4", "completion_params": {"top_p": 0.5}, "mode": "chat"}


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
    canvas = copy.deepcopy(dict(CanvasNode.LLM.data))

    filled = with_canvas_defaults(written)
    model = filled["model"]
    prompt = filled["prompt_template"]
    assert isinstance(model, dict)
    assert isinstance(prompt, list)
    model["completion_params"]["temperature"] = 9
    prompt[0]["text"] = "changed"

    assert written == before
    assert CanvasNode.LLM.data == canvas


def test_filling_twice_changes_nothing() -> None:
    once = [with_canvas_defaults({"type": node.value}) for node in CanvasNode]

    assert [with_canvas_defaults(data) for data in once] == once


@pytest.mark.parametrize("data", [{}, {"type": None}, {"type": 3}, {"type": "tool", "a": 1}, {"type": "mystery"}])
def test_data_without_a_canvas_node_is_returned_as_it_is(data: dict[str, object]) -> None:
    assert with_canvas_defaults(data) == data


def test_no_generated_value_is_none() -> None:
    for path, value in _walk(GENERATED):
        assert value is not None, path


def _is_empty(value: object) -> bool:
    return isinstance(value, (str, list, dict)) and not value


def _empty_locs(value: object, loc: _Loc = ()) -> list[_Loc]:
    """The loc of each empty string, list or dict below `value`."""
    children: list[tuple[str | int, object]] = []
    if isinstance(value, dict):
        children = list(value.items())
    if isinstance(value, list):
        children = list(enumerate(value))
    found = [inner for key, item in children for inner in _empty_locs(item, (*loc, key))]
    return [*found, loc] if loc and _is_empty(value) else found


def _without_empties(value: object) -> object:
    """`value` with every empty value dropped at any depth, as the generator once wrote the table."""
    if isinstance(value, dict):
        kept = {key: _without_empties(item) for key, item in value.items()}
        return {key: item for key, item in kept.items() if not _is_empty(item)}
    if isinstance(value, list):
        return [item for item in map(_without_empties, value) if not _is_empty(item)]
    return value


def _without_loc(value: object, loc: _Loc) -> object:
    """A copy of `value` without the key or item at `loc`."""
    head, *rest = loc
    if isinstance(value, dict):
        kept = {key: item for key, item in value.items() if rest or key != head}
        return {key: _without_loc(item, tuple(rest)) if rest and key == head else item for key, item in kept.items()}
    if isinstance(value, list):
        kept_items = [(index, item) for index, item in enumerate(value) if rest or index != head]
        return [_without_loc(item, tuple(rest)) if rest and index == head else item for index, item in kept_items]
    return value


def _missing_locs(model: type[BaseModel], data: object) -> set[_Loc]:
    try:
        model.model_validate(data)
    except ValidationError as error:
        return {tuple(problem["loc"]) for problem in error.errors() if problem["type"] == MISSING_ERROR_TYPE}
    return set()


def _data_model(node: CanvasNode, edition: CanvasEdition) -> type[BaseModel]:
    version = LATEST_VERSION if edition.version is None else edition.version
    return node_data_model(resolve_workflow_node_class(node_type=node.value, node_version=version))


def _edition_id(param: tuple[CanvasNode, CanvasEdition]) -> str:
    return param[1].entry


@pytest.mark.parametrize("param", EDITIONS, ids=_edition_id)
def test_an_edition_holds_no_empty_value_in_a_required_field(param: tuple[CanvasNode, CanvasEdition]) -> None:
    node, edition = param
    model = _data_model(node, edition)
    data = dict(edition.data)

    required = [loc for loc in _empty_locs(data) if loc in _missing_locs(model, _without_loc(data, loc))]

    assert required == UNREACHED_REQUIRED_EMPTIES.get(edition.entry, [])


@pytest.mark.parametrize("param", EDITIONS, ids=_edition_id)
def test_an_edition_leaves_out_only_empty_values_of_the_table(param: tuple[CanvasNode, CanvasEdition]) -> None:
    _node, edition = param
    table = GENERATED[edition.entry]

    assert _without_empties(dict(edition.data)) == _without_empties(table)
    assert set(_empty_locs(dict(edition.data))) <= set(_empty_locs(table))


class _Inner(BaseModel):
    name: str


class _Outer(BaseModel):
    required: _Inner
    optional: _Inner | None = None
    items: list[_Inner]


def test_a_block_left_empty_by_the_pruning_goes_only_when_its_own_field_is_required() -> None:
    data = {"required": {"name": ""}, "optional": {"name": ""}, "items": [{"name": ""}], "extra": ""}

    assert _without_required_empties(_Outer, data) == {"optional": {}, "items": [{}], "extra": ""}


def test_a_bare_llm_keeps_the_empty_context_but_not_an_empty_model_name() -> None:
    seed = block_seed(
        BuiltinNodeTypes.LLM, get_node_type_classes_mapping()[BuiltinNodeTypes.LLM][LATEST_VERSION].version()
    )
    filled = _filled_data([{"id": "llm", "data": {"type": BuiltinNodeTypes.LLM}}])["llm"]

    for data in (seed, filled):
        assert data["context"] == {"enabled": False, "variable_selector": []}
        model = data["model"]
        assert isinstance(model, dict)
        assert {"provider", "name"}.isdisjoint(model)


@pytest.mark.parametrize("written", [{}, {"context": {"enabled": False}}], ids=["no-context", "context-disabled"])
def test_an_llm_in_a_loop_reaches_the_import_with_an_empty_context_selector(written: dict[str, object]) -> None:
    graph = _Graph(
        nodes=[
            {"id": "loop", "data": {"type": BuiltinNodeTypes.LOOP, "start_node_id": "loop-start"}},
            {"id": "loop-start", "parentId": "loop", "data": {"type": BuiltinNodeTypes.LOOP_START}},
            {"id": "llm", "parentId": "loop", "data": {"type": BuiltinNodeTypes.LLM, **copy.deepcopy(written)}},
        ],
        edges=[],
    )
    document = {"app": {"mode": AppMode.WORKFLOW.value, "name": "App"}, "workflow": {"graph": graph}}

    fill_graph_document(document, CTX)
    imported = {node["id"]: node["data"] for node in fill_graph(graph)["nodes"]}

    assert imported["llm"]["context"] == {"enabled": False, "variable_selector": []}


def test_fill_writes_the_empty_lists_the_editor_reads() -> None:
    filled = _filled_data(
        [
            {"id": "http", "data": {"type": BuiltinNodeTypes.HTTP_REQUEST}},
            {"id": "list", "data": {"type": BuiltinNodeTypes.LIST_OPERATOR}},
        ]
    )

    assert filled["http"]["body"] == {"type": "none", "data": []}
    filter_by = filled["list"]["filter_by"]
    assert isinstance(filter_by, dict)
    assert filter_by["conditions"] == []


def test_no_generated_key_starts_with_an_underscore() -> None:
    for path, _value in _walk(GENERATED):
        assert not (path and path[-1].startswith("_")), path


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
    assert editor_defaults(legacy) == rewritten


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
def test_a_container_gets_no_start_node_id_or_selector_but_keeps_a_written_one(node: CanvasNode) -> None:
    bare = {"type": node.value}
    written = {"type": node.value, "start_node_id": "inner-start"}

    assert {"start_node_id", "iterator_selector", "output_selector"}.isdisjoint(with_canvas_defaults(bare))
    assert with_canvas_defaults(written)["start_node_id"] == "inner-start"


def _bare_nodes() -> list[dict[str, object]]:
    return [
        {"type": node.value, **({} if version is None else {"version": version})}
        for node in CanvasNode
        for version in node.editions
    ]


@pytest.mark.parametrize("data", _bare_nodes(), ids=lambda data: f"{data['type']}-{data.get('version')}")
def test_fill_writes_the_edition_at_the_top_and_in_a_container(data: dict[str, object]) -> None:
    filled = _filled_data(
        [
            {"id": "box", "data": {"type": BuiltinNodeTypes.ITERATION}},
            {"id": "top", "data": dict(data)},
            {"id": "child", "parentId": "box", "data": dict(data)},
        ]
    )

    assert with_canvas_defaults(data).items() <= filled["top"].items()
    assert with_canvas_defaults(data).items() <= filled["child"].items()


@pytest.mark.parametrize(
    "data",
    [
        {"type": BuiltinNodeTypes.TOOL, "title": "t"},
        {"type": BuiltinNodeTypes.AGENT, "title": "a"},
        {"type": "mystery", "title": "m"},
        {"type": BuiltinNodeTypes.HUMAN_INPUT, "version": "3", "title": "h"},
    ],
    ids=["tool", "agent", "unknown", "human-input-3"],
)
def test_fill_leaves_types_and_versions_it_does_not_know_as_written(data: dict[str, object]) -> None:
    assert _filled_data([{"id": "n", "data": copy.deepcopy(data)}]) == {"n": data}


def test_a_second_fill_changes_no_byte() -> None:
    nodes: list[_Node] = [{"id": "box", "data": {"type": BuiltinNodeTypes.LOOP}}]
    for index, data in enumerate(_bare_nodes()):
        top: _Node = {"id": f"top-{index}", "data": dict(data)}
        child: _Node = {"id": f"child-{index}", "parentId": "box", "data": data}
        nodes += [top, child]
    graph = _Graph(nodes=nodes, edges=[])
    document = {"app": {"mode": AppMode.WORKFLOW.value, "name": "App"}, "workflow": {"graph": graph}}

    fill_graph_document(document, CTX)
    once = yaml.dump(document, allow_unicode=True)
    fill_graph_document(document, CTX)

    assert yaml.dump(document, allow_unicode=True) == once


def test_a_container_start_child_is_never_touched() -> None:
    filled = _filled_data(
        [
            {"id": "loop", "data": {"type": BuiltinNodeTypes.ITERATION}},
            {"id": "inner-start", "parentId": "loop", "data": {"type": BuiltinNodeTypes.ITERATION_START}},
        ]
    )

    assert filled["inner-start"] == {"type": BuiltinNodeTypes.ITERATION_START}
