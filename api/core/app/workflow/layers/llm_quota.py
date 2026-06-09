"""
LLM quota deduction layer for GraphEngine.

This layer centralizes model-quota handling outside node implementations.

Graphon LLM-backed nodes expose provider/model identity through public node
configuration and, after execution, through ``node_run_result.inputs``. Resolve
quota billing from that public identity instead of depending on
``ModelInstance`` reconstruction inside the workflow layer. Missing identity on
quota-tracked nodes is treated as a workflow bug and aborts execution so quota
handling is never silently skipped.
"""

import logging
from typing import final, override

from core.app.llm import deduct_llm_quota_for_model, ensure_llm_quota_available_for_model
from core.errors.error import QuotaExceededError
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.graph_engine.entities.commands import AbortCommand, CommandType
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphNodeEventBase, NodeRunSucceededEvent
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node

logger = logging.getLogger(__name__)
_QUOTA_NODE_TYPES = frozenset(
    [
        BuiltinNodeTypes.LLM,
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
    ]
)


@final
class LLMQuotaLayer(GraphEngineLayer):
    """Graph layer that applies tenant-scoped quota checks to LLM-backed nodes."""

    tenant_id: str
    _abort_sent: bool

    def __init__(self, tenant_id: str) -> None:
        super().__init__()
        self.tenant_id = tenant_id
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

        if not self._supports_quota(node):
            return

        model_identity = self._extract_model_identity_from_node(node)
        if model_identity is None:
            reason = "LLM quota check requires public node model identity before execution."
            self._abort_before_node_run(node=node, reason=reason, error_type="LLMQuotaIdentityError")
            logger.error("LLM quota handling aborted, node_id=%s, reason=%s", node.id, reason)
            return

        provider, model_name = model_identity
        try:
            ensure_llm_quota_available_for_model(
                tenant_id=self.tenant_id,
                provider=provider,
                model=model_name,
            )
        except QuotaExceededError as exc:
            self._abort_before_node_run(node=node, reason=str(exc), error_type=QuotaExceededError.__name__)
            logger.warning("LLM quota check failed, node_id=%s, error=%s", node.id, exc)

    @override
    def on_node_run_end(
        self, node: Node, error: Exception | None, result_event: GraphNodeEventBase | None = None
    ) -> None:
        if error is not None or not isinstance(result_event, NodeRunSucceededEvent) or not self._supports_quota(node):
            return

        model_identity = self._extract_model_identity_from_result_event(result_event)
        if model_identity is None:
            self._abort_for_missing_model_identity(
                node=node,
                reason="LLM quota deduction requires model identity in the node result event.",
            )
            return

        provider, model_name = model_identity

        try:
            deduct_llm_quota_for_model(
                tenant_id=self.tenant_id,
                provider=provider,
                model=model_name,
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

    def _abort_before_node_run(self, *, node: Node, reason: str, error_type: str) -> None:
        self._set_stop_event(node)
        node.node_data.error_strategy = None
        node.node_data.retry_config.retry_enabled = False

        def quota_aborted_run() -> NodeRunResult:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=reason,
                error_type=error_type,
            )

        # TODO: Push Graphon to expose a public pre-run failure/skip hook, then replace this private _run override.
        node._run = quota_aborted_run  # type: ignore[method-assign]
        self._send_abort_command(reason=reason)

    def _abort_for_missing_model_identity(self, *, node: Node, reason: str) -> None:
        self._set_stop_event(node)
        self._send_abort_command(reason=reason)
        logger.error("LLM quota handling aborted, node_id=%s, reason=%s", node.id, reason)

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
    def _supports_quota(node: Node) -> bool:
        return node.node_type in _QUOTA_NODE_TYPES

    @staticmethod
    def _extract_model_identity_from_result_event(result_event: NodeRunSucceededEvent) -> tuple[str, str] | None:
        provider = result_event.node_run_result.inputs.get("model_provider")
        model_name = result_event.node_run_result.inputs.get("model_name")
        if isinstance(provider, str) and provider and isinstance(model_name, str) and model_name:
            return provider, model_name
        return None

    @staticmethod
    def _extract_model_identity_from_node(node: Node) -> tuple[str, str] | None:
        node_data = getattr(node, "node_data", None)
        if node_data is None:
            node_data = getattr(node, "data", None)

        model_config = getattr(node_data, "model", None)
        if model_config is None:
            logger.warning(
                "LLMQuotaLayer skipped quota handling because node model config is missing, node_id=%s",
                node.id,
            )
            return None

        provider = getattr(model_config, "provider", None)
        model_name = getattr(model_config, "name", None)
        if isinstance(provider, str) and provider and isinstance(model_name, str) and model_name:
            return provider, model_name

        logger.warning(
            "LLMQuotaLayer skipped quota handling because node model identity is invalid, node_id=%s",
            node.id,
        )
        return None
