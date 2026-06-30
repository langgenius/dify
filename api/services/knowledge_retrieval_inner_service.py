
"""Service wrapper for the inner knowledge retrieval API.

This service keeps the internal HTTP contract small while reusing the workflow
retrieval stack in ``core.rag.retrieval.dataset_retrieval.DatasetRetrieval``.
The only authorization enforced here is tenant ownership of the caller app and
requested datasets.

It intentionally does not check ``dataset.enable_api`` or user-level dataset
permissions. After the caller app and requested datasets pass tenant-scoped
prechecks, dataset availability and "no usable document" cases are delegated to
``DatasetRetrieval`` and may legitimately produce an empty result list instead
of a separate validation error.
"""

from sqlalchemy import select
from sqlalchemy.orm import scoped_session

from core.rag.entities.metadata_entities import Condition, MetadataFilteringCondition
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.nodes.llm.entities import ModelConfig
from models.dataset import Dataset
from models.model import App
from services.entities.knowledge_retrieval_inner import (
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveResponse,
    InnerKnowledgeRetrieveUsage,
)
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)


class InnerKnowledgeRetrievalService:
    """Validate inner caller scope and delegate to workflow dataset retrieval."""

    def retrieve(
        self,
        request: InnerKnowledgeRetrieveRequest,
        session: scoped_session,
    ) -> InnerKnowledgeRetrieveResponse:
        """Run tenant-scoped retrieval for a trusted internal caller.

        This method only rejects caller app existence/tenant mismatches and
        requested dataset existence/tenant mismatches. It deliberately leaves
        ``dataset.enable_api``, user-level dataset permissions, and
        availability/no-usable-document handling to ``DatasetRetrieval`` so the
        inner API stays aligned with workflow retrieval semantics, including
        returning ``[]`` when datasets are present but yield no retrievable
        content.

        Raises:
            InnerKnowledgeRetrieveAppNotFoundError: The caller app does not exist.
            InnerKnowledgeRetrieveAppTenantMismatchError: The caller app is outside the caller tenant.
            InnerKnowledgeRetrieveDatasetNotFoundError: At least one requested dataset does not exist.
            InnerKnowledgeRetrieveDatasetTenantMismatchError:
                At least one requested dataset is outside the caller tenant.
        """
        self._validate_caller_app(tenant_id=request.caller.tenant_id, app_id=request.caller.app_id, session=session)
        self._validate_datasets(tenant_id=request.caller.tenant_id, dataset_ids=request.dataset_ids, session=session)

        rag = DatasetRetrieval()
        results = rag.knowledge_retrieval(request=self._to_rag_request(request))
        return InnerKnowledgeRetrieveResponse(
            results=results,
            usage=InnerKnowledgeRetrieveUsage.model_validate(jsonable_encoder(rag.llm_usage)),
        )

    def _validate_caller_app(self, *, tenant_id: str, app_id: str, session: scoped_session) -> None:
        app = session.scalar(select(App).where(App.id == app_id).limit(1))
        if app is None:
            raise InnerKnowledgeRetrieveAppNotFoundError(f"App '{app_id}' not found")
        if app.tenant_id != tenant_id:
            raise InnerKnowledgeRetrieveAppTenantMismatchError(
                f"App '{app_id}' does not belong to tenant '{tenant_id}'"
            )

    def _validate_datasets(self, *, tenant_id: str, dataset_ids: list[str], session: scoped_session) -> None:
        datasets = session.scalars(select(Dataset).where(Dataset.id.in_(dataset_ids))).all()

        found_ids = {dataset.id for dataset in datasets}
        missing_ids = sorted(set(dataset_ids) - found_ids)
        if missing_ids:
            raise InnerKnowledgeRetrieveDatasetNotFoundError(f"Datasets not found: {', '.join(missing_ids)}")

        mismatched_ids = sorted(dataset.id for dataset in datasets if dataset.tenant_id != tenant_id)
        if mismatched_ids:
            raise InnerKnowledgeRetrieveDatasetTenantMismatchError(
                f"Datasets do not belong to tenant '{tenant_id}': {', '.join(mismatched_ids)}"
            )

    def _to_rag_request(self, request: InnerKnowledgeRetrieveRequest) -> KnowledgeRetrievalRequest:
        metadata_model_config = request.metadata_filtering.metadata_model_config
        metadata_conditions = request.metadata_filtering.conditions

        return KnowledgeRetrievalRequest(
            tenant_id=request.caller.tenant_id,
            user_id=request.caller.user_id,
            app_id=request.caller.app_id,
            user_from=request.caller.user_from,
            dataset_ids=request.dataset_ids,
            query=request.query,
            retrieval_mode=request.retrieval.mode,
            model_provider=request.retrieval.model.provider if request.retrieval.model else None,
            completion_params=request.retrieval.model.completion_params if request.retrieval.model else None,
            model_mode=request.retrieval.model.mode if request.retrieval.model else None,
            model_name=request.retrieval.model.name if request.retrieval.model else None,
            metadata_model_config=ModelConfig.model_validate(metadata_model_config.model_dump(mode="python"))
            if metadata_model_config
            else None,
            metadata_filtering_conditions=(
                MetadataFilteringCondition(
                    logical_operator=metadata_conditions.logical_operator,
                    conditions=(
                        [
                            Condition(
                                name=condition.name,
                                comparison_operator=condition.comparison_operator,
                                value=condition.value,
                            )
                            for condition in metadata_conditions.conditions
                        ]
                        if metadata_conditions.conditions is not None
                        else None
                    ),
                )
                if metadata_conditions is not None
                else None
            ),
            metadata_filtering_mode=request.metadata_filtering.mode,
            top_k=request.retrieval.top_k or 0,
            score_threshold=request.retrieval.score_threshold,
            reranking_mode=request.retrieval.reranking_mode,
            reranking_model=(
                {
                    "reranking_provider_name": request.retrieval.reranking_model.provider,
                    "reranking_model_name": request.retrieval.reranking_model.model,
                }
                if request.retrieval.reranking_model is not None
                else None
            ),
            weights=request.retrieval.weights,
            reranking_enable=request.retrieval.reranking_enable,
            attachment_ids=request.attachment_ids or None,
        )
