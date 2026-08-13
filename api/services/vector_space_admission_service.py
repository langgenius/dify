import json
import logging
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from configs import dify_config
from core.model_manager import ModelManager
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.cached_embedding import CacheEmbedding
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document
from enums import CloudPlan, DeploymentEdition
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import Dataset
from services.billing_service import BillingService

logger = logging.getLogger(__name__)

_MEBIBYTE = 1024 * 1024
_FLOAT32_BYTES = 4
_TIDB_VECTOR_COPIES = 2
_TIDB_POINT_OVERHEAD_BYTES = 3584
_WATERMARK_LOCK_TIMEOUT_SECONDS = 5
_WATERMARK_TTL_SECONDS = 30 * 60
_ERROR_PATTERN = re.compile(
    r"Vector storage is estimated to reach (?P<estimated>\d+) MB after this upload, "
    r"exceeding the (?P<limit>\d+) MB limit of the current plan\."
)

VECTOR_SPACE_ADMISSION_ERROR_CODE = "vector_space_estimate_exceeded"


class VectorSpaceAdmissionError(ValueError):
    def __init__(self, message: str):
        self.description = message
        super().__init__(message)


@dataclass(frozen=True)
class VectorStorageWorkload:
    text_points: int
    summary_points: int
    probe_text: str | None

    @property
    def total_points(self) -> int:
        return self.text_points + self.summary_points


@dataclass(frozen=True)
class VectorSpaceAdmissionErrorDetails:
    estimated_mb: int
    plan_limit_mb: int


def estimate_tidb_storage_bytes(point_count: int, dimension: int) -> int:
    """Estimate TiDB row and columnar storage for vector points."""
    return point_count * (dimension * _FLOAT32_BYTES * _TIDB_VECTOR_COPIES + _TIDB_POINT_OVERHEAD_BYTES)


def parse_vector_space_estimate_limits(value: str) -> dict[CloudPlan, int]:
    limits: dict[CloudPlan, int] = {}
    for item in value.split(","):
        plan_name, separator, raw_limit = item.strip().partition(":")
        if not separator:
            raise ValueError(f"Invalid vector-space estimate limit: {item!r}")
        try:
            plan = CloudPlan(plan_name)
            limit = int(raw_limit)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid vector-space estimate limit: {item!r}") from error
        if limit <= 0 or plan in limits:
            raise ValueError(f"Invalid vector-space estimate limit: {item!r}")
        limits[plan] = limit
    if set(limits) != set(CloudPlan):
        raise ValueError(f"Invalid vector-space estimate limits: {value!r}; include sandbox, professional, and team")
    return limits


def format_vector_space_admission_error(estimated_mb: int, plan_limit_mb: int) -> str:
    return (
        f"Vector storage is estimated to reach {estimated_mb} MB after this upload, "
        f"exceeding the {plan_limit_mb} MB limit of the current plan."
    )


def get_vector_space_admission_error_details(error: str | None) -> VectorSpaceAdmissionErrorDetails | None:
    if not error or not (match := _ERROR_PATTERN.fullmatch(error)):
        return None
    return VectorSpaceAdmissionErrorDetails(
        estimated_mb=int(match.group("estimated")),
        plan_limit_mb=int(match.group("limit")),
    )


def get_vector_space_admission_error_fields(error: str | None) -> dict[str, str | int | None]:
    details = get_vector_space_admission_error_details(error)
    return {
        "error_code": VECTOR_SPACE_ADMISSION_ERROR_CODE if details else None,
        "estimated_vector_space_mb": details.estimated_mb if details else None,
        "vector_space_limit_mb": details.plan_limit_mb if details else None,
    }


def build_document_workload(
    doc_form: str,
    documents: list[Document],
    *,
    include_summaries: bool,
) -> VectorStorageWorkload:
    # V1 estimates text vectors only; attachments are excluded.
    texts: list[str] = []
    for document in documents:
        if doc_form == IndexStructureType.PARENT_CHILD_INDEX:
            texts.extend(
                child.page_content
                for child in document.children or []
                if child.page_content and child.page_content.strip()
            )
        elif document.page_content and document.page_content.strip():
            texts.append(document.page_content)

    summary_points = 0
    if include_summaries and doc_form != IndexStructureType.QA_INDEX:
        summary_points = sum(1 for document in documents if document.page_content and document.page_content.strip())

    return VectorStorageWorkload(
        text_points=len(texts),
        summary_points=summary_points,
        probe_text=texts[0] if texts else None,
    )


