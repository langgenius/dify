"""Agent V2 Workflow Node.

A unified workflow node that combines LLM capabilities with agent tool-calling.
When tools are configured, runs an FC/ReAct loop via StrategyFactory.
When no tools are present, behaves as a single-shot LLM invocation.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, cast

from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import (
    ImagePromptMessageContent,
    PromptMessageContentUnionTypes,
)
from graphon.model_runtime.entities.model_entities import ModelFeature, ModelType
from graphon.node_events import (
    NodeEventBase,
    NodeRunResult,
    StreamChunkEvent,
    StreamCompletedEvent,
)
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser

from core.agent.entities import AgentEntity, ExecutionContext
from core.agent.patterns import StrategyFactory
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.model_manager import ModelInstance, ModelManager
from core.workflow.system_variables import SystemVariableKey, get_system_text

from .entities import AGENT_V2_NODE_TYPE, AgentV2NodeData
from .event_adapter import AgentV2EventAdapter
from .tool_manager import AgentV2ToolManager

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.entities.graph_config import NodeConfigDict
    from graphon.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)

_THINK_PATTERN = re.compile(r"<think[^>]*>(.*?)</think>", re.IGNORECASE | re.DOTALL)


class AgentV2Node(Node[AgentV2NodeData]):
    node_type = AGENT_V2_NODE_TYPE

    _tool_manager: AgentV2ToolManager
    _event_adapter: AgentV2EventAdapter

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        *,
        tool_manager: AgentV2ToolManager,
        event_adapter: AgentV2EventAdapter,
        sandbox: Any | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._tool_manager = tool_manager
        self._event_adapter = event_adapter
        self._sandbox = sandbox

    @classmethod
    def version(cls) -> str:
        return "1"

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        return {
            "type": AGENT_V2_NODE_TYPE,
            "config": {
                "prompt_templates": {
                    "chat_model": {
                        "prompts": [
                            {
                                "role": "system",
                                "text": "You are a helpful AI assistant.",
                                "edition_type": "basic",
                            }
                        ]
                    },
                    "completion_model": {
                        "conversation_histories_role": {
                            "user_prefix": "Human",
                            "assistant_prefix": "Assistant",
                        },
                        "prompt": {
                            "text": "{{#sys.query#}}",
                            "edition_type": "basic",
                        },
                    },
                },
                "agent_strategy": "auto",
                "max_iterations": 10,
            },
        }

    def _run(self) -> Generator[NodeEventBase, None, None]:
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))

        try:
            model_instance = self._fetch_model_instance(dify_ctx)
        except Exception as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=f"Failed to load model: {e}",
                )
            )
            return

        prompt_messages = self._build_prompt_messages(dify_ctx)

        if self.node_data.tool_call_enabled:
            yield from self._run_with_tools(model_instance, prompt_messages, dify_ctx)
        else:
            yield from self._run_without_tools(model_instance, prompt_messages, dify_ctx)

    # ------------------------------------------------------------------
    # No-tools path: single LLM invocation (LLM Node equivalent)
    # ------------------------------------------------------------------

    def _run_without_tools(
        self,
        model_instance: ModelInstance,
        prompt_messages: list[PromptMessage],
        dify_ctx: DifyRunContext,
    ) -> Generator[NodeEventBase, None, None]:
        try:
            result_chunks: Generator[LLMResultChunk, None, None] = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters=self.node_data.model.completion_params,
                tools=[],
                stop=[],
                stream=True,
                callbacks=[],
            )

            full_text = ""
            reasoning_content = ""
            usage: LLMUsage | None = None
            finish_reason: str | None = None

            for chunk in result_chunks:
                chunk_text = self._extract_chunk_text(chunk)
                if chunk_text:
                    full_text += chunk_text

                if chunk.delta.usage:
                    usage = chunk.delta.usage
                if chunk.delta.finish_reason:
                    finish_reason = chunk.delta.finish_reason

            if self.node_data.reasoning_format == "separated":
                full_text, reasoning_content = self._separate_reasoning(full_text)

            metadata = {}
            if usage:
                metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = usage.total_tokens
                metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = usage.total_price
                metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] = usage.currency
                self.graph_runtime_state.add_tokens(usage.total_tokens)

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs={},
                    outputs={
                        "text": full_text,
                        "reasoning_content": reasoning_content,
                        "finish_reason": finish_reason or "stop",
                    },
                    metadata=metadata,
                )
            )
        except Exception as e:
            logger.exception("Agent V2 LLM invocation failed")
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=str(e),
                )
            )

    # ------------------------------------------------------------------
    # Tools path: agent loop via StrategyFactory
    # ------------------------------------------------------------------

    def _run_with_tools(
        self,
        model_instance: ModelInstance,
        prompt_messages: list[PromptMessage],
        dify_ctx: DifyRunContext,
    ) -> Generator[NodeEventBase, None, None]:
        try:
            tool_instances = self._tool_manager.prepare_tool_instances(
                list(self.node_data.tools),
            )

            model_features = self._get_model_features(model_instance)

            context = ExecutionContext(
                user_id=dify_ctx.user_id,
                app_id=dify_ctx.app_id,
                tenant_id=dify_ctx.tenant_id,
                conversation_id=get_system_text(
                    self.graph_runtime_state.variable_pool,
                    SystemVariableKey.CONVERSATION_ID,
                ),
            )

            agent_strategy_enum = self._map_strategy_config(self.node_data.agent_strategy)

            strategy = StrategyFactory.create_strategy(
                model_features=model_features,
                model_instance=model_instance,
                tools=tool_instances,
                files=[],
                max_iterations=self.node_data.max_iterations,
                context=context,
                agent_strategy=agent_strategy_enum,
                tool_invoke_hook=self._tool_manager.create_workflow_tool_invoke_hook(
                    context, sandbox=self._sandbox
                ),
            )

            outputs_gen = strategy.run(
                prompt_messages=prompt_messages,
                model_parameters=self.node_data.model.completion_params,
                stop=[],
                stream=True,
            )

            result = yield from self._event_adapter.process_strategy_outputs(
                outputs_gen,
                node_id=self._node_id,
                node_execution_id=self.id,
            )

            if result.usage and hasattr(result.usage, "total_tokens"):
                self.graph_runtime_state.add_tokens(result.usage.total_tokens)

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs={},
                    outputs={
                        "text": result.text,
                        "finish_reason": result.finish_reason or "stop",
                    },
                    metadata=self._build_usage_metadata(result.usage),
                )
            )
        except Exception as e:
            logger.exception("Agent V2 tool execution failed")
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    error=str(e),
                )
            )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _fetch_model_instance(self, dify_ctx: DifyRunContext) -> ModelInstance:
        model_config = self.node_data.model
        model_manager = ModelManager.for_tenant(tenant_id=dify_ctx.tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=dify_ctx.tenant_id,
            provider=model_config.provider,
            model_type=ModelType.LLM,
            model=model_config.name,
        )
        return model_instance

    def _build_prompt_messages(self, dify_ctx: DifyRunContext) -> list[PromptMessage]:
        """Build prompt messages from the node's prompt_template, resolving variables.

        If the node has memory config and a conversation_id exists, conversation
        history is loaded and inserted between system and user messages.
        """
        variable_pool = self.graph_runtime_state.variable_pool
        messages: list[PromptMessage] = []

        template = self.node_data.prompt_template
        if isinstance(template, Sequence) and not isinstance(template, str):
            for msg_template in template:
                role = msg_template.role.value if hasattr(msg_template.role, "value") else str(msg_template.role)
                text = msg_template.text or ""
                jinja2_text = getattr(msg_template, "jinja2_text", None)
                content = jinja2_text or text

                resolved = self._resolve_variable_template(content, variable_pool)

                if role == "system":
                    messages.append(SystemPromptMessage(content=resolved))
                elif role == "user":
                    messages.append(UserPromptMessage(content=resolved))
                elif role == "assistant":
                    messages.append(AssistantPromptMessage(content=resolved))
        else:
            text_content = getattr(template, "text", "") or ""
            resolved = self._resolve_variable_template(text_content, variable_pool)
            messages.append(UserPromptMessage(content=resolved))

        if self.node_data.memory:
            history = self._load_memory_messages(dify_ctx)
            if history:
                system_msgs = [m for m in messages if isinstance(m, SystemPromptMessage)]
                other_msgs = [m for m in messages if not isinstance(m, SystemPromptMessage)]
                messages = system_msgs + history + other_msgs

        return messages

    def _load_memory_messages(self, dify_ctx: DifyRunContext) -> list[PromptMessage]:
        """Load conversation history from memory."""
        from core.memory.token_buffer_memory import TokenBufferMemory
        from models.model import Conversation

        conversation_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.CONVERSATION_ID,
        )
        if not conversation_id:
            return []

        try:
            from sqlalchemy import select
            from extensions.ext_database import db

            stmt = select(Conversation).where(Conversation.id == conversation_id)
            conversation = db.session.scalar(stmt)
            if not conversation:
                return []

            model_instance = self._fetch_model_instance(dify_ctx)
            memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

            window_size = None
            if self.node_data.memory and hasattr(self.node_data.memory, "window"):
                window = self.node_data.memory.window
                if window and window.enabled:
                    window_size = window.size

            history = memory.get_history_prompt_messages(
                max_token_limit=2000,
                message_limit=window_size or 50,
            )
            return list(history)
        except Exception:
            logger.warning("Failed to load memory for agent-v2 node", exc_info=True)
            return []

    @staticmethod
    def _resolve_variable_template(template: str, variable_pool: Any) -> str:
        """Resolve {{#node.var#}} references in a template string using the variable pool."""
        parser = VariableTemplateParser(template)
        selectors = parser.extract_variable_selectors()
        if not selectors:
            return template

        inputs: dict[str, Any] = {}
        for selector in selectors:
            value = variable_pool.get(selector.value_selector)
            if value is not None:
                inputs[selector.variable] = value.text if hasattr(value, "text") else str(value)
            else:
                inputs[selector.variable] = ""

        return parser.format(inputs)

    def _get_model_features(self, model_instance: ModelInstance) -> list[ModelFeature]:
        try:
            model_schema = model_instance.model_type_instance.get_model_schema(
                model_instance.model_name,
                model_instance.credentials,
            )
            return list(model_schema.features) if model_schema and model_schema.features else []
        except Exception:
            logger.warning("Failed to get model features, assuming none")
            return []

    @staticmethod
    def _build_usage_metadata(usage: Any) -> dict:
        metadata: dict = {}
        if usage and hasattr(usage, "total_tokens"):
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = usage.total_tokens
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = usage.total_price
            metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] = getattr(usage, "currency", "USD")
        return metadata

    @staticmethod
    def _map_strategy_config(
        config_value: Literal["auto", "function-calling", "chain-of-thought"],
    ) -> AgentEntity.Strategy | None:
        mapping = {
            "function-calling": AgentEntity.Strategy.FUNCTION_CALLING,
            "chain-of-thought": AgentEntity.Strategy.CHAIN_OF_THOUGHT,
        }
        return mapping.get(config_value)

    @staticmethod
    def _extract_chunk_text(chunk: LLMResultChunk) -> str:
        if not chunk.delta.message or not chunk.delta.message.content:
            return ""
        content = chunk.delta.message.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, TextPromptMessageContent):
                    parts.append(item.data)
            return "".join(parts)
        return ""

    @staticmethod
    def _separate_reasoning(text: str) -> tuple[str, str]:
        """Extract <think> blocks from text, return (clean_text, reasoning_content)."""
        reasoning_parts = _THINK_PATTERN.findall(text)
        reasoning_content = "\n".join(reasoning_parts)
        clean_text = _THINK_PATTERN.sub("", text).strip()
        return clean_text, reasoning_content

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: AgentV2NodeData,
    ) -> Mapping[str, Sequence[str]]:
        result: dict[str, list[str]] = {}

        if isinstance(node_data.prompt_template, Sequence) and not isinstance(node_data.prompt_template, str):
            for msg in node_data.prompt_template:
                text = msg.text or ""
                jinja2_text = getattr(msg, "jinja2_text", None)
                content = jinja2_text or text
                selectors = VariableTemplateParser(content).extract_variable_selectors()
                for selector in selectors:
                    result[selector.variable] = selector.value_selector
        else:
            text_content = getattr(node_data.prompt_template, "text", "") or ""
            selectors = VariableTemplateParser(text_content).extract_variable_selectors()
            for selector in selectors:
                result[selector.variable] = selector.value_selector

        return {f"{node_id}.{key}": value for key, value in result.items()}
