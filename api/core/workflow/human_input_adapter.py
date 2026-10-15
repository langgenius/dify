"""Normalize stored Workflow payloads for Human Input and Tool nodes."""

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, TypeAdapter

from enums.human_input import DeliveryMethodType
from graphon.enums import BuiltinNodeTypes
from models.human_input_delivery import DeliveryChannelConfig

_DELIVERY_METHODS_ADAPTER = TypeAdapter(list[DeliveryChannelConfig])


def _copy_mapping(value: object) -> dict[str, Any] | None:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="python")
    if isinstance(value, Mapping):
        return dict(value)
    return None


def adapt_human_input_node_data_for_graph(node_data: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_data)
    if normalized is None:
        raise TypeError(f"human-input node data must be a mapping, got {type(node_data).__name__}")

    delivery_methods = normalized.get("delivery_methods")
    if not isinstance(delivery_methods, list):
        return normalized

    normalized_methods: list[Any] = []
    for method in delivery_methods:
        method_mapping = _copy_mapping(method)
        if method_mapping is None:
            normalized_methods.append(method)
            continue

        config_mapping = _copy_mapping(method_mapping.get("config"))
        if config_mapping is not None:
            recipients_mapping = _copy_mapping(config_mapping.get("recipients"))
            if recipients_mapping is not None:
                config_mapping["recipients"] = _normalize_email_recipients(recipients_mapping)
            method_mapping["config"] = config_mapping

        normalized_methods.append(method_mapping)

    normalized["delivery_methods"] = normalized_methods
    return normalized


def parse_human_input_delivery_methods(node_data: Mapping[str, Any] | BaseModel) -> list[DeliveryChannelConfig]:
    normalized = adapt_human_input_node_data_for_graph(node_data)
    raw_delivery_methods = normalized.get("delivery_methods")
    if not isinstance(raw_delivery_methods, list):
        return []
    return list(_DELIVERY_METHODS_ADAPTER.validate_python(raw_delivery_methods))


def is_human_input_webapp_enabled(node_data: Mapping[str, Any] | BaseModel) -> bool:
    for method in parse_human_input_delivery_methods(node_data):
        if method.enabled and method.type == DeliveryMethodType.WEBAPP:
            return True
    return False


def adapt_node_data_for_graph(node_data: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_data)
    if normalized is None:
        raise TypeError(f"node data must be a mapping, got {type(node_data).__name__}")

    node_type = normalized.get("type")
    if node_type == BuiltinNodeTypes.HUMAN_INPUT:
        return adapt_human_input_node_data_for_graph(normalized)
    if node_type == BuiltinNodeTypes.TOOL:
        return _adapt_tool_node_data_for_graph(normalized)
    return normalized


def adapt_node_config_for_graph(node_config: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_config)
    if normalized is None:
        raise TypeError(f"node config must be a mapping, got {type(node_config).__name__}")

    data_mapping = _copy_mapping(normalized.get("data"))
    if data_mapping is None:
        return normalized

    normalized["data"] = adapt_node_data_for_graph(data_mapping)
    return normalized


def _adapt_tool_node_data_for_graph(node_data: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(node_data)

    raw_tool_configurations = normalized.get("tool_configurations")
    if not isinstance(raw_tool_configurations, Mapping):
        return normalized

    existing_tool_parameters = normalized.get("tool_parameters")
    normalized_tool_parameters = dict(existing_tool_parameters) if isinstance(existing_tool_parameters, Mapping) else {}
    normalized_tool_configurations: dict[str, Any] = {}
    found_legacy_tool_inputs = False

    for name, value in raw_tool_configurations.items():
        if not isinstance(value, Mapping):
            normalized_tool_configurations[name] = value
            continue

        selector_value = _extract_selector_configuration(value)
        if selector_value is not None:
            # Model/app selectors are dictionaries even when they come through the legacy tool configuration path.
            # Move them to tool_parameters so graph validation does not flatten them as primitive constants.
            found_legacy_tool_inputs = True
            normalized_tool_parameters.setdefault(name, {"type": "constant", "value": selector_value})
            continue

        input_type = value.get("type")
        input_value = value.get("value")
        if input_type not in {"mixed", "variable", "constant"}:
            normalized_tool_configurations[name] = value
            continue

        found_legacy_tool_inputs = True
        normalized_tool_parameters.setdefault(name, dict(value))

        flattened_value = _flatten_legacy_tool_configuration_value(
            input_type=input_type,
            input_value=input_value,
        )
        if flattened_value is not None:
            normalized_tool_configurations[name] = flattened_value

    if not found_legacy_tool_inputs:
        return normalized

    normalized["tool_parameters"] = normalized_tool_parameters
    normalized["tool_configurations"] = normalized_tool_configurations
    return normalized


def _flatten_legacy_tool_configuration_value(*, input_type: Any, input_value: Any) -> str | int | float | bool | None:
    if input_type in {"mixed", "constant"} and isinstance(input_value, str | int | float | bool):
        return input_value

    if (
        input_type == "variable"
        and isinstance(input_value, list)
        and all(isinstance(item, str) for item in input_value)
    ):
        return "{{#" + ".".join(input_value) + "#}}"

    return None


def _extract_selector_configuration(value: Mapping[str, Any]) -> dict[str, Any] | None:
    input_value = value.get("value")
    if isinstance(input_value, Mapping) and _is_selector_configuration(input_value):
        return dict(input_value)

    if _is_selector_configuration(value):
        selector_value = dict(value)
        selector_value.pop("type", None)
        selector_value.pop("value", None)
        return selector_value

    return None


def _is_selector_configuration(value: Mapping[str, Any]) -> bool:
    return (
        isinstance(value.get("provider"), str)
        and isinstance(value.get("model"), str)
        and isinstance(value.get("model_type"), str)
    ) or isinstance(value.get("app_id"), str)


def _normalize_email_recipients(recipients: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(recipients)

    legacy_include_bound_group = normalized.pop("whole_workspace", None)
    if "include_bound_group" not in normalized and legacy_include_bound_group is not None:
        normalized["include_bound_group"] = legacy_include_bound_group

    items = normalized.get("items")
    if not isinstance(items, list):
        return normalized

    normalized_items: list[Any] = []
    for item in items:
        item_mapping = _copy_mapping(item)
        if item_mapping is None:
            normalized_items.append(item)
            continue

        legacy_reference_id = item_mapping.pop("user_id", None)
        if "reference_id" not in item_mapping and legacy_reference_id is not None:
            item_mapping["reference_id"] = legacy_reference_id
        normalized_items.append(item_mapping)

    normalized["items"] = normalized_items
    return normalized
