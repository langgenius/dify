from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from dify_graph.entities.graph_config import NodeConfigDict
from dify_graph.enums import BuiltinNodeTypes, SystemVariableKey, WorkflowNodeExecutionStatus
from dify_graph.node_events import NodeEventBase, NodeRunResult, StreamCompletedEvent
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.base.variable_template_parser import VariableTemplateParser

from .entities import AgentNodeData
from .exceptions import (
    AgentInvocationError,
    AgentMessageTransformError,
)
from .message_transformer import AgentMessageTransformer
from .runtime_support import AgentRuntimeSupport
from .strategy_protocols import AgentStrategyPresentationProvider, AgentStrategyResolver

if TYPE_CHECKING:
    from dify_graph.entities import GraphInitParams
    from dify_graph.runtime import GraphRuntimeState


class AgentNode(Node[AgentNodeData]):
    node_type = BuiltinNodeTypes.AGENT

    _strategy_resolver: AgentStrategyResolver
    _presentation_provider: AgentStrategyPresentationProvider
    _runtime_support: AgentRuntimeSupport
    _message_transformer: AgentMessageTransformer

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        *,
        strategy_resolver: AgentStrategyResolver,
        presentation_provider: AgentStrategyPresentationProvider,
        runtime_support: AgentRuntimeSupport,
        message_transformer: AgentMessageTransformer,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._strategy_resolver = strategy_resolver
        self._presentation_provider = presentation_provider
        self._runtime_support = runtime_support
        self._message_transformer = message_transformer

    @classmethod
    def version(cls) -> str:
        return "1"

    def populate_start_event(self, event) -> None:
        dify_ctx = self.require_dify_context()
        event.extras["agent_strategy"] = {
            "name": self.node_data.agent_strategy_name,
            "icon": self._presentation_provider.get_icon(
                tenant_id=dify_ctx.tenant_id,
                agent_strategy_provider_name=self.node_data.agent_strategy_provider_name,
            ),
        }

    def _run(self) -> Generator[NodeEventBase, None, None]:
        from core.plugin.impl.exc import PluginDaemonClientSideError

        dify_ctx = self.require_dify_context()

        try:
            strategy = self._strategy_resolver.resolve(
                tenant_id=dify_ctx.tenant_id,
                agent_strategy_provider_name=self.node_data.agent_strategy_provider_name,
                agent_strategy_name=self.node_data.agent_strategy_name,
            )
        except Exception as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=f"Failed to get agent strategy: {str(e)}",
                ),
            )
            return

        agent_parameters = strategy.get_parameters()

        parameters = self._runtime_support.build_parameters(
            agent_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            strategy=strategy,
            tenant_id=dify_ctx.tenant_id,
            app_id=dify_ctx.app_id,
            invoke_from=dify_ctx.invoke_from,
        )
        parameters_for_log = self._runtime_support.build_parameters(
            agent_parameters=agent_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            strategy=strategy,
            tenant_id=dify_ctx.tenant_id,
            app_id=dify_ctx.app_id,
            invoke_from=dify_ctx.invoke_from,
            for_log=True,
        )
        credentials = self._runtime_support.build_credentials(parameters=parameters)

        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])

        try:
            message_stream = strategy.invoke(
                params=parameters,
                user_id=dify_ctx.user_id,
                app_id=dify_ctx.app_id,
                conversation_id=conversation_id.text if conversation_id else None,
                credentials=credentials,
            )
        except Exception as e:
            error = AgentInvocationError(f"Failed to invoke agent: {str(e)}", original_error=e)
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    error=str(error),
                )
            )
            return

        try:
            yield from self._message_transformer.transform(
                messages=message_stream,
                tool_info={
                    "icon": self._presentation_provider.get_icon(
                        tenant_id=dify_ctx.tenant_id,
                        agent_strategy_provider_name=self.node_data.agent_strategy_provider_name,
                    ),
                    "agent_strategy": self.node_data.agent_strategy_name,
                },
                parameters_for_log=parameters_for_log,
                user_id=dify_ctx.user_id,
                tenant_id=dify_ctx.tenant_id,
                node_type=self.node_type,
                node_id=self._node_id,
                node_execution_id=self.id,
            )
        except PluginDaemonClientSideError as e:
            transform_error = AgentMessageTransformError(
                f"Failed to transform agent message: {str(e)}", original_error=e
            )
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    error=str(transform_error),
                )
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: AgentNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config  # Explicitly mark as unused
        result: dict[str, Any] = {}
        typed_node_data = node_data
        for parameter_name in typed_node_data.agent_parameters:
            input = typed_node_data.agent_parameters[parameter_name]
            match input.type:
                case "mixed" | "constant":
                    selectors = VariableTemplateParser(str(input.value)).extract_variable_selectors()
                    for selector in selectors:
                        result[selector.variable] = selector.value_selector
                case "variable":
                    result[parameter_name] = input.value

        result = {node_id + "." + key: value for key, value in result.items()}

        return result
