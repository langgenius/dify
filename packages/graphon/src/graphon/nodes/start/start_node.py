from typing import Any, override

from jsonschema import Draft7Validator, ValidationError

from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.start.entities import StartNodeData
from graphon.variables.input_entities import VariableEntityType


class StartNode(Node[StartNodeData]):
    node_type = BuiltinNodeTypes.START
    execution_type = NodeExecutionType.ROOT

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        node_inputs = dict(
            self.runtime_state.variable_pool.get_by_prefix(self.id),
        )
        self._validate_and_normalize_json_object_inputs(node_inputs)
        outputs = dict(
            self.runtime_state.variable_pool.flatten(unprefixed_node_id=self.id),
        )
        outputs.update(node_inputs)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=node_inputs,
            outputs=outputs,
        )

    def _validate_and_normalize_json_object_inputs(
        self,
        node_inputs: dict[str, Any],
    ) -> None:
        for variable in self.node_data.variables:
            if variable.type != VariableEntityType.JSON_OBJECT:
                continue

            key = variable.variable
            value = node_inputs.get(key)

            if value is None and variable.required:
                msg = f"{key} is required in input form"
                raise ValueError(msg)

            # If no value provided, skip further processing for this key
            if not value:
                continue

            if not isinstance(value, dict):
                msg = f"JSON object for '{key}' must be an object"
                raise TypeError(msg)

            # Overwrite with normalized dict to ensure downstream consistency
            node_inputs[key] = value

            # If schema exists, then validate against it
            schema = variable.json_schema
            if not schema:
                continue

            try:
                Draft7Validator(schema).validate(value)
            except ValidationError as e:
                msg = f"JSON object for '{key}' does not match schema: {e.message}"
                raise ValueError(msg) from e
