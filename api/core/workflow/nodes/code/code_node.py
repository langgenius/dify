from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import TYPE_CHECKING, Any, ClassVar, cast

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.variables.segments import ArrayFileSegment
from core.variables.types import SegmentType
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.code.entities import CodeNodeData
from core.workflow.nodes.code.limits import CodeNodeLimits

from .exc import (
    CodeNodeError,
    DepthLimitError,
    OutputValidationError,
)

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


class CodeNode(Node[CodeNodeData]):
    node_type = NodeType.CODE
    _DEFAULT_CODE_PROVIDERS: ClassVar[tuple[type[CodeNodeProvider], ...]] = (
        Python3CodeProvider,
        JavascriptCodeProvider,
    )
    _limits: CodeNodeLimits

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        code_executor: type[CodeExecutor] | None = None,
        code_providers: Sequence[type[CodeNodeProvider]] | None = None,
        code_limits: CodeNodeLimits,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._code_executor: type[CodeExecutor] = code_executor or CodeExecutor
        self._code_providers: tuple[type[CodeNodeProvider], ...] = (
            tuple(code_providers) if code_providers else self._DEFAULT_CODE_PROVIDERS
        )
        self._limits = code_limits

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        code_language = CodeLanguage.PYTHON3
        if filters:
            code_language = cast(CodeLanguage, filters.get("code_language", CodeLanguage.PYTHON3))

        code_provider: type[CodeNodeProvider] = next(
            provider for provider in cls._DEFAULT_CODE_PROVIDERS if provider.is_accept_language(code_language)
        )

        return code_provider.get_default_config()

    @classmethod
    def default_code_providers(cls) -> tuple[type[CodeNodeProvider], ...]:
        return cls._DEFAULT_CODE_PROVIDERS

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        # Get code language
        code_language = self.node_data.code_language
        code = self.node_data.code

        # Get variables
        variables = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            if isinstance(variable, ArrayFileSegment):
                variables[variable_name] = [v.to_dict() for v in variable.value] if variable.value else None
            else:
                variables[variable_name] = variable.to_object() if variable else None
        # Run code
        try:
            _ = self._select_code_provider(code_language)
            result = self._code_executor.execute_workflow_code_template(
                language=code_language,
                code=code,
                inputs=variables,
            )

            # Transform result
            result = self._transform_result(result=result, output_schema=self.node_data.outputs)
        except (CodeExecutionError, CodeNodeError) as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error=str(e), error_type=type(e).__name__
            )

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=result)

    def _select_code_provider(self, code_language: CodeLanguage) -> type[CodeNodeProvider]:
        for provider in self._code_providers:
            if provider.is_accept_language(code_language):
                return provider
        raise CodeNodeError(f"Unsupported code language: {code_language}")

    def _check_string(self, value: str | None, variable: str) -> str | None:
        """
        Check string
        :param value: value
        :param variable: variable
        :return:
        """
        if value is None:
            return None

        if len(value) > self._limits.max_string_length:
            raise OutputValidationError(
                f"The length of output variable `{variable}` must be"
                f" less than {self._limits.max_string_length} characters"
            )

        return value.replace("\x00", "")

    def _check_boolean(self, value: bool | None, variable: str) -> bool | None:
        if value is None:
            return None

        return value

    def _check_number(self, value: int | float | None, variable: str) -> int | float | None:
        """
        Check number
        :param value: value
        :param variable: variable
        :return:
        """
        if value is None:
            return None

        if value > self._limits.max_number or value < self._limits.min_number:
            raise OutputValidationError(
                f"Output variable `{variable}` is out of range,"
                f" it must be between {self._limits.min_number} and {self._limits.max_number}."
            )

        if isinstance(value, float):
            decimal_value = Decimal(str(value)).normalize()
            precision = -decimal_value.as_tuple().exponent if decimal_value.as_tuple().exponent < 0 else 0  # type: ignore[operator]
            # raise error if precision is too high
            if precision > self._limits.max_precision:
                raise OutputValidationError(
                    f"Output variable `{variable}` has too high precision,"
                    f" it must be less than {self._limits.max_precision} digits."
                )

        return value

    def _transform_result(
        self,
        result: Mapping[str, Any],
        output_schema: dict[str, CodeNodeData.Output] | None,
        prefix: str = "",
        depth: int = 1,
    ):
        # TODO(QuantumGhost): Replace native Python lists with `Array*Segment` classes.
        # Note that `_transform_result` may produce lists containing `None` values,
        # which don't conform to the type requirements of `Array*Segment` classes.
        if depth > self._limits.max_depth:
            raise DepthLimitError(f"Depth limit {self._limits.max_depth} reached, object too deep.")

        transformed_result: dict[str, Any] = {}
        if output_schema is None:
            # validate output thought instance type
            for output_name, output_value in result.items():
                if isinstance(output_value, dict):
                    self._transform_result(
                        result=output_value,
                        output_schema=None,
                        prefix=f"{prefix}.{output_name}" if prefix else output_name,
                        depth=depth + 1,
                    )
                elif isinstance(output_value, bool):
                    self._check_boolean(output_value, variable=f"{prefix}.{output_name}" if prefix else output_name)
                elif isinstance(output_value, int | float):
                    self._check_number(
                        value=output_value, variable=f"{prefix}.{output_name}" if prefix else output_name
                    )
                elif isinstance(output_value, str):
                    self._check_string(
                        value=output_value, variable=f"{prefix}.{output_name}" if prefix else output_name
                    )
                elif isinstance(output_value, list):
                    first_element = output_value[0] if len(output_value) > 0 else None
                    if first_element is not None:
                        if isinstance(first_element, int | float) and all(
                            value is None or isinstance(value, int | float) for value in output_value
                        ):
                            for i, value in enumerate(output_value):
                                self._check_number(
                                    value=value,
                                    variable=f"{prefix}.{output_name}[{i}]" if prefix else f"{output_name}[{i}]",
                                )
                        elif isinstance(first_element, str) and all(
                            value is None or isinstance(value, str) for value in output_value
                        ):
                            for i, value in enumerate(output_value):
                                self._check_string(
                                    value=value,
                                    variable=f"{prefix}.{output_name}[{i}]" if prefix else f"{output_name}[{i}]",
                                )
                        elif (
                            isinstance(first_element, dict)
                            and all(value is None or isinstance(value, dict) for value in output_value)
                            or isinstance(first_element, list)
                            and all(value is None or isinstance(value, list) for value in output_value)
                        ):
                            for i, value in enumerate(output_value):
                                if value is not None:
                                    self._transform_result(
                                        result=value,
                                        output_schema=None,
                                        prefix=f"{prefix}.{output_name}[{i}]" if prefix else f"{output_name}[{i}]",
                                        depth=depth + 1,
                                    )
                        else:
                            raise OutputValidationError(
                                f"Output {prefix}.{output_name} is not a valid array."
                                f" make sure all elements are of the same type."
                            )
                elif output_value is None:
                    pass
                else:
                    raise OutputValidationError(f"Output {prefix}.{output_name} is not a valid type.")

            return result

        parameters_validated = {}
        for output_name, output_config in output_schema.items():
            dot = "." if prefix else ""
            if output_name not in result:
                raise OutputValidationError(f"Output {prefix}{dot}{output_name} is missing.")

            if output_config.type == SegmentType.OBJECT:
                # check if output is object
                if not isinstance(result.get(output_name), dict):
                    if result[output_name] is None:
                        transformed_result[output_name] = None
                    else:
                        raise OutputValidationError(
                            f"Output {prefix}{dot}{output_name} is not an object,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    transformed_result[output_name] = self._transform_result(
                        result=result[output_name],
                        output_schema=output_config.children,
                        prefix=f"{prefix}.{output_name}",
                        depth=depth + 1,
                    )
            elif output_config.type == SegmentType.NUMBER:
                # check if number available
                value = result.get(output_name)
                if value is not None and not isinstance(value, (int, float)):
                    raise OutputValidationError(
                        f"Output {prefix}{dot}{output_name} is not a number,"
                        f" got {type(result.get(output_name))} instead."
                    )
                checked = self._check_number(value=value, variable=f"{prefix}{dot}{output_name}")
                # If the output is a boolean and the output schema specifies a NUMBER type,
                # convert the boolean value to an integer.
                #
                # This ensures compatibility with existing workflows that may use
                # `True` and `False` as values for NUMBER type outputs.
                transformed_result[output_name] = self._convert_boolean_to_int(checked)

            elif output_config.type == SegmentType.STRING:
                # check if string available
                value = result.get(output_name)
                if value is not None and not isinstance(value, str):
                    raise OutputValidationError(
                        f"Output {prefix}{dot}{output_name} must be a string, got {type(value).__name__} instead"
                    )
                transformed_result[output_name] = self._check_string(
                    value=value,
                    variable=f"{prefix}{dot}{output_name}",
                )
            elif output_config.type == SegmentType.BOOLEAN:
                transformed_result[output_name] = self._check_boolean(
                    value=result[output_name],
                    variable=f"{prefix}{dot}{output_name}",
                )
            elif output_config.type == SegmentType.ARRAY_NUMBER:
                # check if array of number available
                value = result[output_name]
                if not isinstance(value, list):
                    if value is None:
                        transformed_result[output_name] = None
                    else:
                        raise OutputValidationError(
                            f"Output {prefix}{dot}{output_name} is not an array, got {type(value)} instead."
                        )
                else:
                    if len(value) > self._limits.max_number_array_length:
                        raise OutputValidationError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {self._limits.max_number_array_length} elements."
                        )

                    for i, inner_value in enumerate(value):
                        if not isinstance(inner_value, (int, float)):
                            raise OutputValidationError(
                                f"The element at index {i} of output variable `{prefix}{dot}{output_name}` must be"
                                f" a number."
                            )
                        _ = self._check_number(value=inner_value, variable=f"{prefix}{dot}{output_name}[{i}]")
                    transformed_result[output_name] = [
                        # If the element is a boolean and the output schema specifies a `array[number]` type,
                        # convert the boolean value to an integer.
                        #
                        # This ensures compatibility with existing workflows that may use
                        # `True` and `False` as values for NUMBER type outputs.
                        self._convert_boolean_to_int(v)
                        for v in value
                    ]
            elif output_config.type == SegmentType.ARRAY_STRING:
                # check if array of string available
                if not isinstance(result[output_name], list):
                    if result[output_name] is None:
                        transformed_result[output_name] = None
                    else:
                        raise OutputValidationError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    if len(result[output_name]) > self._limits.max_string_array_length:
                        raise OutputValidationError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {self._limits.max_string_array_length} elements."
                        )

                    transformed_result[output_name] = [
                        self._check_string(value=value, variable=f"{prefix}{dot}{output_name}[{i}]")
                        for i, value in enumerate(result[output_name])
                    ]
            elif output_config.type == SegmentType.ARRAY_OBJECT:
                # check if array of object available
                if not isinstance(result[output_name], list):
                    if result[output_name] is None:
                        transformed_result[output_name] = None
                    else:
                        raise OutputValidationError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    if len(result[output_name]) > self._limits.max_object_array_length:
                        raise OutputValidationError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {self._limits.max_object_array_length} elements."
                        )

                    for i, value in enumerate(result[output_name]):
                        if not isinstance(value, dict):
                            if value is None:
                                pass
                            else:
                                raise OutputValidationError(
                                    f"Output {prefix}{dot}{output_name}[{i}] is not an object,"
                                    f" got {type(value)} instead at index {i}."
                                )

                    transformed_result[output_name] = [
                        None
                        if value is None
                        else self._transform_result(
                            result=value,
                            output_schema=output_config.children,
                            prefix=f"{prefix}{dot}{output_name}[{i}]",
                            depth=depth + 1,
                        )
                        for i, value in enumerate(result[output_name])
                    ]
            elif output_config.type == SegmentType.ARRAY_BOOLEAN:
                # check if array of object available
                value = result[output_name]
                if not isinstance(value, list):
                    if value is None:
                        transformed_result[output_name] = None
                    else:
                        raise OutputValidationError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    for i, inner_value in enumerate(value):
                        if inner_value is not None and not isinstance(inner_value, bool):
                            raise OutputValidationError(
                                f"Output {prefix}{dot}{output_name}[{i}] is not a boolean,"
                                f" got {type(inner_value)} instead."
                            )
                        _ = self._check_boolean(value=inner_value, variable=f"{prefix}{dot}{output_name}[{i}]")
                    transformed_result[output_name] = value

            else:
                raise OutputValidationError(f"Output type {output_config.type} is not supported.")

            parameters_validated[output_name] = True

        # check if all output parameters are validated
        if len(parameters_validated) != len(result):
            raise CodeNodeError("Not all output parameters are validated.")

        return transformed_result

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config  # Explicitly mark as unused
        # Create typed NodeData from dict
        typed_node_data = CodeNodeData.model_validate(node_data)

        return {
            node_id + "." + variable_selector.variable: variable_selector.value_selector
            for variable_selector in typed_node_data.variables
        }

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled

    @staticmethod
    def _convert_boolean_to_int(value: bool | int | float | None) -> int | float | None:
        """This function convert boolean to integers when the output schema specifies a NUMBER type.

        This ensures compatibility with existing workflows that may use
        `True` and `False` as values for NUMBER type outputs.
        """
        if value is None:
            return None
        if isinstance(value, bool):
            return int(value)
        return value
