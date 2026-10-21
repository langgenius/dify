"""External feature, configuration, and model adapters for document creation."""

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from models.enums import PermissionEnum
from services.feature_service import FeatureService
from services.knowledge.documents.contracts import (
    DocumentCreationDataset,
    DocumentCreationEnvironment,
    DocumentCreationLimits,
    DocumentCreationModelGateway,
)
from services.knowledge.documents.creation import build_default_process_rules
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)


class ConfiguredDocumentCreationGateway:
    """Read deployment and provider state outside document policy."""

    def __init__(self, *, models: DocumentCreationModelGateway) -> None:
        self._models = models

    def load_environment(self, tenant_id: str) -> DocumentCreationEnvironment:
        return load_document_creation_environment(tenant_id)

    def resolve_default_embedding_model(self, tenant_id: str) -> EmbeddingModelConfiguration:
        return self._models.resolve_default_embedding_model(tenant_id=tenant_id)

    def validate_dataset_model(self, dataset: DocumentCreationDataset) -> None:
        self._models.validate_dataset_model(
            configuration=DatasetModelConfiguration(
                tenant_id=dataset.tenant_id,
                indexing_technique=dataset.indexing_technique,
                embedding_model_provider=dataset.embedding_model_provider,
                embedding_model=dataset.embedding_model,
            )
        )


def default_document_process_rules() -> dict[str, object]:
    return build_default_process_rules(dify_config.INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH)


def load_document_creation_environment(tenant_id: str) -> DocumentCreationEnvironment:
    """Load billing limits and queue policy without requiring model infrastructure."""

    initial_permission = str(PermissionEnum.ALL_TEAM if dify_config.RBAC_ENABLED else PermissionEnum.ONLY_ME)
    if dify_config.DEPLOYMENT_EDITION != DeploymentEdition.CLOUD:
        return DocumentCreationEnvironment(
            limits=DocumentCreationLimits(
                enabled=False,
                sandbox=False,
                batch_upload_limit=int(dify_config.BATCH_UPLOAD_LIMIT),
                upload_quota_limit=0,
                upload_quota_size=0,
            ),
            priority_indexing=True,
            initial_permission=initial_permission,
        )

    features = FeatureService.get_features(tenant_id, exclude_vector_space=True)
    sandbox = features.billing.subscription.plan == CloudPlan.SANDBOX
    return DocumentCreationEnvironment(
        limits=DocumentCreationLimits(
            enabled=True,
            sandbox=sandbox,
            batch_upload_limit=int(dify_config.BATCH_UPLOAD_LIMIT),
            upload_quota_limit=features.documents_upload_quota.limit,
            upload_quota_size=features.documents_upload_quota.size,
        ),
        priority_indexing=not sandbox,
        initial_permission=initial_permission,
    )
