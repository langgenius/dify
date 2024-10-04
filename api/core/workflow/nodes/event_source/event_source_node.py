import os
import time
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Optional, cast

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.graph_engine.entities.event import InNodeEvent
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.event import RunCompletedEvent, RunEvent, RunEventSourceNodeEvent
from core.workflow.nodes.event_source.entities import EventSourceNodeData
from models.workflow import WorkflowNodeExecutionStatus

MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH = int(os.environ.get("TEMPLATE_TRANSFORM_MAX_LENGTH", "80000"))


class EventSourceNode(BaseNode):
    _node_data_cls = EventSourceNodeData
    _node_type = NodeType.EVENT_SOURCE

    @classmethod
    def get_default_config(cls, filters: Optional[dict] = None) -> dict:
        """
        Get default config of node.
        :param filters: filter by node config parameters.
        :return:
        """
        return {
            "type": "event-source",
            "config": {
                "variables": [],
                "template": "Lorem ipsum dolor sit amet, consectetur adipiscing elit, ..."
            },
        }

    def _run(self) -> Generator[RunEvent | InNodeEvent, None, None]:
        """
        Run node
        """
        node_data = self.node_data
        node_data: EventSourceNodeData = cast(self._node_data_cls, node_data)

        # Get variables
        variables = {}
        for variable_selector in node_data.variables:
            variable_name = variable_selector.variable
            value = self.graph_runtime_state.variable_pool.get_any(variable_selector.value_selector)
            variables[variable_name] = value
        # Run code
        try:
            result = CodeExecutor.execute_workflow_code_template(
                language=CodeLanguage.JINJA2, code=node_data.template, inputs=variables
            )
            n = 5
            for i in range(0, len(result["result"]), n):
                text = result["result"][i : i + n]
                yield RunEventSourceNodeEvent(chunk_content=text, from_variable_selector=[self.node_id, "text"])
                time.sleep(0.1)

        except CodeExecutionError as e:
            run_result = NodeRunResult(inputs=variables, status=WorkflowNodeExecutionStatus.FAILED, error=str(e))
            yield RunCompletedEvent(run_result=run_result)

        if len(result["result"]) > MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH:
            run_result = NodeRunResult(
                inputs=variables,
                status=WorkflowNodeExecutionStatus.FAILED,
                error=f"Output length exceeds {MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH} characters",
            )
            yield RunCompletedEvent(run_result=run_result)

        run_result = NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=variables, outputs={"output": result["result"]}
        )
        yield RunCompletedEvent(run_result=run_result)

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: EventSourceNodeData
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
