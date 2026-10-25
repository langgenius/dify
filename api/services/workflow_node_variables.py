"""Load editor inputs not exposed by Graphon's node selector extractors."""

from collections.abc import Mapping, Sequence
from typing import Any

from core.workflow.human_input_adapter import (
    EmailDeliveryMethod,
    adapt_node_config_for_graph,
    parse_human_input_delivery_methods,
)
from core.workflow.nodes.human_input.entities import HumanInputNodeData
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from core.workflow.nodes.knowledge_index.entities import KnowledgeIndexNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.list_operator.entities import FilterOperator, ListOperatorNodeData
from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData
from graphon.runtime import VariablePool
from graphon.variable_loader import VariableLoader, load_into_variable_pool


def get_human_input_form_variable_mapping(node_id: str, node_data: HumanInputNodeData) -> Mapping[str, Sequence[str]]:
    """Keep editor template paths intact alongside form-field dependency selectors."""
    selectors = [
        selector.value_selector
        for selector in VariableTemplateParser(template=node_data.form_content).extract_variable_selectors()
        if len(selector.value_selector) >= 2
    ]
    selectors.extend(
        selector for form_input in node_data.inputs for selector in form_input.extract_variable_selectors()
    )
    return {f"{node_id}.#{'.'.join(selector)}#": selector for selector in selectors}


def _input_mappings(config: NodeConfigDict) -> Mapping[str, Sequence[str]]:
    node_id = config["id"]
    data = config["data"]
    selectors: list[Sequence[str]] = []
    match data.type:
        case BuiltinNodeTypes.END:
            end = EndNodeData.model_validate(data.model_dump())
            selectors.extend(output.value_selector for output in end.outputs)
        case BuiltinNodeTypes.VARIABLE_AGGREGATOR:
            aggregator = VariableAggregatorNodeData.model_validate(data.model_dump())
            if aggregator.advanced_settings and aggregator.advanced_settings.group_enabled:
                selectors.extend(
                    selector for group in aggregator.advanced_settings.groups for selector in group.variables
                )
            else:
                selectors.extend(aggregator.variables)
        case BuiltinNodeTypes.LIST_OPERATOR:
            operator = ListOperatorNodeData.model_validate(data.model_dump())
            selectors.append(operator.variable)
            templates = []
            if operator.filter_by.enabled:
                templates.extend(
                    condition.value
                    for condition in operator.filter_by.conditions
                    if condition.comparison_operator not in (FilterOperator.EMPTY, FilterOperator.NOT_EMPTY)
                    and isinstance(condition.value, str)
                )
            if operator.extract_by.enabled:
                templates.append(operator.extract_by.serial)
            selectors.extend(
                selector.value_selector
                for template in templates
                for selector in VariableTemplateParser(template=template).extract_variable_selectors()
            )
        case BuiltinNodeTypes.HUMAN_INPUT:
            human_input = HumanInputNodeData.model_validate(data.model_dump())
            mapping = dict(get_human_input_form_variable_mapping(node_id, human_input))
            for method in parse_human_input_delivery_methods(data):
                if method.enabled and isinstance(method, EmailDeliveryMethod):
                    mapping.update(
                        {
                            f"{node_id}.#{'.'.join(selector.value_selector)}#": selector.value_selector
                            for selector in VariableTemplateParser(
                                template=method.config.body
                            ).extract_variable_selectors()
                            if len(selector.value_selector) >= 2
                        }
                    )
            return mapping
        case _ if data.type == KNOWLEDGE_INDEX_NODE_TYPE:
            knowledge_index = KnowledgeIndexNodeData.model_validate(data.model_dump())
            return {f"{node_id}.query": knowledge_index.index_chunk_variable_selector}
    return {f"{node_id}.#{'.'.join(selector)}#": selector for selector in selectors}


def load_additional_node_variables(
    *,
    node_config: NodeConfigDict,
    graph_config: Mapping[str, Any],
    variable_mapping: Mapping[str, Sequence[str]],
    variable_loader: VariableLoader,
    variable_pool: VariablePool,
    user_inputs: Mapping[str, Any],
) -> Mapping[str, Sequence[str]]:
    """Supplement debug inputs, leaving unavailable branches and End outputs unset.

    Container callers supply their already scoped debug subtree. References to
    nodes within it are produced at runtime instead of loaded as external inputs.
    """
    is_container = node_config["data"].type in (BuiltinNodeTypes.ITERATION, BuiltinNodeTypes.LOOP)
    configs = (
        [NodeConfigDictAdapter.validate_python(adapt_node_config_for_graph(node)) for node in graph_config["nodes"]]
        if is_container
        else [node_config]
    )
    internal_ids = {config["id"] for config in configs} if is_container else set()
    additional: dict[str, Sequence[str]] = {}
    optional_keys: set[str] = set()
    for config in configs:
        prefix = f"{config['id']}." if config["id"] != node_config["id"] else ""
        for key, selector in _input_mappings(config).items():
            key = prefix + key
            if key in variable_mapping or (selector and selector[0] in internal_ids):
                continue
            additional[key] = selector
            if config["data"].type in (BuiltinNodeTypes.VARIABLE_AGGREGATOR, BuiltinNodeTypes.END):
                optional_keys.add(key)
    if not additional:
        return variable_mapping

    load_into_variable_pool(variable_loader, variable_pool, additional, user_inputs)
    return {
        **variable_mapping,
        **{
            key: selector
            for key, selector in additional.items()
            if key not in optional_keys
            or key in user_inputs
            or key.split(".", 1)[1] in user_inputs
            or variable_pool.get(selector) is not None
        },
    }


def add_node_input_to_variable_pool(variable_pool: VariablePool, selector: Sequence[str], value: Any) -> None:
    """Merge an explicit nested input into its root variable without losing siblings."""
    root_selector = list(selector[:2])
    if len(selector) > 2:
        current_variable = variable_pool.get(root_selector)
        current_value = current_variable.value if current_variable is not None else None
        root_value = dict(current_value) if isinstance(current_value, dict) else {}
        parent = root_value
        for key in selector[2:-1]:
            child = parent.get(key)
            parent[key] = dict(child) if isinstance(child, dict) else {}
            parent = parent[key]
        parent[selector[-1]] = value
        value = root_value
    variable_pool.add(root_selector, value)
