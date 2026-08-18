"""KnowledgeFS-native evidence retrieval for Workflow and Chatflow."""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Protocol, override

from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, UserFrom
from core.db.session_factory import session_factory
from graphon.entities import GraphInitParams
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.variables import StringSegment
from graphon.variables.segments import ArrayObjectSegment, ObjectSegment
from graphon.variables.template_resolution import convert_template
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_admission_service import (
    KnowledgeFSAppAdmissionError,
    KnowledgeFSAppAuthorizationNotReadyError,
    KnowledgeFSAppChannelDisabledError,
    KnowledgeFSAppSpaceUnavailableError,
)
from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError
from services.knowledge_fs.app_execution_capability import (
    KnowledgeResourceRef,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSAppBindingPayload,
    KnowledgeFSRetrievalCustomMetadataCondition,
    KnowledgeFSRetrievalCustomMetadataFilter,
    KnowledgeFSRetrievalMetadataFilters,
    KnowledgeFSRetrievalTestItemResponse,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSRetrievalTestResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from tasks.knowledge_fs_failed_retrieval_tasks import enqueue_workflow_failed_retrieval_capture

from .entities import KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE, KnowledgeRetrievalV2NodeData
from .exc import (
    KnowledgeFSRetrievalBindingError,
    KnowledgeFSRetrievalConfigurationError,
    KnowledgeFSRetrievalContractError,
    KnowledgeFSRetrievalUnavailableError,
    KnowledgeFSRetrievalV2NodeError,
)

if TYPE_CHECKING:
    from graphon.runtime import GraphRuntimeState

logger = logging.getLogger(__name__)


def _normalize_metadata_filter_scalar(value: object) -> str | int | float | None:
    if value is None or isinstance(value, (str, float)):
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return str(value)


class _RetrievalCapability(Protocol):
    def run_retrieval(
        self,
        *,
        run_context: DifyRunContext,
        caller_kind: KnowledgeFSAppSpaceJoinType,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSRetrievalTestPayload,
    ) -> KnowledgeFSRetrievalTestResponse: ...


class _BindingCapability(Protocol):
    def upsert(
        self,
        *,
        tenant_id: str,
        actor_account_id: str,
        control_space_id: str,
        payload: KnowledgeFSAppBindingPayload,
    ) -> object: ...


class KnowledgeRetrievalV2Node(Node[KnowledgeRetrievalV2NodeData]):
    node_type = KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE

    def __init__(
        self,
        node_id: str,
        data: KnowledgeRetrievalV2NodeData,
        *,
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        capability_service: _RetrievalCapability | None = None,
        binding_service: _BindingCapability | None = None,
        max_concurrency: int = 4,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        if max_concurrency < 1 or max_concurrency > 10:
            raise ValueError("KnowledgeFS retrieval concurrency must be between 1 and 10")
        self._capability_service = capability_service
        self._binding_service = binding_service
        self._max_concurrency = max_concurrency

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        started_at = time.perf_counter()
        try:
            query = self._resolve_query()
            run_context = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
            self._ensure_draft_bindings(run_context)
            responses = self._retrieve_all_spaces(run_context=run_context, query=query)
            result_items = self._merge_items(responses)
            if not result_items:
                self._enqueue_failed_retrieval_captures(
                    run_context=run_context,
                    query=query,
                    responses=responses,
                )
            metrics = self._aggregate_metrics(responses, started_at=started_at)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"query": query},
                process_data={"knowledge_fs": metrics},
                outputs={
                    "result": ArrayObjectSegment(value=result_items),
                    "metrics": ObjectSegment(value=metrics),
                },
                metadata={},
            )
        except KnowledgeFSRetrievalV2NodeError as exc:
            logger.warning("KnowledgeFS v2 retrieval failed: %s", exc)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={},
                error=str(exc),
                error_type=type(exc).__name__,
            )

    def _resolve_query(self) -> str:
        variable = self.graph_runtime_state.variable_pool.get(self._node_data.query_variable_selector)
        if not isinstance(variable, StringSegment):
            raise KnowledgeFSRetrievalConfigurationError("KnowledgeFS query variable must be a string")
        query = variable.value.strip()
        if not query:
            raise KnowledgeFSRetrievalConfigurationError("KnowledgeFS query variable must not be empty")
        if len(query) > 16_000:
            raise KnowledgeFSRetrievalConfigurationError(
                "KnowledgeFS query variable must contain at most 16000 characters"
            )
        return query

    def _service(self) -> _RetrievalCapability:
        if self._capability_service is not None:
            return self._capability_service
        return get_knowledge_fs_runtime(session_factory.get_session_maker()).app_capabilities

    def _ensure_draft_bindings(self, run_context: DifyRunContext) -> None:
        if not run_context.invoke_from.runs_as_account() or run_context.user_from is not UserFrom.ACCOUNT:
            return
        binding_service = self._binding_service
        if binding_service is None:
            # A separately injected retrieval port is a unit-test/custom boundary. Production nodes
            # resolve both capabilities from the same cached runtime.
            if self._capability_service is not None:
                return
            binding_service = get_knowledge_fs_runtime(session_factory.get_session_maker()).app_bindings
        try:
            for control_space_id in self._node_data.control_space_ids:
                binding_service.upsert(
                    tenant_id=run_context.tenant_id,
                    actor_account_id=run_context.user_id,
                    control_space_id=control_space_id,
                    payload=KnowledgeFSAppBindingPayload(
                        app_id=run_context.app_id,
                        caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                    ),
                )
        except (KnowledgeFSAppBindingManagementError, RuntimeError, ValueError) as exc:
            raise KnowledgeFSRetrievalBindingError(
                "KnowledgeFS draft binding could not be enabled for this workflow"
            ) from exc

    def _retrieve_all_spaces(
        self,
        *,
        run_context: DifyRunContext,
        query: str,
    ) -> list[tuple[str, KnowledgeFSRetrievalTestResponse]]:
        service = self._service()
        payload = KnowledgeFSRetrievalTestPayload(
            query=query,
            mode=self._node_data.mode,
            include_text=True,
            filters=self._resolved_retrieval_filters(),
        )

        def retrieve(control_space_id: str) -> KnowledgeFSRetrievalTestResponse:
            try:
                return service.run_retrieval(
                    run_context=run_context,
                    caller_kind=KnowledgeFSAppSpaceJoinType.WORKFLOW,
                    resource=KnowledgeResourceRef(
                        kind="knowledge_fs",
                        control_space_id=control_space_id,
                    ),
                    payload=payload,
                )
            except KnowledgeFSAppChannelDisabledError as exc:
                raise KnowledgeFSRetrievalBindingError(
                    "[knowledge_fs_workflow_access_disabled] "
                    f"Workflow access is disabled for KnowledgeFS Space {control_space_id}; "
                    "ask a workspace owner to enable the Workflow channel"
                ) from exc
            except KnowledgeFSAppSpaceUnavailableError as exc:
                raise KnowledgeFSRetrievalBindingError(
                    "[knowledge_fs_space_unavailable] "
                    f"KnowledgeFS Space {control_space_id} is not ready for workflow retrieval; "
                    "select an active, provisioned Space"
                ) from exc
            except KnowledgeFSAppAuthorizationNotReadyError as exc:
                raise KnowledgeFSRetrievalBindingError(
                    "[knowledge_fs_authorization_not_ready] "
                    f"KnowledgeFS Space {control_space_id} permissions are not ready; "
                    "ask a workspace owner to finish KnowledgeFS permission setup"
                ) from exc
            except KnowledgeFSAppAdmissionError as exc:
                raise KnowledgeFSRetrievalBindingError(
                    "[knowledge_fs_binding_not_enabled] "
                    f"KnowledgeFS Space {control_space_id} is not bound to this workflow"
                ) from exc
            except ValidationError as exc:
                raise KnowledgeFSRetrievalContractError(
                    f"KnowledgeFS Space {control_space_id} returned an invalid retrieval response"
                ) from exc
            except KnowledgeFSProductRequestRejectedError as exc:
                raise KnowledgeFSRetrievalConfigurationError(
                    f"KnowledgeFS Space {control_space_id} rejected the retrieval request"
                ) from exc
            except (KnowledgeFSOperationUnavailableError, KnowledgeFSProductRemoteError) as exc:
                raise KnowledgeFSRetrievalUnavailableError(
                    f"KnowledgeFS Space {control_space_id} is unavailable"
                ) from exc
            except RuntimeError as exc:
                raise KnowledgeFSRetrievalUnavailableError(
                    f"KnowledgeFS Space {control_space_id} retrieval failed"
                ) from exc

        worker_count = min(self._max_concurrency, len(self._node_data.control_space_ids))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="knowledge-fs-retrieval") as executor:
            futures = [executor.submit(retrieve, space_id) for space_id in self._node_data.control_space_ids]
            return [
                (space_id, future.result())
                for space_id, future in zip(self._node_data.control_space_ids, futures, strict=True)
            ]

    def _resolved_retrieval_filters(self) -> KnowledgeFSRetrievalMetadataFilters | None:
        filters = self._node_data.metadata_filters.model_copy(deep=True) if self._node_data.metadata_filters else None
        configured = self._node_data.metadata_filtering_conditions
        if self._node_data.metadata_filtering_mode != "manual" or not configured or not configured.conditions:
            return filters

        resolved_conditions: list[KnowledgeFSRetrievalCustomMetadataCondition] = []
        for condition in configured.conditions:
            value = condition.value
            if isinstance(value, str):
                segment_group = convert_template(self.graph_runtime_state.variable_pool, value)
                if len(segment_group.value) == 1:
                    value = _normalize_metadata_filter_scalar(segment_group.value[0].to_object())
                else:
                    value = segment_group.text
            if value is None and condition.comparison_operator not in {"empty", "not empty"}:
                continue
            resolved_conditions.append(
                KnowledgeFSRetrievalCustomMetadataCondition(
                    name=condition.name,
                    field_type=condition.metadata_type,
                    comparison_operator=condition.comparison_operator,
                    value=value,
                )
            )

        if not resolved_conditions:
            return filters
        filters = filters or KnowledgeFSRetrievalMetadataFilters()
        filters.custom_metadata = KnowledgeFSRetrievalCustomMetadataFilter(
            logical_operator=configured.logical_operator,
            conditions=resolved_conditions,
        )
        return filters

    def _merge_items(
        self,
        responses: Sequence[tuple[str, KnowledgeFSRetrievalTestResponse]],
    ) -> list[dict[str, Any]]:
        candidates: list[tuple[float, int, int, str, KnowledgeFSRetrievalTestItemResponse]] = []
        for space_index, (control_space_id, response) in enumerate(responses):
            for item_index, item in enumerate(response.items):
                candidates.append((item.score, space_index, item_index, control_space_id, item))
        candidates.sort(key=lambda row: (-row[0], row[1], row[2], row[4].node_id))
        return [
            self._output_item(control_space_id=control_space_id, item=item)
            for _, _, _, control_space_id, item in candidates[: self._node_data.top_n]
        ]

    @staticmethod
    def _enqueue_failed_retrieval_captures(
        *,
        run_context: DifyRunContext,
        query: str,
        responses: Sequence[tuple[str, KnowledgeFSRetrievalTestResponse]],
    ) -> None:
        """Best-effort quality capture after every selected space returned no evidence."""

        for control_space_id, response in responses:
            try:
                enqueue_workflow_failed_retrieval_capture(
                    tenant_id=run_context.tenant_id,
                    app_id=run_context.app_id,
                    control_space_id=control_space_id,
                    query=query,
                    mode=response.mode,
                    retrieval_trace_id=response.trace_id,
                )
            except Exception:
                # The helper owns broker failures in production. Keep a second boundary here so a
                # custom/instrumented dispatcher can never turn a successful empty retrieval into
                # a failed Workflow node.
                logger.exception(
                    "KnowledgeFS empty-retrieval quality capture dispatch failed",
                    extra={
                        "app_id": run_context.app_id,
                        "control_space_id": control_space_id,
                        "retrieval_trace_id": response.trace_id,
                        "tenant_id": run_context.tenant_id,
                    },
                )

    @staticmethod
    def _output_item(
        *,
        control_space_id: str,
        item: KnowledgeFSRetrievalTestItemResponse,
    ) -> dict[str, Any]:
        citation = item.citation
        title = citation.section_path[-1] if citation.section_path else citation.document_asset_id
        return {
            "content": item.text or "",
            "title": title,
            "metadata": {
                "citation": {
                    "artifact_hash": citation.artifact_hash,
                    "document_id": citation.document_asset_id,
                    "document_version": citation.document_version,
                    "section_path": list(citation.section_path),
                    **({"page_number": citation.page_number} if citation.page_number is not None else {}),
                    **({"start_offset": citation.start_offset} if citation.start_offset is not None else {}),
                    **({"end_offset": citation.end_offset} if citation.end_offset is not None else {}),
                },
                "node_id": item.node_id,
                "projection_ids": list(item.projection_ids),
                "score": item.score,
                "sources": list(item.sources),
                "space_id": control_space_id,
            },
        }

    def _aggregate_metrics(
        self,
        responses: Sequence[tuple[str, KnowledgeFSRetrievalTestResponse]],
        *,
        started_at: float,
    ) -> dict[str, Any]:
        effective_modes = list(dict.fromkeys(response.mode for _, response in responses))
        degradation_flags = list(
            dict.fromkeys(flag for _, response in responses for flag in response.metrics.degradation_flags)
        )
        per_space = [
            {
                "candidate_count": len(response.items),
                "control_space_id": control_space_id,
                "degradation_flags": list(response.metrics.degradation_flags),
                "mode": response.mode,
                "total_ms": response.metrics.total_ms,
                "trace_id": response.trace_id,
            }
            for control_space_id, response in responses
        ]
        return {
            "candidate_counts": {control_space_id: len(response.items) for control_space_id, response in responses},
            "degradation_flags": degradation_flags,
            "effective_modes": effective_modes,
            "mode": effective_modes[0] if len(effective_modes) == 1 else "mixed",
            "per_space": per_space,
            "requested_mode": self._node_data.mode or "space-default",
            "total_ms": round(max(0.0, (time.perf_counter() - started_at) * 1_000), 3),
        }

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: KnowledgeRetrievalV2NodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        return {f"{node_id}.query": node_data.query_variable_selector}


__all__ = ["KnowledgeRetrievalV2Node"]
