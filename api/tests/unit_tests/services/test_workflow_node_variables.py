from collections.abc import Mapping, Sequence
from typing import Literal

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.workflow.workflow_entry import WorkflowEntry
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.nodes.list_operator.entities import FilterOperator
from graphon.runtime import VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from graphon.variables import StringSegment, VariableBase
from models.human_input_entities import HumanInputNodeData
from models.workflow import WorkflowDraftVariable
from services.workflow_draft_variable_service import DraftVarLoader
from services.workflow_node_variables import get_human_input_form_variable_mapping, load_additional_node_variables


@pytest.mark.parametrize("container_type", [None, "iteration", "loop"])
@pytest.mark.parametrize("saved_root", [False, True])
def test_human_input_body_and_email_keep_nested_editor_selectors(
    container_type: Literal["iteration", "loop"] | None, saved_root: bool
) -> None:
    human: dict[str, object] = {
        "id": "human",
        "data": {
            "type": "human-input",
            "title": "Human",
            "form_content": "Hello {{#source.object.name#}} {{#$output.comment#}}",
            "inputs": [
                {
                    "type": "paragraph",
                    "output_variable_name": "comment",
                    "default": {"type": "variable", "selector": ["source", "default"]},
                }
            ],
            "delivery_methods": [
                {
                    "type": "email",
                    "enabled": True,
                    "config": {
                        "recipients": {"items": list[object]()},
                        "subject": "Review",
                        "body": "Hello {{#source.object.email_name#}} {{#url#}}",
                    },
                },
                {
                    "type": "email",
                    "enabled": False,
                    "config": {
                        "recipients": {"items": list[object]()},
                        "subject": "Disabled",
                        "body": "{{#missing.object.name#}}",
                    },
                },
            ],
        },
    }
    nodes = [human]
    target: dict[str, object] = human
    if container_type:
        target = {"id": "container", "data": {"type": container_type, "title": "Container"}}
        nodes.insert(0, target)
    prefix = "human." if container_type else ""
    inputs = {
        f"{prefix}#source.object.name#": "Alice",
        f"{prefix}#source.object.email_name#": "Recipient",
        f"{prefix}#source.default#": "Default",
    }
    variable_pool = VariablePool()
    if saved_root:
        variable_pool.add(["source", "object"], {"name": "Old", "email_name": "Old", "keep": "Saved"})

    mapping = load_additional_node_variables(
        node_config=NodeConfigDictAdapter.validate_python(target),
        graph_config={"nodes": nodes},
        variable_mapping={},
        variable_loader=DUMMY_VARIABLE_LOADER,
        variable_pool=variable_pool,
        user_inputs=inputs,
    )
    WorkflowEntry.mapping_user_inputs_to_variable_pool(
        variable_mapping=mapping, user_inputs=inputs, variable_pool=variable_pool, tenant_id="tenant"
    )

    assert mapping == {
        f"{prefix}human.#source.object.name#": ["source", "object", "name"],
        f"{prefix}human.#source.object.email_name#": ["source", "object", "email_name"],
        f"{prefix}human.#source.default#": ["source", "default"],
    }
    variable = variable_pool.get(["source", "object"])
    assert variable is not None
    assert variable.value == {
        "name": "Alice",
        "email_name": "Recipient",
        **({"keep": "Saved"} if saved_root else {}),
    }
    assert get_human_input_form_variable_mapping("human", HumanInputNodeData.model_validate(human["data"])) == {
        "human.#source.object.name#": ["source", "object", "name"],
        "human.#source.default#": ["source", "default"],
    }


