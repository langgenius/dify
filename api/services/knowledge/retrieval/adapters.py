"""Persistence and workflow runtime adapters for trusted inner retrieval."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.metadata_entities import Condition, MetadataFilteringCondition
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval import exc as retrieval_exc
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.nodes.llm.entities import ModelConfig
from machinery.context import RequestContext
from models.dataset import Dataset
from models.model import App
from services.entities.knowledge_retrieval_inner import (
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveResult,
    InnerKnowledgeRetrieveUsage,
)
from services.errors.knowledge_retrieval import (
    ExternalKnowledgeRetrievalError,
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveConfigError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
    InnerKnowledgeRetrieveExternalError,
    InnerKnowledgeRetrieveRateLimitError,
)


class SQLAlchemyInnerKnowledgeRetrievalScope:
    """Validate the complete app/dataset owner chain in a short read session."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        """Reject missing and foreign resources without applying console visibility policy."""
        with self._sessions() as session:
            app_tenant_id = session.scalar(select(App.tenant_id).where(App.id == app_id).limit(1))
            if app_tenant_id is None:
                raise InnerKnowledgeRetrieveAppNotFoundError(f"App '{app_id}' not found")
            if app_tenant_id != tenant_id:
                raise InnerKnowledgeRetrieveAppTenantMismatchError(
                    f"App '{app_id}' does not belong to tenant '{tenant_id}'"
                )

            datasets = dict(
                session.execute(select(Dataset.id, Dataset.tenant_id).where(Dataset.id.in_(dataset_ids))).tuples().all()
            )
            missing_ids = sorted(set(dataset_ids) - datasets.keys())
            if missing_ids:
                raise InnerKnowledgeRetrieveDatasetNotFoundError(f"Datasets not found: {', '.join(missing_ids)}")
            mismatched_ids = sorted(dataset_id for dataset_id, owner in datasets.items() if owner != tenant_id)
            if mismatched_ids:
                raise InnerKnowledgeRetrieveDatasetTenantMismatchError(
                    f"Datasets do not belong to tenant '{tenant_id}': {', '.join(mismatched_ids)}"
                )


class WorkflowKnowledgeRetrievalGateway:
    """Map the inner DTO to the workflow retrieval kernel in an owned session."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def retrieve(self, context: RequestContext, request: InnerKnowledgeRetrieveRequest) -> InnerKnowledgeRetrieveResult:
        rag = DatasetRetrieval()
        rag.set_request_metadata(
            {
                "app_id": request.caller.app_id,
                "request_id": context.request_id,
                "trace_id": context.trace_id,
            }
        )
        try:
            with self._sessions() as session:
                results = rag.knowledge_retrieval(session=session, request=self._to_rag_request(request))
                result = InnerKnowledgeRetrieveResult(
                    results=[source.model_dump(mode="json") for source in results],
                    usage=InnerKnowledgeRetrieveUsage.model_validate(jsonable_encoder(rag.llm_usage)),
                )
                session.commit()
            return result
        except retrieval_exc.RateLimitExceededError as error:
            raise InnerKnowledgeRetrieveRateLimitError(str(error)) from error
        except ExternalKnowledgeRetrievalError as error:
            raise InnerKnowledgeRetrieveExternalError(str(error)) from error
        except ValueError as error:
            raise InnerKnowledgeRetrieveConfigError(str(error)) from error

    @staticmethod
    def _to_rag_request(request: InnerKnowledgeRetrieveRequest) -> KnowledgeRetrievalRequest:
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
            weights=request.retrieval.weights.model_dump() if request.retrieval.weights is not None else None,
            reranking_enable=request.retrieval.reranking_enable,
            attachment_ids=request.attachment_ids or None,
        )
