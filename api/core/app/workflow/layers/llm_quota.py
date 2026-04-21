"""
LLM quota deduction layer for GraphEngine.

This layer centralizes model-quota deduction outside node implementations.
"""

import logging
from typing import final, override

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.app.llm import deduct_llm_quota, ensure_llm_quota_available
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance
from graphon.enums import BuiltinNodeTypes
from graphon.graph_engine.entities.commands import AbortCommand, CommandType
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphNodeEventBase, NodeRunSucceededEvent
from graphon.nodes.base.node import Node

logger = logging.getLogger(__name__)


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

        model_instance = self._extract_model_instance(node)
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

        model_instance = self._extract_model_instance(node)
        if model_instance is None:
            return

        try:
            dify_ctx = DifyRunContext.model_validate(node.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
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
    def _extract_model_instance(node: Node) -> ModelInstance | None:
        match node.node_type:
            case BuiltinNodeTypes.LLM | BuiltinNodeTypes.PARAMETER_EXTRACTOR | BuiltinNodeTypes.QUESTION_CLASSIFIER:
                pass
            case _:
                return None

        try:
            model_instance = getattr(node, "model_instance", None)
        except AttributeError:
            logger.warning(
                "LLMQuotaLayer skipped quota deduction because node does not expose a model instance, node_id=%s",
                node.id,
            )
            return None

        if isinstance(model_instance, ModelInstance):
            return model_instance

        raw_model_instance = getattr(model_instance, "_model_instance", None)
        if isinstance(raw_model_instance, ModelInstance):
            return raw_model_instance

        private_model_instance = getattr(node, "_model_instance", None)
        if isinstance(private_model_instance, ModelInstance):
            return private_model_instance

        wrapped_private_model_instance = getattr(private_model_instance, "_model_instance", None)
        if isinstance(wrapped_private_model_instance, ModelInstance):
            return wrapped_private_model_instance

        return None