@pytest.mark.parametrize("operator", [FilterOperator.EMPTY, FilterOperator.NOT_EMPTY])
def test_value_free_list_filters_do_not_require_stale_operands(
    operator: FilterOperator, monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    config = NodeConfigDictAdapter.validate_python(
        {
            "id": "list",
            "data": {
                "type": "list-operator",
                "title": "List",
                "variable": ["source", "items"],
                "filter_by": {
                    "enabled": True,
                    "conditions": [{"comparison_operator": operator, "value": "{{#deleted.old#}}"}],
                },
                "order_by": {"enabled": False},
                "limit": {"enabled": False},
            },
        }
    )
    loader = DraftVarLoader(sqlite_engine, "app", "tenant", "user")
    selectors_loaded: list[list[list[str]]] = []
    original_load = loader.load_variables

    def load_variables(selectors: list[list[str]]) -> list[VariableBase]:
        selectors_loaded.append(selectors)
        return original_load(selectors)

    monkeypatch.setattr(loader, "load_variables", load_variables)

    mapping = load_additional_node_variables(
        node_config=config,
        graph_config={"nodes": [config]},
        variable_mapping={},
        variable_loader=loader,
        variable_pool=VariablePool(),
        user_inputs={"#source.items#": ["", "a"]},
    )

    assert mapping == {"list.#source.items#": ["source", "items"]}
    assert selectors_loaded == [[]]


@pytest.mark.parametrize(
    ("data", "inputs", "expected"),
    [
        (
            {
                "type": "human-input",
                "form_content": "Review {{#source.content#}} and {{#$output.comment#}}",
                "inputs": [
                    {
                        "type": "paragraph",
                        "output_variable_name": "comment",
                        "default": {"type": "variable", "selector": ["source", "default"]},
                    }
                ],
            },
            {"#source.content#": "review", "#source.default#": "comment"},
            {"node.#source.content#": ["source", "content"], "node.#source.default#": ["source", "default"]},
        ),
        (
            {
                "type": "knowledge-index",
                "chunk_structure": "text_model",
                "index_chunk_variable_selector": ["source", "chunks"],
            },
            {"query": {"general_chunks": ["content"]}},
            {"node.query": ["source", "chunks"]},
        ),
    ],
)
def test_dify_node_input_mappings(
    data: Mapping[str, object], inputs: Mapping[str, object], expected: Mapping[str, Sequence[str]]
) -> None:
    config = NodeConfigDictAdapter.validate_python({"id": "node", "data": {"title": "Node", **data}})

    mapping = load_additional_node_variables(
        node_config=config,
        graph_config={"nodes": [config]},
        variable_mapping={},
        variable_loader=DUMMY_VARIABLE_LOADER,
        variable_pool=VariablePool(),
        user_inputs=inputs,
    )

    assert mapping == expected


def test_missing_end_input_loads_saved_draft_value(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session: Session
) -> None:
    config = NodeConfigDictAdapter.validate_python(
        {
            "id": "end",
            "data": {
                "type": "end",
                "title": "End",
                "outputs": [{"variable": "result", "value_selector": ["source", "value"]}],
            },
        }
    )
    variable_pool = VariablePool()
    sqlite_session.add(
        WorkflowDraftVariable.new_node_variable(
            app_id="app",
            user_id="user",
            node_id="source",
            name="value",
            value=StringSegment(value="saved"),
            node_execution_id="execution",
        )
    )
    sqlite_session.commit()
    loader = DraftVarLoader(sqlite_engine, "app", "tenant", "user")
    selectors_loaded: list[list[list[str]]] = []
    original_load = loader.load_variables

    def load_variables(selectors: list[list[str]]) -> list[VariableBase]:
        selectors_loaded.append(selectors)
        return original_load(selectors)

    monkeypatch.setattr(loader, "load_variables", load_variables)

    mapping = load_additional_node_variables(
        node_config=config,
        graph_config={"nodes": [config]},
        variable_mapping={},
        variable_loader=loader,
        variable_pool=variable_pool,
        user_inputs={},
    )

    assert mapping == {"end.#source.value#": ["source", "value"]}
    assert selectors_loaded == [[["source", "value"]]]
    variable = variable_pool.get(["source", "value"])
    assert variable is not None
    assert variable.value == "saved"


def test_unavailable_end_output_remains_unset_after_draft_loading(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    config = NodeConfigDictAdapter.validate_python(
        {
            "id": "end",
            "data": {
                "type": "end",
                "title": "End",
                "outputs": [{"variable": "result", "value_selector": ["source", "missing"]}],
            },
        }
    )
    variable_pool = VariablePool()
    loader = DraftVarLoader(sqlite_engine, "app", "tenant", "user")
    selectors_loaded: list[list[list[str]]] = []
    original_load = loader.load_variables

    def load_variables(selectors: list[list[str]]) -> list[VariableBase]:
        selectors_loaded.append(selectors)
        return original_load(selectors)

    monkeypatch.setattr(loader, "load_variables", load_variables)

    mapping = load_additional_node_variables(
        node_config=config,
        graph_config={"nodes": [config]},
        variable_mapping={},
        variable_loader=loader,
        variable_pool=variable_pool,
        user_inputs={},
    )

    assert selectors_loaded == [[["source", "missing"]]]
    assert mapping == {}
    assert variable_pool.get(["source", "missing"]) is None


def test_container_loads_external_inputs_and_skips_internal_outputs_and_disabled_settings() -> None:
    container = {"id": "iteration", "data": {"type": "iteration", "title": "Iteration"}}
    operator = {
        "id": "list",
        "data": {
            "type": "list-operator",
            "title": "List",
            "variable": ["source", "items"],
            "filter_by": {"enabled": True, "conditions": [{"value": "{{#source.filter#}}"}]},
            "extract_by": {"enabled": False, "serial": "{{#source.unused#}}"},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        },
    }
    aggregator = {
        "id": "aggregate",
        "data": {
            "type": "variable-aggregator",
            "title": "Aggregate",
            "output_type": "array[string]",
            "variables": [["source", "unused"]],
            "advanced_settings": {
                "group_enabled": True,
                "groups": [
                    {
                        "output_type": "array[string]",
                        "group_name": "group",
                        "variables": [["list", "result"], ["source", "missing"], ["source", "fallback"]],
                    }
                ],
            },
        },
    }
    variable_pool = VariablePool()
    variable_pool.add(["source", "fallback"], ["saved"])

    mapping = load_additional_node_variables(
        node_config=NodeConfigDictAdapter.validate_python(container),
        graph_config={"nodes": [container, operator, aggregator]},
        variable_mapping={"iteration.iterator": ["source", "iterator"]},
        variable_loader=DUMMY_VARIABLE_LOADER,
        variable_pool=variable_pool,
        user_inputs={"list.#source.items#": ["one"], "list.#source.filter#": "one"},
    )

    assert mapping == {
        "iteration.iterator": ["source", "iterator"],
        "list.list.#source.items#": ["source", "items"],
        "list.list.#source.filter#": ["source", "filter"],
        "aggregate.aggregate.#source.fallback#": ["source", "fallback"],
    }
