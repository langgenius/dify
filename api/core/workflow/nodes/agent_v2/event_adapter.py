"""Event adapter for Agent V2 Node.

Converts AgentPattern outputs (LLMResultChunk | AgentLog) into
graphon NodeEventBase events consumable by the workflow engine.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from graphon.model_runtime.entities import LLMResultChunk
from graphon.node_events import (
    AgentLogEvent,
    NodeEventBase,
    StreamChunkEvent,
)

from core.agent.entities import AgentLog, AgentResult


class AgentV2EventAdapter:
    """Converts agent strategy outputs into workflow node events."""

    def process_strategy_outputs(
        self,
        outputs: Generator[LLMResultChunk | AgentLog, None, AgentResult],
        *,
        node_id: str,
        node_execution_id: str,
    ) -> Generator[NodeEventBase, None, AgentResult]:
        """Process strategy generator outputs, yielding node events.

        Returns the final AgentResult from the strategy.
        """
        try:
            while True:
                item = next(outputs)
                if isinstance(item, AgentLog):
                    yield self._convert_agent_log(item, node_id=node_id, node_execution_id=node_execution_id)
                elif isinstance(item, LLMResultChunk):
                    yield from self._convert_llm_chunk(item, node_id=node_id)
        except StopIteration as e:
            result: AgentResult = e.value
            return result

    def _convert_agent_log(
        self,
        log: AgentLog,
        *,
        node_id: str,
        node_execution_id: str,
    ) -> AgentLogEvent:
        return AgentLogEvent(
            message_id=log.id,
            label=log.label,
            node_execution_id=node_execution_id,
            parent_id=log.parent_id,
            error=log.error,
            status=log.status.value,
            data=dict(log.data),
            metadata={k.value if hasattr(k, "value") else str(k): v for k, v in log.metadata.items()},
            node_id=node_id,
        )

    def _convert_llm_chunk(
        self,
        chunk: LLMResultChunk,
        *,
        node_id: str,
    ) -> Generator[NodeEventBase, None, None]:
        content = ""
        if chunk.delta.message and chunk.delta.message.content:
            if isinstance(chunk.delta.message.content, str):
                content = chunk.delta.message.content
            elif isinstance(chunk.delta.message.content, list):
                from graphon.model_runtime.entities.message_entities import TextPromptMessageContent

                for item in chunk.delta.message.content:
                    if isinstance(item, TextPromptMessageContent):
                        content += item.data

        if content:
            yield StreamChunkEvent(
                selector=[node_id, "text"],
                chunk=content,
            )
