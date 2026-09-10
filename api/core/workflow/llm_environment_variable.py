"""LLM environment-variable types and model-reference resolution helpers.

Graphon does not have an LLM segment type, so the runtime representation stays
an object variable. Workflow persistence and API boundaries use the semantic
``llm`` value type through the serialization helpers in this module.
"""

from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.workflow.variable_prefixes import ENVIRONMENT_VARIABLE_NODE_ID
from graphon.nodes.llm.entities import LLMMode, ModelConfig
from graphon.variables.variables import ObjectVariable, VariableBase

LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE = "llm"


class LLMModelSelection(BaseModel):
    """The shared model configuration stored by an LLM environment variable."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    provider: str = Field(min_length=1)
    name: str = Field(min_length=1)
    mode: LLMMode
    completion_params: dict[str, Any] | None = None


class LLMEnvironmentVariable(ObjectVariable):
    """An object variable with a strictly validated LLM model-selection value."""

    @field_validator("value", mode="before")
    @classmethod
    def validate_model_selection(cls, value: object) -> dict[str, Any]:
        return LLMModelSelection.model_validate(value).model_dump(mode="json", exclude_none=True)


def dump_environment_variable(variable: VariableBase, *, mode: str = "python") -> dict[str, Any]:
    """Serialize a variable while preserving its workflow-level semantic type."""

    result = variable.model_dump(mode=mode)
    if isinstance(variable, LLMEnvironmentVariable):
        result["value_type"] = LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE
    return result


def environment_variable_value_type(variable: VariableBase) -> str:
    """Return the public value type used by workflow environment-variable APIs."""

    if isinstance(variable, LLMEnvironmentVariable):
        return LLM_ENVIRONMENT_VARIABLE_VALUE_TYPE
    return str(variable.value_type.exposed_type())


def parse_llm_model_selector(selector: object) -> tuple[str, str]:
    """Validate and normalize an LLM node's environment-variable selector."""

    if (
        not isinstance(selector, Sequence)
        or isinstance(selector, str | bytes)
        or len(selector) != 2
        or selector[0] != ENVIRONMENT_VARIABLE_NODE_ID
        or not isinstance(selector[1], str)
        or not selector[1]
    ):
        raise ValueError("LLM model selector must have the form ['env', '<variable-name>']")
    return ENVIRONMENT_VARIABLE_NODE_ID, selector[1]


def should_resolve_llm_model_selector(selector: object) -> bool:
    """Return whether a selector uses the LLM environment-variable contract.

    Older snippet graphs can contain selectors such as ``["start", "MODEL"]``.
    They predate this contract and must keep using the node's static model.
    Malformed selectors and selectors beginning with ``env`` are handled by the
    strict parser so new invalid references still fail fast.
    """

    if selector is None:
        return False
    if (
        isinstance(selector, Sequence)
        and not isinstance(selector, str | bytes)
        and len(selector) > 0
        and selector[0] != ENVIRONMENT_VARIABLE_NODE_ID
    ):
        return False
    return True


def resolve_llm_model_config(
    *,
    node_model: ModelConfig,
    variable_name: str,
    variable_value: Mapping[str, Any],
) -> ModelConfig:
    """Apply a shared model configuration, preserving legacy node-local parameters."""

    try:
        selection = LLMModelSelection.model_validate(variable_value)
    except ValueError as exc:
        raise ValueError(f"LLM environment variable '{variable_name}' has an invalid model selection: {exc}") from exc

    if selection.mode != node_model.mode:
        raise ValueError(
            f"LLM environment variable '{variable_name}' uses mode '{selection.mode.value}', "
            f"but the referencing node uses mode '{node_model.mode.value}'"
        )

    update: dict[str, Any] = {
        "provider": selection.provider,
        "name": selection.name,
    }
    if selection.completion_params is not None:
        update["completion_params"] = selection.completion_params
    return node_model.model_copy(update=update)


def resolve_llm_model_config_from_environment(
    *,
    node_model: ModelConfig,
    selector: object,
    environment_variables: Mapping[str, VariableBase],
) -> ModelConfig:
    """Resolve a persisted LLM environment reference against workflow variables."""

    _, variable_name = parse_llm_model_selector(selector)
    variable = environment_variables.get(variable_name)
    if not isinstance(variable, LLMEnvironmentVariable):
        raise ValueError(f"LLM environment variable '{variable_name}' was not found or is not an LLM variable")
    return resolve_llm_model_config(
        node_model=node_model,
        variable_name=variable_name,
        variable_value=variable.value,
    )


def validate_llm_environment_model_references(
    *,
    graph: Mapping[str, Any],
    environment_variables: Sequence[VariableBase],
) -> None:
    """Validate every LLM environment-model reference in a workflow graph."""

    variables_by_name = {variable.name: variable for variable in environment_variables}
    nodes = graph.get("nodes", [])
    if not isinstance(nodes, Sequence) or isinstance(nodes, str | bytes):
        return

    for node in nodes:
        if not isinstance(node, Mapping):
            continue
        node_data = node.get("data")
        if not isinstance(node_data, Mapping) or node_data.get("type") != "llm":
            continue
        selector = node_data.get("model_selector")
        if not should_resolve_llm_model_selector(selector):
            continue
        model = ModelConfig.model_validate(node_data.get("model", {}))
        resolve_llm_model_config_from_environment(
            node_model=model,
            selector=selector,
            environment_variables=variables_by_name,
        )
