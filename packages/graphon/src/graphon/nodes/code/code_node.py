from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal
from textwrap import dedent
from typing import Any, TypeGuard, assert_never, override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.nodes.code.entities import CodeLanguage, CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.code.protocols import CodeExecutorProtocol
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.variables.segments import ArrayFileSegment
from graphon.variables.types import SegmentType

from .exc import (
    CodeNodeError,
    DepthLimitError,
    OutputValidationError,
)


def _build_default_config(
    *,
    language: CodeLanguage,
    code: str,
) -> Mapping[str, object]:
    return {
        "type": "code",
        "config": {
            "variables": [
                {"variable": "arg1", "value_selector": []},
                {"variable": "arg2", "value_selector": []},
            ],
            "code_language": language,
            "code": code,
            "outputs": {"result": {"type": "string", "children": None}},
        },
    }


_DEFAULT_CODE_BY_LANGUAGE: Mapping[CodeLanguage, str] = {
    CodeLanguage.PYTHON3: dedent(
        """
        def main(arg1: str, arg2: str):
            return {
                "result": arg1 + arg2,
            }
        """,
    ),
    CodeLanguage.JAVASCRIPT: dedent(
        """
        function main({arg1, arg2}) {
            return {
                result: arg1 + arg2
            }
        }
        """,
    ),
}


