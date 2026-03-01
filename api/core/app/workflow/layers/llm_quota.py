"""
LLM quota deduction layer for GraphEngine.

This layer centralizes model-quota deduction outside node implementations.
"""

import logging
from typing import TYPE_CHECKING, cast, final

from typing_extensions import override

from core.app.llm import deduct_llm_quota, ensure_llm_quota_available
from core.errors.error import QuotaExceededError
from core.model_manager import ModelInstance
from core.workflow.enums import NodeType
from core.workflow.graph_engine.entities.commands import AbortCommand, CommandType
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import GraphEngineEvent, GraphNodeEventBase
from core.workflow.graph_events.node import NodeRunSucceededEvent
from core.workflow.nodes.base.node import Node

if TYPE_CHECKING:
    from core.workflow.nodes.llm.node import LLMNode
    from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
    from core.workflow.nodes.question_classifier.question_classifier_node import QuestionClassifierNode

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
            deduct_llm_quota(
                tenant_id=node.tenant_id,
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
        try:
            match node.node_type:
                case NodeType.LLM:
                    return cast("LLMNode", node).model_instance
                case NodeType.PARAMETER_EXTRACTOR:
                    return cast("ParameterExtractorNode", node).model_instance
                case NodeType.QUESTION_CLASSIFIER:
                    return cast("QuestionClassifierNode", node).model_instance
                case _:
                    return None
        except AttributeError:
            logger.warning(
                "LLMQuotaLayer skipped quota deduction because node does not expose a model instance, node_id=%s",
                node.id,
            )
            return None
