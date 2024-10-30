from collections.abc import Mapping, Sequence
from typing import Any, Optional, Union

from configs import dify_config
from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.helper.code_executor.javascript.javascript_code_provider import JavascriptCodeProvider
from core.helper.code_executor.python3.python3_code_provider import Python3CodeProvider
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.code.entities import CodeNodeData
from core.workflow.nodes.enums import NodeType
from models.workflow import WorkflowNodeExecutionStatus


class CodeNode(BaseNode[CodeNodeData]):
    _node_data_cls = CodeNodeData
    _node_type = NodeType.CODE

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        code_language = CodeLanguage.PYTHON3
        if filters:
            code_language = filters.get("code_language", CodeLanguage.PYTHON3)

        providers: list[type[CodeNodeProvider]] = [Python3CodeProvider, JavascriptCodeProvider]
        code_provider: type[CodeNodeProvider] = next(p for p in providers if p.is_accept_language(code_language))

        return code_provider.get_default_config()

    def _run(self) -> NodeRunResult:
        # Get code language
        code_language = self.node_data.code_language
        code = self.node_data.code

        # Get variables
        variables = {}
        for variable_selector in self.node_data.variables:
            variable_name = variable_selector.variable
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            if variable is None:
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=variables,
                    error=f"Variable `{variable_selector.value_selector}` not found",
                )
            variables[variable_name] = variable.to_object()
        # Run code
        try:
            result = CodeExecutor.execute_workflow_code_template(
                language=code_language,
                code=code,
                inputs=variables,
            )

            # Transform result
            result = self._transform_result(result, self.node_data.outputs)
        except (CodeExecutionError, ValueError) as e:
            return NodeRunResult(status=WorkflowNodeExecutionStatus.FAILED, inputs=variables, error=str(e))

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs=result)

    def _check_string(self, value: str, variable: str) -> str:
        """
        Check string
        :param value: value
        :param variable: variable
        :return:
        """
        if not isinstance(value, str):
            if value is None:
                return None
            else:
                raise ValueError(f"Output variable `{variable}` must be a string")

        if len(value) > dify_config.CODE_MAX_STRING_LENGTH:
            raise ValueError(
                f"The length of output variable `{variable}` must be"
                f" less than {dify_config.CODE_MAX_STRING_LENGTH} characters"
            )

        return value.replace("\x00", "")

    def _check_number(self, value: Union[int, float], variable: str) -> Union[int, float]:
        """
        Check number
        :param value: value
        :param variable: variable
        :return:
        """
        if not isinstance(value, int | float):
            if value is None:
                return None
            else:
                raise ValueError(f"Output variable `{variable}` must be a number")

        if value > dify_config.CODE_MAX_NUMBER or value < dify_config.CODE_MIN_NUMBER:
            raise ValueError(
                f"Output variable `{variable}` is out of range,"
                f" it must be between {dify_config.CODE_MIN_NUMBER} and {dify_config.CODE_MAX_NUMBER}."
            )

        if isinstance(value, float):
            # raise error if precision is too high
            if len(str(value).split(".")[1]) > dify_config.CODE_MAX_PRECISION:
                raise ValueError(
                    f"Output variable `{variable}` has too high precision,"
                    f" it must be less than {dify_config.CODE_MAX_PRECISION} digits."
                )

        return value

    def _transform_result(
        self, result: dict, output_schema: Optional[dict[str, CodeNodeData.Output]], prefix: str = "", depth: int = 1
    ) -> dict:
        """
        Transform result
        :param result: result
        :param output_schema: output schema
        :return:
        """
        if depth > dify_config.CODE_MAX_DEPTH:
            raise ValueError(f"Depth limit ${dify_config.CODE_MAX_DEPTH} reached, object too deep.")

        transformed_result = {}
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
                        elif isinstance(first_element, dict) and all(
                            value is None or isinstance(value, dict) for value in output_value
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
                            raise ValueError(
                                f"Output {prefix}.{output_name} is not a valid array."
                                f" make sure all elements are of the same type."
                            )
                elif output_value is None:
                    pass
                else:
                    raise ValueError(f"Output {prefix}.{output_name} is not a valid type.")

            return result

        parameters_validated = {}
        for output_name, output_config in output_schema.items():
            dot = "." if prefix else ""
            if output_name not in result:
                raise ValueError(f"Output {prefix}{dot}{output_name} is missing.")

            if output_config.type == "object":
                # check if output is object
                if not isinstance(result.get(output_name), dict):
                    if isinstance(result.get(output_name), type(None)):
                        transformed_result[output_name] = None
                    else:
                        raise ValueError(
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
            elif output_config.type == "number":
                # check if number available
                transformed_result[output_name] = self._check_number(
                    value=result[output_name], variable=f"{prefix}{dot}{output_name}"
                )
            elif output_config.type == "string":
                # check if string available
                transformed_result[output_name] = self._check_string(
                    value=result[output_name],
                    variable=f"{prefix}{dot}{output_name}",
                )
            elif output_config.type == "array[number]":
                # check if array of number available
                if not isinstance(result[output_name], list):
                    if isinstance(result[output_name], type(None)):
                        transformed_result[output_name] = None
                    else:
                        raise ValueError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    if len(result[output_name]) > dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH:
                        raise ValueError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH} elements."
                        )

                    transformed_result[output_name] = [
                        self._check_number(value=value, variable=f"{prefix}{dot}{output_name}[{i}]")
                        for i, value in enumerate(result[output_name])
                    ]
            elif output_config.type == "array[string]":
                # check if array of string available
                if not isinstance(result[output_name], list):
                    if isinstance(result[output_name], type(None)):
                        transformed_result[output_name] = None
                    else:
                        raise ValueError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    if len(result[output_name]) > dify_config.CODE_MAX_STRING_ARRAY_LENGTH:
                        raise ValueError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {dify_config.CODE_MAX_STRING_ARRAY_LENGTH} elements."
                        )

                    transformed_result[output_name] = [
                        self._check_string(value=value, variable=f"{prefix}{dot}{output_name}[{i}]")
                        for i, value in enumerate(result[output_name])
                    ]
            elif output_config.type == "array[object]":
                # check if array of object available
                if not isinstance(result[output_name], list):
                    if isinstance(result[output_name], type(None)):
                        transformed_result[output_name] = None
                    else:
                        raise ValueError(
                            f"Output {prefix}{dot}{output_name} is not an array,"
                            f" got {type(result.get(output_name))} instead."
                        )
                else:
                    if len(result[output_name]) > dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH:
                        raise ValueError(
                            f"The length of output variable `{prefix}{dot}{output_name}` must be"
                            f" less than {dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH} elements."
                        )

                    for i, value in enumerate(result[output_name]):
                        if not isinstance(value, dict):
                            if value is None:
                                pass
                            else:
                                raise ValueError(
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
            else:
                raise ValueError(f"Output type {output_config.type} is not supported.")

            parameters_validated[output_name] = True

        # check if all output parameters are validated
        if len(parameters_validated) != len(result):
            raise ValueError("Not all output parameters are validated.")

        return transformed_result

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: CodeNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        return {
            node_id + "." + variable_selector.variable: variable_selector.value_selector
            for variable_selector in node_data.variables
        }