class CodeNode(Node[CodeNodeData]):
    node_type = BuiltinNodeTypes.CODE
    _limits: CodeNodeLimits

    @override
    def __init__(
        self,
        node_id: str,
        data: CodeNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        code_executor: CodeExecutorProtocol,
        code_limits: CodeNodeLimits,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        self._code_executor: CodeExecutorProtocol = code_executor
        self._limits = code_limits

    @property
    def limits(self) -> CodeNodeLimits:
        """Return the validation limits used by this node."""
        return self._limits

    @limits.setter
    def limits(self, value: CodeNodeLimits) -> None:
        self._limits = value

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
        """Build the default node config, optionally honoring language filters."""
        code_language = CodeLanguage.PYTHON3
        if filters:
            raw_code_language = filters.get("code_language", CodeLanguage.PYTHON3)
            if isinstance(raw_code_language, CodeLanguage):
                code_language = raw_code_language
            elif isinstance(raw_code_language, str):
                code_language = CodeLanguage(raw_code_language)
            else:
                msg = f"Unsupported code language filter: {raw_code_language!r}"
                raise CodeNodeError(msg)

        default_code = _DEFAULT_CODE_BY_LANGUAGE.get(code_language)
        if default_code is None:
            msg = f"Unsupported code language: {code_language}"
            raise CodeNodeError(msg)
        return _build_default_config(language=code_language, code=default_code)

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        # Get code language
        code_language = self.node_data.code_language
        code = self.node_data.code

        # Get variables
        variables = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            variable = self.runtime_state.variable_pool.get(
                variable_selector.value_selector,
            )
            if isinstance(variable, ArrayFileSegment):
                variables[variable_name] = (
                    [v.to_dict() for v in variable.value] if variable.value else None
                )
            else:
                variables[variable_name] = variable.to_object() if variable else None
        # Run code
        try:
            result = self._code_executor.execute(
                language=code_language,
                code=code,
                inputs=variables,
            )

            # Transform result
            result = self._transform_result(
                result=result,
                output_schema=self.node_data.outputs,
            )
        except CodeNodeError as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )
        except Exception as e:
            if not self._code_executor.is_execution_error(e):
                raise
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                error_type=type(e).__name__,
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variables,
            outputs=result,
        )

    def _check_string(self, value: str | None, variable: str) -> str | None:
        """Validate a string output against node limits and sanitize NUL bytes."""
        if value is None:
            return None

        if len(value) > self._limits.max_string_length:
            msg = (
                f"The length of output variable `{variable}` must be"
                f" less than {self._limits.max_string_length} characters"
            )
            raise OutputValidationError(msg)

        return value.replace("\x00", "")

    def _check_boolean(self, value: bool | None) -> bool | None:
        if value is None:
            return None

        return value

    def _check_number(self, value: float | None, variable: str) -> int | float | None:
        """Validate a numeric output against configured range and precision limits."""
        if value is None:
            return None

        if value > self._limits.max_number or value < self._limits.min_number:
            msg = (
                f"Output variable `{variable}` is out of range, "
                f"it must be between {self._limits.min_number} "
                f"and {self._limits.max_number}."
            )
            raise OutputValidationError(msg)

        if isinstance(value, float):
            decimal_value = Decimal(str(value)).normalize()
            exponent = decimal_value.as_tuple().exponent
            precision = -exponent if isinstance(exponent, int) and exponent < 0 else 0
            # raise error if precision is too high
            if precision > self._limits.max_precision:
                msg = (
                    f"Output variable `{variable}` has too high precision,"
                    f" it must be less than {self._limits.max_precision} digits."
                )
                raise OutputValidationError(msg)

        return value

    @staticmethod
    def _output_path(prefix: str, output_name: str) -> str:
        if prefix:
            return f"{prefix}.{output_name}"
        return output_name

    @staticmethod
    def _output_path_with_index(prefix: str, output_name: str, index: int) -> str:
        return f"{CodeNode._output_path(prefix, output_name)}[{index}]"

    @staticmethod
    def _is_output_object(value: Any) -> TypeGuard[dict[str, Any]]:
        """Treat JSON-like object outputs as string-keyed dictionaries."""
        return isinstance(value, dict)

    def _normalize_output_object_array(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> list[dict[str, Any] | None] | None:
        output_path = self._output_path(prefix, output_name)
        if not isinstance(value, list):
            if value is None:
                return None
            msg = f"Output {output_path} is not an array, got {type(value)} instead."
            raise OutputValidationError(msg)

        if len(value) > self._limits.max_object_array_length:
            msg = (
                f"The length of output variable `{output_path}` must be "
                f"less than {self._limits.max_object_array_length} elements."
            )
            raise OutputValidationError(msg)

        normalized_values: list[dict[str, Any] | None] = []
        for i, inner_value in enumerate(value):
            if inner_value is None:
                normalized_values.append(None)
                continue
            if not self._is_output_object(inner_value):
                msg = (
                    f"Output {output_path}[{i}] is not an object, got "
                    f"{type(inner_value)} instead at index {i}."
                )
                raise OutputValidationError(msg)
            normalized_values.append(inner_value)

        return normalized_values

    def _validate_untyped_list(
        self,
        *,
        output_name: str,
        output_value: list[Any],
        prefix: str,
        depth: int,
    ) -> None:
        output_path = self._output_path(prefix, output_name)
        first_element = output_value[0] if output_value else None
        if first_element is None:
            return

        if isinstance(first_element, int | float) and all(
            value is None or isinstance(value, int | float) for value in output_value
        ):
            for i, value in enumerate(output_value):
                self._check_number(
                    value=value,
                    variable=self._output_path_with_index(prefix, output_name, i),
                )
            return

        if isinstance(first_element, str) and all(
            value is None or isinstance(value, str) for value in output_value
        ):
            for i, value in enumerate(output_value):
                self._check_string(
                    value=value,
                    variable=self._output_path_with_index(prefix, output_name, i),
                )
            return

        if (
            isinstance(first_element, dict)
            and all(value is None or isinstance(value, dict) for value in output_value)
        ) or (
            isinstance(first_element, list)
            and all(value is None or isinstance(value, list) for value in output_value)
        ):
            for i, value in enumerate(output_value):
                if value is not None:
                    self._transform_result(
                        result=value,
                        output_schema=None,
                        prefix=self._output_path_with_index(prefix, output_name, i),
                        depth=depth + 1,
                    )
            return

        msg = (
            f"Output {output_path} is not a valid array."
            f" make sure all elements are of the same type."
        )
        raise OutputValidationError(msg)

    def _validate_untyped_output(
        self,
        *,
        output_name: str,
        output_value: Any,
        prefix: str,
        depth: int,
    ) -> None:
        output_path = self._output_path(prefix, output_name)
        if isinstance(output_value, dict):
            self._transform_result(
                result=output_value,
                output_schema=None,
                prefix=output_path,
                depth=depth + 1,
            )
            return
        if isinstance(output_value, bool):
            self._check_boolean(output_value)
            return
        if isinstance(output_value, int | float):
            self._check_number(value=output_value, variable=output_path)
            return
        if isinstance(output_value, str):
            self._check_string(value=output_value, variable=output_path)
            return
        if isinstance(output_value, list):
            self._validate_untyped_list(
                output_name=output_name,
                output_value=output_value,
                prefix=prefix,
                depth=depth,
            )
            return
        if output_value is None:
            return

        msg = f"Output {output_path} is not a valid type."
        raise OutputValidationError(msg)

    def _transform_object_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
        depth: int,
        output_schema: dict[str, CodeNodeData.Output] | None,
    ) -> Mapping[str, Any] | None:
        output_path = self._output_path(prefix, output_name)
        if not self._is_output_object(value):
            if value is None:
                return None
            msg = f"Output {output_path} is not an object, got {type(value)} instead."
            raise OutputValidationError(msg)

        return self._transform_result(
            result=value,
            output_schema=output_schema,
            prefix=output_path,
            depth=depth + 1,
        )

    def _transform_number_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> int | float | None:
        output_path = self._output_path(prefix, output_name)
        if value is not None and not isinstance(value, (int, float)):
            msg = f"Output {output_path} is not a number, got {type(value)} instead."
            raise OutputValidationError(msg)

        checked = self._check_number(value=value, variable=output_path)
        return self._convert_boolean_to_int(checked)

    def _transform_string_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> str | None:
        output_path = self._output_path(prefix, output_name)
        if value is not None and not isinstance(value, str):
            msg = (
                f"Output {output_path} must be a string,"
                f" got {type(value).__name__} instead."
            )
            raise OutputValidationError(msg)

        return self._check_string(value=value, variable=output_path)

    def _transform_boolean_output(self, *, value: Any) -> bool | None:
        return self._check_boolean(value=value)

    def _transform_array_number_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> list[int | float | None] | None:
        output_path = self._output_path(prefix, output_name)
        if not isinstance(value, list):
            if value is None:
                return None
            msg = f"Output {output_path} is not an array, got {type(value)} instead."
            raise OutputValidationError(msg)

        if len(value) > self._limits.max_number_array_length:
            msg = (
                f"The length of output variable `{output_path}` must be "
                f"less than {self._limits.max_number_array_length} elements."
            )
            raise OutputValidationError(msg)

        for i, inner_value in enumerate(value):
            if not isinstance(inner_value, (int, float)):
                msg = (
                    f"The element at index {i} of output variable "
                    f"`{output_path}` must be a number."
                )
                raise OutputValidationError(msg)

        return [self._convert_boolean_to_int(v) for v in value]

    def _transform_array_string_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> list[str | None] | None:
        output_path = self._output_path(prefix, output_name)
        if not isinstance(value, list):
            if value is None:
                return None
            msg = f"Output {output_path} is not an array, got {type(value)} instead."
            raise OutputValidationError(msg)

        if len(value) > self._limits.max_string_array_length:
            msg = (
                f"The length of output variable `{output_path}` must be "
                f"less than {self._limits.max_string_array_length} elements."
            )
            raise OutputValidationError(msg)

        normalized_values: list[str | None] = []
        for i, inner_value in enumerate(value):
            if inner_value is not None and not isinstance(inner_value, str):
                msg = (
                    f"Output {output_path}[{i}] must be a string, got "
                    f"{type(inner_value).__name__} instead."
                )
                raise OutputValidationError(msg)
            normalized_values.append(
                self._check_string(
                    value=inner_value,
                    variable=self._output_path_with_index(prefix, output_name, i),
                ),
            )
        return normalized_values

    def _transform_array_object_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
        depth: int,
        output_schema: dict[str, CodeNodeData.Output] | None,
    ) -> list[Mapping[str, Any] | None] | None:
        normalized_object_values = self._normalize_output_object_array(
            value=value,
            output_name=output_name,
            prefix=prefix,
        )
        if normalized_object_values is None:
            return None

        transformed_values: list[Mapping[str, Any] | None] = []
        for i, inner_value in enumerate(normalized_object_values):
            if inner_value is None:
                transformed_values.append(None)
                continue
            transformed_values.append(
                self._transform_result(
                    result=inner_value,
                    output_schema=output_schema,
                    prefix=self._output_path_with_index(prefix, output_name, i),
                    depth=depth + 1,
                ),
            )
        return transformed_values

    def _transform_array_boolean_output(
        self,
        *,
        value: Any,
        output_name: str,
        prefix: str,
    ) -> list[bool | None] | None:
        output_path = self._output_path(prefix, output_name)
        if not isinstance(value, list):
            if value is None:
                return None
            msg = f"Output {output_path} is not an array, got {type(value)} instead."
            raise OutputValidationError(msg)

        for i, inner_value in enumerate(value):
            if inner_value is not None and not isinstance(inner_value, bool):
                msg = (
                    f"Output {output_path}[{i}] is not a boolean, got "
                    f"{type(inner_value)} instead."
                )
                raise OutputValidationError(msg)
            self._check_boolean(value=inner_value)

        return value

    def _transform_schema_output(
        self,
        *,
        output_name: str,
        output_config: CodeNodeData.Output,
        result: Mapping[str, Any],
        prefix: str,
        depth: int,
    ) -> Any:
        value = result[output_name]
        output_type = output_config.type
        match output_type:
            case SegmentType.OBJECT:
                transformed_value = self._transform_object_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                    depth=depth,
                    output_schema=output_config.children,
                )
            case SegmentType.NUMBER:
                transformed_value = self._transform_number_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                )
            case SegmentType.STRING:
                transformed_value = self._transform_string_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                )
            case SegmentType.BOOLEAN:
                transformed_value = self._transform_boolean_output(value=value)
            case SegmentType.ARRAY_NUMBER:
                transformed_value = self._transform_array_number_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                )
            case SegmentType.ARRAY_STRING:
                transformed_value = self._transform_array_string_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                )
            case SegmentType.ARRAY_OBJECT:
                transformed_value = self._transform_array_object_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                    depth=depth,
                    output_schema=output_config.children,
                )
            case SegmentType.ARRAY_BOOLEAN:
                transformed_value = self._transform_array_boolean_output(
                    value=value,
                    output_name=output_name,
                    prefix=prefix,
                )
            case (
                SegmentType.INTEGER
                | SegmentType.FLOAT
                | SegmentType.SECRET
                | SegmentType.FILE
                | SegmentType.ARRAY_ANY
                | SegmentType.ARRAY_FILE
                | SegmentType.NONE
                | SegmentType.GROUP
            ):
                msg = f"Output type {output_type} is not supported."
                raise OutputValidationError(msg)
            case _:
                assert_never(output_type)
        return transformed_value

    def _transform_result(
        self,
        result: Mapping[str, Any],
        output_schema: dict[str, CodeNodeData.Output] | None,
        prefix: str = "",
        depth: int = 1,
    ) -> Mapping[str, Any]:
        # Keep code-node outputs JSON-like. Schema-validated arrays may contain
        # `None` items, which do not fit the stricter `Array*Segment` classes.
        if depth > self._limits.max_depth:
            msg = f"Depth limit {self._limits.max_depth} reached, object too deep."
            raise DepthLimitError(msg)

        transformed_result: dict[str, Any] = {}
        if output_schema is None:
            for output_name, output_value in result.items():
                self._validate_untyped_output(
                    output_name=output_name,
                    output_value=output_value,
                    prefix=prefix,
                    depth=depth,
                )

            return result

        parameters_validated = {}
        for output_name, output_config in output_schema.items():
            if output_name not in result:
                output_path = self._output_path(prefix, output_name)
                msg = f"Output {output_path} is missing."
                raise OutputValidationError(msg)
            transformed_result[output_name] = self._transform_schema_output(
                output_name=output_name,
                output_config=output_config,
                result=result,
                prefix=prefix,
                depth=depth,
            )

            parameters_validated[output_name] = True

        # check if all output parameters are validated
        if len(parameters_validated) != len(result):
            msg = "Not all output parameters are validated."
            raise CodeNodeError(msg)

        return transformed_result

    def transform_result(
        self,
        result: Mapping[str, Any],
        output_schema: dict[str, CodeNodeData.Output] | None,
        prefix: str = "",
        depth: int = 1,
    ) -> Mapping[str, Any]:
        """Validate and normalize code-node outputs against the schema."""
        return self._transform_result(
            result=result,
            output_schema=output_schema,
            prefix=prefix,
            depth=depth,
        )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: CodeNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config  # Explicitly mark as unused
        return {
            node_id + "." + variable_selector.variable: variable_selector.value_selector
            for variable_selector in node_data.variables
        }

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled

    @staticmethod
    def _convert_boolean_to_int(value: bool | float | None) -> int | float | None:
        """Convert booleans to integers when the output schema specifies a
        NUMBER type.

        This ensures compatibility with existing workflows that may use
        `True` and `False` as values for NUMBER type outputs.

        Returns:
            `None`, the original numeric value, or an integer converted from `bool`.

        """
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        return value
