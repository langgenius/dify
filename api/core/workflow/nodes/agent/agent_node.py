from collections.abc import Generator
from typing import cast
from core.plugin.manager.exc import PluginDaemonClientSideError
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event.event import RunCompletedEvent
from core.workflow.nodes.tool.tool_node import ToolNode
from factories.agent_factory import get_plugin_agent_strategy
from models.workflow import WorkflowNodeExecutionStatus


class AgentNode(ToolNode):
    """
    Agent Node
    """

    _node_data_cls = AgentNodeData
    _node_type = NodeType.AGENT

    def _run(self) -> Generator:
        """
        Run the agent node
        """
        node_data = cast(AgentNodeData, self.node_data)

        try:
            strategy = get_plugin_agent_strategy(
                tenant_id=self.tenant_id,
                plugin_unique_identifier=node_data.plugin_unique_identifier,
                agent_strategy_provider_name=node_data.agent_strategy_provider_name,
                agent_strategy_name=node_data.agent_strategy_name,
            )
        except Exception as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=f"Failed to get agent strategy: {str(e)}",
                )
            )
            return

        agent_parameters = strategy.get_parameters()

        # get parameters
        parameters = self._generate_parameters(
            tool_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            tool_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )

        try:
            message_stream = strategy.invoke(
                params=parameters,
                user_id=self.user_id,
                app_id=self.app_id,
                # TODO: conversation id and message id
            )
        except Exception as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    error=f"Failed to invoke agent: {str(e)}",
                )
            )

        try:
            # convert tool messages
            yield from self._transform_message(message_stream, {}, parameters_for_log)
        except PluginDaemonClientSideError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    error=f"Failed to transform agent message: {str(e)}",
                )
            )
