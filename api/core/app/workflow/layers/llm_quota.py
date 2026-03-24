"""
LLM quota deduction layer for GraphEngine.

This layer centralizes model-quota deduction outside node implementations.
"""

import logging
from typing import final

from typing_extensions import override

from core.app.llm import deduct_llm_quota, ensure_llm_quota_available
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance
from dify_graph.enums import BuiltinNodeTypes
from dify_graph.graph_engine.entities.commands import AbortCommand, CommandType
from dify_graph.graph_engine.layers.base import GraphEngineLayer
from dify_graph.graph_events import GraphEngineEvent, GraphNodeEventBase
from dify_graph.graph_events.node import NodeRunSucceededEvent
from dify_graph.nodes.base.node import Node

logger = logging.getLogger(__name__)

_LLM_LIKE_NODE_TYPES = {
    BuiltinNodeTypes.LLM,
    BuiltinNodeTypes.PARAMETER_EXTRACTOR,
    BuiltinNodeTypes.QUESTION_CLASSIFIER,
}


@final
class LLMQuotaLayer(GraphEngineLayer):
    """Graph layer that applies LLM quota deduction after node execution."""

    def __init__(self) -> None:
        super().__init__()
        self._abort_sent = False

    @override
    def on_graph_start(self) -> None:
        self._abort_sent = False

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        _ = event

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        _ = error

    @override
    def on_node_run_start(self, node: Node) -> None:
        if self._abort_sent:
            return

        model_instance = self._build_model_instance(node)
        if model_instance is None:
            return

        try:
            ensure_llm_quota_available(model_instance=model_instance)
        except QuotaExceededError as exc:
            self._set_stop_event(node)
            self._send_abort_command(reason=str(exc))
            logger.warning("LLM quota check failed, node_id=%s, error=%s", node.id, exc)

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        if error is not None or not isinstance(result_event, NodeRunSucceededEvent):
            return

        model_instance = self._build_model_instance(node)
        if model_instance is None:
            return

        try:
            dify_ctx = node.require_dify_context()
            deduct_llm_quota(
                tenant_id=dify_ctx.tenant_id,
                model_instance=model_instance,
                usage=result_event.node_run_result.llm_usage,
            )
        except QuotaExceededError as exc:
            self._set_stop_event(node)
            self._send_abort_command(reason=str(exc))
            logger.warning("LLM quota deduction exceeded, node_id=%s, error=%s", node.id, exc)
        except Exception:
            logger.exception("LLM quota deduction failed, node_id=%s", node.id)

    @staticmethod
    def _set_stop_event(node: Node) -> None:
        stop_event = getattr(node.graph_runtime_state, "stop_event", None)
        if stop_event is not None:
            stop_event.set()

    def _send_abort_command(self, *, reason: str) -> None:
        if not self.command_channel or self._abort_sent:
            return

        try:
            self.command_channel.send_command(
                AbortCommand(
                    command_type=CommandType.ABORT,
                    reason=reason,
                )
            )
            self._abort_sent = True
        except Exception:
            logger.exception("Failed to send quota abort command")

    @staticmethod
    def _build_model_instance(node: Node) -> ModelInstance | None:
        if node.node_type not in _LLM_LIKE_NODE_TYPES:
            return None

        model_config = getattr(node.node_data, "model", None)
        if model_config is None:
            return None

        try:
            from dify_graph.nodes.llm.llm_utils import fetch_model_config

            model_instance, _ = fetch_model_config(
                tenant_id=node.tenant_id,
                node_data_model=model_config,
            )
            return model_instance
        except Exception:
            logger.warning("Failed to build ModelInstance for quota check, node_id=%s", node.id, exc_info=True)
            return None