def build_pipeline_workload(
    chunk_structure: str,
    chunks: Any,
    *,
    include_summaries: bool,
) -> VectorStorageWorkload:
    # V1 estimates chunk text only; file and image metadata are excluded.
    texts: list[str] = []
    summary_points = 0

    if chunk_structure == IndexStructureType.QA_INDEX:
        for chunk in _items(chunks, "qa_chunks"):
            question = _field(chunk, "question")
            if isinstance(question, str) and question.strip():
                texts.append(question)
    elif chunk_structure == IndexStructureType.PARENT_CHILD_INDEX:
        for chunk in _items(chunks, "parent_child_chunks"):
            parent_content = _field(chunk, "parent_content")
            if include_summaries and isinstance(parent_content, str) and parent_content.strip():
                summary_points += 1
            for child in _field(chunk, "child_contents") or []:
                if isinstance(child, str) and child.strip():
                    texts.append(child)
    else:
        raw_chunks = chunks if isinstance(chunks, list) else _items(chunks, "general_chunks")
        for chunk in raw_chunks:
            content = chunk if isinstance(chunk, str) else _field(chunk, "content")
            if isinstance(content, str) and content.strip():
                texts.append(content)
                if include_summaries:
                    summary_points += 1

    return VectorStorageWorkload(
        text_points=len(texts),
        summary_points=summary_points,
        probe_text=texts[0] if texts else None,
    )


def _field(value: Any, name: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)  # guard-ignore: no-new-getattr -- supports validated chunk models


def _items(value: Any, name: str) -> list[Any]:
    items = _field(value, name)
    return list(items) if items else []


