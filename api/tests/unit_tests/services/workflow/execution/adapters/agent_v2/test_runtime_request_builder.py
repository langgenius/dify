import pytest

from graphon.runtime.variable_pool import VariablePool
from models.agent_config_entities import AgentSoulConfig
from services.workflow.execution.adapters.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeRequestBuildError,
    build_knowledge_layer_config,
)

_PROGRAM_TEMPLATE = "{{#start.guide_program_id#}}"
_ITEM_TEMPLATE = "{{#start.guide_item_id#}}"


def _soul(program_operator: str = "=") -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "exhibits",
                        "name": "Exhibits",
                        "datasets": [{"id": "dataset-1"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                        "metadata_filtering": {
                            "mode": "manual",
                            "conditions": {
                                "logical_operator": "and",
                                "conditions": [
                                    {
                                        "name": "guide_program_id",
                                        "comparison_operator": program_operator,
                                        "value": _PROGRAM_TEMPLATE,
                                    },
                                    {"name": "guide_item_id", "comparison_operator": "=", "value": _ITEM_TEMPLATE},
                                ],
                            },
                        },
                    }
                ]
            }
        }
    )


def _conditions(soul: AgentSoulConfig, pool: VariablePool | None) -> list[dict[str, object]]:
    layer = build_knowledge_layer_config(soul, variable_pool=pool)
    assert layer is not None
    conditions = layer.sets[0].metadata_filtering.conditions
    assert conditions is not None
    return conditions.model_dump(mode="json")["conditions"]


def _saved_values(soul: AgentSoulConfig) -> list[object]:
    conditions = soul.knowledge.sets[0].metadata_filtering.conditions
    assert conditions is not None
    return [condition.value for condition in conditions.conditions]


@pytest.mark.parametrize(("program_id", "item_id"), [(123, 456), (789, 0), ("00123", "00456")])
def test_manual_metadata_filters_resolve_current_run_values_without_mutating_soul(
    program_id: int | str, item_id: int | str
) -> None:
    soul = _soul()
    pool = VariablePool()
    pool.add(["start", "guide_program_id"], program_id)
    pool.add(["start", "guide_item_id"], item_id)

    assert _conditions(soul, pool) == [
        {"name": "guide_program_id", "comparison_operator": "=", "value": program_id},
        {"name": "guide_item_id", "comparison_operator": "=", "value": item_id},
    ]
    assert _saved_values(soul) == [_PROGRAM_TEMPLATE, _ITEM_TEMPLATE]


def test_manual_metadata_filter_rejects_missing_run_variable() -> None:
    with pytest.raises(WorkflowAgentRuntimeRequestBuildError, match="start.guide_program_id") as error:
        build_knowledge_layer_config(_soul(), variable_pool=VariablePool())

    assert error.value.error_code == "agent_metadata_filter_variable_not_found"


@pytest.mark.parametrize("operator", ["empty", "not empty"])
def test_value_free_metadata_filters_keep_retained_template(operator: str) -> None:
    pool = VariablePool()
    pool.add(["start", "guide_item_id"], 456)

    assert _conditions(_soul(operator), pool) == [
        {"name": "guide_program_id", "comparison_operator": operator, "value": _PROGRAM_TEMPLATE},
        {"name": "guide_item_id", "comparison_operator": "=", "value": 456},
    ]


def test_standalone_callers_keep_literal_metadata_filters() -> None:
    assert _conditions(_soul(), None) == [
        {"name": "guide_program_id", "comparison_operator": "=", "value": _PROGRAM_TEMPLATE},
        {"name": "guide_item_id", "comparison_operator": "=", "value": _ITEM_TEMPLATE},
    ]
