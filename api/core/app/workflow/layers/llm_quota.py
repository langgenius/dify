"""
LLM quota deduction layer for GraphEngine.

This layer centralizes model-quota deduction outside node implementations.
"""

import logging
from typing import TYPE_CHECKING, cast, final

from typing_extensions import override

from core.app.llm import deduct_llm_quota
from core.model_manager import ModelInstance
from core.workflow.enums import NodeType
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

    @override
    def on_graph_start(self) -> None:
        return

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        _ = event

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        _ = error

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
        except Exception:
            logger.exception("LLM quota deduction failed, node_id=%s", node.id)

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
