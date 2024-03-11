from typing import cast

from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.http_request.entities import HttpRequestNodeData
from core.workflow.nodes.http_request.http_executor import HttpExecutor
from models.workflow import WorkflowNodeExecutionStatus


class HttpRequestNode(BaseNode):
    _node_data_cls = HttpRequestNodeData
    node_type = NodeType.HTTP_REQUEST

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        node_data: HttpRequestNodeData = cast(self._node_data_cls, self.node_data)

        # extract variables
        variables = {
            variable_selector.variable: variable_pool.get_variable_value(variable_selector=variable_selector.value_selector)
            for variable_selector in node_data.variables
        }

        # init http executor
        try:
            http_executor = HttpExecutor(node_data=node_data, variables=variables)

            # invoke http executor
            response = http_executor.invoke()
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=variables,
                error=str(e),
                process_data={
                    'request': http_executor.to_raw_request()
                }
            )

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=variables,
            outputs={
                'status_code': response.status_code,
                'body': response,
                'headers': response.headers
            },
            process_data={
                'request': http_executor.to_raw_request(),
            }
        )


    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: HttpRequestNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {
            variable_selector.variable: variable_selector.value_selector for variable_selector in node_data.variables
        }
