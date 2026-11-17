"""Composition root for tenant-owned migration dependency evidence."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.app.agent_app_repository import AgentAppRepository
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository
from services.model_billing_dependency_adapters import PluginAgentStrategySelectorQuery, TypedModelDependencyExtractor
from services.model_billing_dependency_inventory import ModelBillingDependencyInventory
from services.model_billing_dependency_provenance import (
    AccessCheckedSavedModelMigrationIntent,
    SavedModelDependencyProvenance,
    StableSavedModelMigrationIntent,
)
from services.model_billing_dependency_runtime import (
    CompositeModelDependencyDocuments,
    KnowledgeModelDependencyDocuments,
    RevisionModelDependencyInventoryPolicies,
    RevisionModelDependencyRetirements,
    SavedModelSelectionRuntimeQuery,
)
from services.model_billing_migration_inventory import ModelBillingMigrationInventory
from services.model_billing_migration_inventory_gateway import (
    HistoricalMigrationInventoryGateway,
    SavedDependencyMigrationEvidenceGateway,
)


def build_model_billing_dependencies(*, database_client: sessionmaker[Session]) -> ModelBillingDependencyInventory:
    records = ModelBillingDependencyRepository(session_factory=database_client)
    return ModelBillingDependencyInventory(
        documents=CompositeModelDependencyDocuments(
            (
                ConsoleAppRepository(session_factory=database_client).collect_model_dependency_documents,
                AgentAppRepository(session_factory=database_client).collect_model_dependency_documents,
                KnowledgeModelDependencyDocuments(
                    datasets=SQLAlchemyDatasetRepository(session_factory=database_client)
                ).collect,
                records.collect_model_dependency_documents,
            )
        ),
        extractor=TypedModelDependencyExtractor(strategies=PluginAgentStrategySelectorQuery()),
        provenance=SavedModelDependencyProvenance(selections=SavedModelSelectionRuntimeQuery(records=records)),
        retirements=RevisionModelDependencyRetirements(),
        stable_provenance=StableSavedModelMigrationIntent(selections=SavedModelSelectionRuntimeQuery(records=records)),
        policies=RevisionModelDependencyInventoryPolicies(),
        access_checked_provenance=AccessCheckedSavedModelMigrationIntent(
            selections=SavedModelSelectionRuntimeQuery(records=records)
        ),
    )


def build_model_billing_migration_inventory(
    *, database_client: sessionmaker[Session], dependencies: ModelBillingDependencyInventory
) -> ModelBillingMigrationInventory:
    records = ModelBillingDependencyRepository(session_factory=database_client)
    return ModelBillingMigrationInventory(
        dependencies=dependencies,
        evidence=SavedDependencyMigrationEvidenceGateway(
            selections=SavedModelSelectionRuntimeQuery(records=records), records=records
        ),
        historical=HistoricalMigrationInventoryGateway(),
        policy_json=dify_config.TOKENER_LEGACY_DEPENDENCY_INVENTORIES_JSON,
    )
