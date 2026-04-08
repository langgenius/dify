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

from graphon.enums import WorkflowNodeExecutionStatus
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
    ModelInvokeCompletedEvent,
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
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._tool_manager = tool_manager
        self._event_adapter = event_adapter

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
                user=dify_ctx.user_id,
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
                    yield StreamChunkEvent(
                        selector=[self._node_id, "text"],
                        chunk=chunk_text,
                    )

                if chunk.delta.usage:
                    usage = chunk.delta.usage
                if chunk.delta.finish_reason:
                    finish_reason = chunk.delta.finish_reason

            if self.node_data.reasoning_format == "separated":
                full_text, reasoning_content = self._separate_reasoning(full_text)

            if usage:
                yield ModelInvokeCompletedEvent(
                    text=full_text,
                    usage=usage,
                    finish_reason=finish_reason,
                    reasoning_content=reasoning_content or None,
                )

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs={"prompt_messages": [m.model_dump() for m in prompt_messages]},
                    outputs={
                        "text": full_text,
                        "reasoning_content": reasoning_content,
                        "usage": usage.model_dump() if usage else {},
                        "finish_reason": finish_reason or "stop",
                    },
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
                tool_invoke_hook=self._tool_manager.create_workflow_tool_invoke_hook(context),
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

            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs={"prompt_messages": [m.model_dump() for m in prompt_messages]},
                    outputs={
                        "text": result.text,
                        "files": [f.model_dump() if hasattr(f, "model_dump") else str(f) for f in result.files],
                        "usage": result.usage.model_dump() if hasattr(result.usage, "model_dump") else {},
                        "finish_reason": result.finish_reason or "stop",
                    },
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
        model_instance = ModelManager().get_model_instance(
            tenant_id=dify_ctx.tenant_id,
            provider=model_config.provider,
            model_type=ModelType.LLM,
            model=model_config.name,
        )
        return model_instance

    def _build_prompt_messages(self, dify_ctx: DifyRunContext) -> list[PromptMessage]:
        """Build prompt messages from the node's prompt_template, resolving variables."""
        variable_pool = self.graph_runtime_state.variable_pool
        messages: list[PromptMessage] = []

        template = self.node_data.prompt_template
        if isinstance(template, Sequence) and not isinstance(template, str):
            for msg_template in template:
                role = msg_template.role.value if hasattr(msg_template.role, "value") else str(msg_template.role)
                text = msg_template.text or ""
                jinja2_text = getattr(msg_template, "jinja2_text", None)
                content = jinja2_text or text

                resolved = VariableTemplateParser.resolve_template(content, variable_pool)

                if role == "system":
                    messages.append(SystemPromptMessage(content=resolved))
                elif role == "user":
                    messages.append(UserPromptMessage(content=resolved))
                elif role == "assistant":
                    messages.append(AssistantPromptMessage(content=resolved))
        else:
            text_content = getattr(template, "text", "") or ""
            resolved = VariableTemplateParser.resolve_template(text_content, variable_pool)
            messages.append(UserPromptMessage(content=resolved))

        return messages

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
