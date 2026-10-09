"""Model preparation and index dispatch adapters for Pipeline publication."""

from typing import Literal

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from core.workflow.llm_environment_variable import validate_llm_environment_model_references
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider_ids import ModelProviderID
from repositories.workflow.definition_repository import workflow_from_snapshot
from services.errors.rag_pipeline import RagPipelinePublicationError
from services.knowledge.dataset_service import DatasetService
from services.rag_pipeline.publication_contracts import EmbeddingModel
from services.workflow.contracts import WorkflowSnapshot
from tasks.deal_dataset_index_update_task import deal_dataset_index_update_task


class PipelinePublicationModelGateway:
    def provider_id(self, value: str | None) -> str | None:
        return str(ModelProviderID(value)) if value else None

    def validate_workflow(self, draft: WorkflowSnapshot) -> None:
        workflow = workflow_from_snapshot(draft)
        validate_llm_environment_model_references(
            graph=workflow.graph_dict, environment_variables=workflow.environment_variables
        )

    def embedding(self, tenant_id: str, provider: str, name: str, *, allow_missing: bool) -> EmbeddingModel | None:
        try:
            try:
                model = ModelManager.for_tenant(tenant_id=tenant_id).get_model_instance(
                    tenant_id=tenant_id, provider=provider, model_type=ModelType.TEXT_EMBEDDING, model=name
                )
            except ProviderTokenNotInitError:
                # Existing high-quality datasets retain their model when the new
                # provider has no credentials. Initial setup and upgrades require it.
                if allow_missing:
                    return None
                raise
            return EmbeddingModel(
                provider=model.provider,
                name=model.model_name,
                is_multimodal=DatasetService.check_is_multimodal_model(tenant_id, provider, name),
            )
        except LLMBadRequestError as error:
            raise RagPipelinePublicationError(
                "No Embedding Model available. Please configure a valid provider in the Settings -> Model Provider."
            ) from error
        except ProviderTokenNotInitError as error:
            raise RagPipelinePublicationError(error.description) from error


class PipelineIndexUpdateGateway:
    def dispatch(self, dataset_id: str, action: Literal["add", "update"]) -> None:
        deal_dataset_index_update_task.delay(dataset_id, action)