class VectorSpaceAdmissionService:
    """Cloud-only pre-write guard for unusually large TiDB vector workloads."""

    def __init__(self) -> None:
        self._dimension_by_dataset: dict[str, int] = {}
        self._plan_by_tenant: dict[str, CloudPlan | None] = {}

    def ensure_document_can_be_indexed(
        self,
        *,
        dataset: Dataset,
        document_id: str,
        doc_form: str,
        documents: list[Document],
        include_summaries: bool,
        session: Session,
    ) -> None:
        self._ensure_can_write(
            dataset=dataset,
            document_id=document_id,
            workload=build_document_workload(
                doc_form,
                documents,
                include_summaries=include_summaries,
            ),
            session=session,
        )

    def ensure_pipeline_can_be_indexed(
        self,
        *,
        dataset: Dataset,
        document_id: str,
        chunk_structure: str,
        chunks: Any,
        include_summaries: bool,
        session: Session,
    ) -> None:
        self._ensure_can_write(
            dataset=dataset,
            document_id=document_id,
            workload=build_pipeline_workload(
                chunk_structure,
                chunks,
                include_summaries=include_summaries,
            ),
            session=session,
        )

    def _ensure_can_write(
        self,
        *,
        dataset: Dataset,
        document_id: str,
        workload: VectorStorageWorkload,
        session: Session,
    ) -> None:
        if (
            dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD
            or dataset.indexing_technique != IndexTechniqueType.HIGH_QUALITY
            or workload.total_points == 0
            or workload.probe_text is None
        ):
            return
        if Vector.resolve_vector_type(dataset, session=session) != VectorType.TIDB_ON_QDRANT:
            return

        plan = self._get_plan(dataset.tenant_id)
        if plan is None:
            return
        estimate_limit_mb = parse_vector_space_estimate_limits(
            dify_config.TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB
        ).get(plan)
        if estimate_limit_mb is None:
            return

        current_usage_mb, plan_limit_mb = self._get_usage_and_limit_mb(dataset.tenant_id)
        dimension = self._get_embedding_dimension(dataset, workload.probe_text)
        estimate_bytes = math.ceil(estimate_tidb_storage_bytes(workload.total_points, dimension))
        document_estimated_mb = estimate_bytes / _MEBIBYTE
        base_usage_bytes, projected_usage_bytes = self._reserve_projected_usage(
            tenant_id=dataset.tenant_id,
            document_id=document_id,
            current_usage_bytes=math.ceil(current_usage_mb * _MEBIBYTE),
            document_estimate_bytes=estimate_bytes,
            estimate_limit_bytes=estimate_limit_mb * _MEBIBYTE,
        )
        base_usage_mb = base_usage_bytes / _MEBIBYTE
        projected_usage_mb = projected_usage_bytes / _MEBIBYTE
        if projected_usage_bytes > estimate_limit_mb * _MEBIBYTE:
            logger.warning(
                "TiDB vector-space admission rejected tenant_id=%s document_id=%s plan=%s "
                "points=%s dimension=%s current_usage_mb=%s document_estimated_mb=%s "
                "watermark_base_usage_mb=%s projected_usage_mb=%s plan_limit_mb=%s estimate_limit_mb=%s",
                dataset.tenant_id,
                document_id,
                plan,
                workload.total_points,
                dimension,
                current_usage_mb,
                document_estimated_mb,
                base_usage_mb,
                projected_usage_mb,
                plan_limit_mb,
                estimate_limit_mb,
            )
            raise VectorSpaceAdmissionError(
                format_vector_space_admission_error(math.ceil(projected_usage_mb), plan_limit_mb)
            )

        logger.info(
            "TiDB vector-space admission allowed tenant_id=%s document_id=%s plan=%s "
            "points=%s dimension=%s current_usage_mb=%s document_estimated_mb=%s "
            "watermark_base_usage_mb=%s projected_usage_mb=%s estimate_limit_mb=%s",
            dataset.tenant_id,
            document_id,
            plan,
            workload.total_points,
            dimension,
            current_usage_mb,
            document_estimated_mb,
            base_usage_mb,
            projected_usage_mb,
            estimate_limit_mb,
        )

    def _get_usage_and_limit_mb(self, tenant_id: str) -> tuple[float, int]:
        try:
            vector_space = BillingService.get_vector_space(tenant_id)
            current_usage_mb = float(vector_space["size"])
            plan_limit_mb = int(vector_space["limit"])
        except Exception as error:
            raise VectorSpaceAdmissionError(
                "Unable to verify vector storage usage right now. Please try again later."
            ) from error
        return current_usage_mb, plan_limit_mb

    def _reserve_projected_usage(
        self,
        *,
        tenant_id: str,
        document_id: str,
        current_usage_bytes: int,
        document_estimate_bytes: int,
        estimate_limit_bytes: int,
    ) -> tuple[int, int]:
        watermark_key = f"tenant:{tenant_id}:vector_space_estimate_watermark"
        lock_key = f"{watermark_key}:lock"

        try:
            with redis_client.lock(
                lock_key,
                timeout=_WATERMARK_LOCK_TIMEOUT_SECONDS,
                blocking_timeout=_WATERMARK_LOCK_TIMEOUT_SECONDS,
            ):
                raw_state = redis_client.get(watermark_key)
                stored_usage_bytes = 0
                document_ids: set[str] = set()
                if raw_state:
                    state = json.loads(raw_state)
                    stored_usage_bytes = state.get("projected_usage_bytes")
                    raw_document_ids = state.get("document_ids")
                    if (
                        type(stored_usage_bytes) is not int
                        or stored_usage_bytes < 0
                        or not isinstance(raw_document_ids, list)
                        or not all(isinstance(item, str) for item in raw_document_ids)
                    ):
                        raise ValueError("Invalid vector-space estimate watermark")
                    document_ids = set(raw_document_ids)

                base_usage_bytes = max(current_usage_bytes, stored_usage_bytes)
                projected_usage_bytes = base_usage_bytes
                if document_id not in document_ids:
                    projected_usage_bytes += document_estimate_bytes

                if projected_usage_bytes <= estimate_limit_bytes:
                    document_ids.add(document_id)
                    redis_client.setex(
                        watermark_key,
                        _WATERMARK_TTL_SECONDS,
                        json.dumps(
                            {
                                "projected_usage_bytes": projected_usage_bytes,
                                "document_ids": sorted(document_ids),
                            },
                            separators=(",", ":"),
                        ),
                    )

                return base_usage_bytes, projected_usage_bytes
        except Exception as error:
            raise VectorSpaceAdmissionError(
                "Unable to reserve estimated vector storage right now. Please try again later."
            ) from error

    def _get_plan(self, tenant_id: str) -> CloudPlan | None:
        if tenant_id in self._plan_by_tenant:
            return self._plan_by_tenant[tenant_id]
        try:
            billing_info = BillingService.get_info(tenant_id, exclude_vector_space=True)
        except Exception as error:
            raise VectorSpaceAdmissionError(
                "Unable to verify the subscription plan right now. Please try again later."
            ) from error

        plan = None
        if billing_info["enabled"]:
            try:
                plan = CloudPlan(billing_info["subscription"]["plan"])
            except ValueError:
                logger.warning(
                    "Skipping TiDB vector-space admission for unknown plan tenant_id=%s plan=%s",
                    tenant_id,
                    billing_info["subscription"]["plan"],
                )
        self._plan_by_tenant[tenant_id] = plan
        return plan

    def _get_embedding_dimension(self, dataset: Dataset, probe_text: str) -> int:
        cached_dimension = self._dimension_by_dataset.get(dataset.id)
        if cached_dimension is not None:
            return cached_dimension

        model_manager = ModelManager.for_tenant(tenant_id=dataset.tenant_id)
        if dataset.embedding_model_provider:
            model_instance = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )
        else:
            model_instance = model_manager.get_default_model_instance(
                tenant_id=dataset.tenant_id,
                model_type=ModelType.TEXT_EMBEDDING,
            )

        embeddings = CacheEmbedding(model_instance).embed_documents([probe_text])
        if not embeddings or not embeddings[0]:
            raise VectorSpaceAdmissionError(
                "Unable to estimate vector storage for this document. Please try again later."
            )

        dimension = len(embeddings[0])
        self._dimension_by_dataset[dataset.id] = dimension
        return dimension
