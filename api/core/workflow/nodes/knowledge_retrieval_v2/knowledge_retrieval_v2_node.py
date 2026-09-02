"""KnowledgeFS-native evidence retrieval for Workflow and Chatflow."""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, override

from pydantic import ValidationError

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, UserFrom
from core.db.session_factory import session_factory
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from graphon.entities import GraphInitParams
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.rerank_entities import RerankResult
from graphon.node_events import NodeRunResult
from graphon.nodes.base.node import Node
from graphon.variables import ArrayFileSegment, FileSegment, StringSegment
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
    KnowledgeFSRetrievalQueryImageReference,
    KnowledgeFSRetrievalTestItemResponse,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSRetrievalTestResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
)
from services.knowledge_fs.query_images import (
    QUERY_IMAGE_MAX_COUNT,
    QUERY_IMAGE_MAX_TOTAL_BYTES,
    KnowledgeFSQueryImageError,
    issue_workflow_query_image_reference,
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

MAX_WORKFLOW_RERANK_CANDIDATES = 100
WORKFLOW_RERANK_POOL_MULTIPLIER = 4


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


class _RerankModelManager(Protocol):
    def get_default_model_instance(self, tenant_id: str, model_type: ModelType) -> ModelInstance: ...

    def get_model_instance(
        self,
        tenant_id: str,
        provider: str,
        model_type: ModelType,
        model: str,
    ) -> ModelInstance: ...


@dataclass(frozen=True)
class _WorkflowRerankCandidate:
    control_space_id: str
    item: KnowledgeFSRetrievalTestItemResponse
    item_index: int
    space_index: int


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
        rerank_model_manager: _RerankModelManager | None = None,
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
        self._rerank_model_manager = rerank_model_manager
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
            query_images, query_image_inputs = self._resolve_query_images(run_context)
            self._ensure_draft_bindings(run_context)
            responses = self._retrieve_all_spaces(
                run_context=run_context,
                query=query,
                query_images=query_images,
            )
            result_items, rerank_metrics = self._merge_items(
                responses,
                query=query,
                tenant_id=run_context.tenant_id,
            )
            if not result_items and all(not response.items for _, response in responses):
                self._enqueue_failed_retrieval_captures(
                    run_context=run_context,
                    query=query,
                    responses=responses,
                )
            metrics = self._aggregate_metrics(
                responses,
                rerank_metrics=rerank_metrics,
                started_at=started_at,
            )
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs={"query": query, **({"query_images": query_image_inputs} if query_image_inputs else {})},
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

    def _resolve_query_images(
        self,
        run_context: DifyRunContext,
    ) -> tuple[list[KnowledgeFSRetrievalQueryImageReference], list[dict[str, object]]]:
        selector = self._node_data.query_attachment_selector
        if not selector:
            return [], []
        variable = self.graph_runtime_state.variable_pool.get(selector)
        if isinstance(variable, FileSegment):
            files = [variable.value]
        elif isinstance(variable, ArrayFileSegment):
            files = list(variable.value)
        else:
            raise KnowledgeFSRetrievalConfigurationError(
                "KnowledgeFS query attachment variable must be a file or array of files"
            )
        if len(files) > QUERY_IMAGE_MAX_COUNT:
            raise KnowledgeFSRetrievalConfigurationError(
                f"KnowledgeFS query attachments must contain at most {QUERY_IMAGE_MAX_COUNT} images"
            )

        references: list[KnowledgeFSRetrievalQueryImageReference] = []
        inputs: list[dict[str, object]] = []
        total_bytes = 0
        seen_ids: set[str] = set()
        try:
            for file in files:
                reference = issue_workflow_query_image_reference(
                    app_id=run_context.app_id,
                    file=file,
                    tenant_id=run_context.tenant_id,
                )
                if reference.upload_file_id in seen_ids:
                    raise KnowledgeFSQueryImageError(
                        "QUERY_IMAGE_REFERENCE_DUPLICATE",
                        "Workflow query images must not contain duplicate files",
                    )
                seen_ids.add(reference.upload_file_id)
                total_bytes += reference.byte_size
                if total_bytes > QUERY_IMAGE_MAX_TOTAL_BYTES:
                    raise KnowledgeFSQueryImageError(
                        "QUERY_IMAGE_TOTAL_TOO_LARGE",
                        f"Workflow query images exceed aggregate max bytes {QUERY_IMAGE_MAX_TOTAL_BYTES}",
                    )
                references.append(
                    KnowledgeFSRetrievalQueryImageReference(
                        accessGrant=reference.access_grant,
                        uploadFileId=reference.upload_file_id,
                    )
                )
                inputs.append(
                    {
                        "filename": file.filename or reference.upload_file_id,
                        "mime_type": reference.mime_type,
                        "size": reference.byte_size,
                    }
                )
        except KnowledgeFSQueryImageError as exc:
            raise KnowledgeFSRetrievalConfigurationError(str(exc)) from exc
        return references, inputs

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
        query_images: Sequence[KnowledgeFSRetrievalQueryImageReference],
    ) -> list[tuple[str, KnowledgeFSRetrievalTestResponse]]:
        service = self._service()
        payload = KnowledgeFSRetrievalTestPayload(
            query=query,
            query_images=list(query_images),
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
        *,
        query: str,
        tenant_id: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        candidates = self._balanced_candidate_pool(responses)
        if not candidates:
            return [], {
                "applied": False,
                "candidate_count": 0,
                "duration_ms": 0.0,
                "output_count": 0,
                "score_threshold": self._node_data.score_threshold,
                "source": "custom" if self._node_data.reranking_model else "system-default",
                "top_k": self._node_data.top_n,
            }

        model_manager = self._rerank_model_manager or ModelManager.for_tenant(tenant_id=tenant_id)
        selection = self._node_data.reranking_model
        try:
            if selection is None:
                model_instance = model_manager.get_default_model_instance(tenant_id, ModelType.RERANK)
                source = "system-default"
            else:
                model_instance = model_manager.get_model_instance(
                    tenant_id=tenant_id,
                    provider=selection.provider,
                    model_type=ModelType.RERANK,
                    model=selection.model,
                )
                source = "custom"
        except (ModelCurrentlyNotSupportError, ProviderTokenNotInitError, ValueError) as exc:
            raise KnowledgeFSRetrievalConfigurationError(
                "Workflow rerank model is not configured or is unavailable"
            ) from exc

        documents = [self._rerank_text(candidate.item) for candidate in candidates]
        rerank_started_at = time.perf_counter()
        try:
            result = model_instance.invoke_rerank(
                query=query,
                docs=documents,
                score_threshold=self._node_data.score_threshold,
                top_n=min(self._node_data.top_n, len(candidates)),
            )
        except Exception as exc:
            raise KnowledgeFSRetrievalUnavailableError("Workflow rerank model invocation failed") from exc
        duration_ms = round(max(0.0, (time.perf_counter() - rerank_started_at) * 1_000), 3)
        ranked = self._validate_rerank_result(result=result, candidates=candidates)
        threshold = self._node_data.score_threshold
        if threshold is not None:
            ranked = [row for row in ranked if row[0] >= threshold]
        ranked.sort(
            key=lambda row: (
                -row[0],
                row[1].space_index,
                row[1].item_index,
                row[1].item.node_id,
            )
        )
        ranked = ranked[: self._node_data.top_n]
        output = [
            self._output_item(
                control_space_id=candidate.control_space_id,
                item=candidate.item,
                score=score,
            )
            for score, candidate in ranked
        ]
        return output, {
            "applied": True,
            "candidate_count": len(candidates),
            "duration_ms": duration_ms,
            "model": model_instance.model_name,
            "output_count": len(output),
            "provider": model_instance.provider,
            "score_threshold": threshold,
            "source": source,
            "top_k": self._node_data.top_n,
        }

    def _balanced_candidate_pool(
        self,
        responses: Sequence[tuple[str, KnowledgeFSRetrievalTestResponse]],
    ) -> list[_WorkflowRerankCandidate]:
        limit = min(
            MAX_WORKFLOW_RERANK_CANDIDATES,
            max(self._node_data.top_n, self._node_data.top_n * WORKFLOW_RERANK_POOL_MULTIPLIER),
        )
        candidates: list[_WorkflowRerankCandidate] = []
        max_items = max((len(response.items) for _, response in responses), default=0)
        for item_index in range(max_items):
            for space_index, (control_space_id, response) in enumerate(responses):
                if item_index >= len(response.items):
                    continue
                candidates.append(
                    _WorkflowRerankCandidate(
                        control_space_id=control_space_id,
                        item=response.items[item_index],
                        item_index=item_index,
                        space_index=space_index,
                    )
                )
                if len(candidates) >= limit:
                    return candidates
        return candidates

    @staticmethod
    def _rerank_text(item: KnowledgeFSRetrievalTestItemResponse) -> str:
        text = (item.text or "").strip()
        if text:
            return text
        section_path = " / ".join(part.strip() for part in item.citation.section_path if part.strip())
        return section_path or item.node_id

    @staticmethod
    def _validate_rerank_result(
        *,
        result: RerankResult,
        candidates: Sequence[_WorkflowRerankCandidate],
    ) -> list[tuple[float, _WorkflowRerankCandidate]]:
        ranked: list[tuple[float, _WorkflowRerankCandidate]] = []
        seen_indices: set[int] = set()
        for document in result.docs:
            if document.index in seen_indices or document.index < 0 or document.index >= len(candidates):
                raise KnowledgeFSRetrievalContractError("Workflow rerank model returned invalid document indices")
            if not math.isfinite(document.score):
                raise KnowledgeFSRetrievalContractError("Workflow rerank model returned a non-finite score")
            seen_indices.add(document.index)
            ranked.append((document.score, candidates[document.index]))
        return ranked

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
        score: float,
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
                "score": score,
                "space_score": item.score,
                "sources": list(item.sources),
                "space_id": control_space_id,
            },
        }

    def _aggregate_metrics(
        self,
        responses: Sequence[tuple[str, KnowledgeFSRetrievalTestResponse]],
        *,
        rerank_metrics: Mapping[str, Any],
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
            "workflow_rerank": dict(rerank_metrics),
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
        mapping: dict[str, Sequence[str]] = {f"{node_id}.query": node_data.query_variable_selector}
        if node_data.query_attachment_selector:
            mapping[f"{node_id}.queryAttachment"] = node_data.query_attachment_selector
        return mapping


__all__ = ["KnowledgeRetrievalV2Node"]
