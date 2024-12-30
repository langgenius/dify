from collections.abc import Generator, Sequence
from typing import Any, cast

from core.agent.plugin_entities import AgentStrategyParameter
from core.plugin.manager.exc import PluginDaemonClientSideError
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
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
            agent_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=node_data,
        )
        parameters_for_log = self._generate_parameters(
            agent_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=node_data,
            for_log=True,
        )

        # get conversation id
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])

        try:
            message_stream = strategy.invoke(
                params=parameters,
                user_id=self.user_id,
                app_id=self.app_id,
                conversation_id=conversation_id.text if conversation_id else None,
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

    def _generate_parameters(
        self,
        *,
        agent_parameters: Sequence[AgentStrategyParameter],
        variable_pool: VariablePool,
        node_data: AgentNodeData,
        for_log: bool = False,
    ) -> dict[str, Any]:
        """
        Generate parameters based on the given tool parameters, variable pool, and node data.

        Args:
            agent_parameters (Sequence[AgentParameter]): The list of agent parameters.
            variable_pool (VariablePool): The variable pool containing the variables.
            node_data (AgentNodeData): The data associated with the agent node.

        Returns:
            Mapping[str, Any]: A dictionary containing the generated parameters.

        """
        agent_parameters_dictionary = {parameter.name: parameter for parameter in agent_parameters}

        result = {}
        for parameter_name in node_data.agent_parameters:
            parameter = agent_parameters_dictionary.get(parameter_name)
            if not parameter:
                result[parameter_name] = None
                continue
            agent_input = node_data.agent_parameters[parameter_name]
            if agent_input.type == "variable":
                variable = variable_pool.get(agent_input.value)  # type: ignore
                if variable is None:
                    raise ValueError(f"Variable {agent_input.value} does not exist")
                parameter_value = variable.value
            elif agent_input.type in {"mixed", "constant"}:
                segment_group = variable_pool.convert_template(str(agent_input.value))
                parameter_value = segment_group.log if for_log else segment_group.text
            else:
                raise ValueError(f"Unknown agent input type '{agent_input.type}'")
            result[parameter_name] = parameter_value

        return result
