"""Schedule existing resource deletion lifecycles for an enterprise workspace.

This service does not delete the Tenant or its memberships, and does not claim
that publishing child tasks means their physical cleanup has completed.
"""

import logging

from sqlalchemy.orm import Session, sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from extensions.application_services.resource_access_token import build_resource_access_token_cleanup_service
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from services.app_service import AppService
from services.knowledge.entities.resource_scope import DatasetRef
from tasks.clean_dataset_task import clean_dataset_task
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkspaceResourceCleanupService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        apps: ConsoleAppRepository,
        datasets: SQLAlchemyDatasetRepository,
        agent_resources: WorkspaceResourceCleanupRepository,
    ) -> None:
        # The session factory only serves existing services that require a
        # caller-owned session; drop it once they own their persistence.
        self._session_factory = session_factory
        self._apps = apps
        self._datasets = datasets
        self._agent_resources = agent_resources

    def cleanup(self, workspace_id: str) -> None:
        """Attempt all resource groups; propagate failures to the caller."""
        failures: list[str] = []
        app_ids = self._apps.list_workspace_app_ids(workspace_id)
        dataset_ids = self._datasets.list_workspace_dataset_ids(workspace_id)

        for app_id in app_ids:
            try:
                self._delete_app(workspace_id, app_id)
            except Exception:
                logger.exception("Workspace App deletion failed: %s:%s", workspace_id, app_id)
                failures.append(f"app:{app_id}")

        for dataset_id in dataset_ids:
            try:
                self._delete_dataset(workspace_id, dataset_id)
            except Exception:
                logger.exception("Workspace Dataset deletion failed: %s:%s", workspace_id, dataset_id)
                failures.append(f"dataset:{dataset_id}")

        try:
            self._retire_agents(workspace_id)
        except Exception:
            logger.exception("Workspace Agent retirement failed: %s", workspace_id)
            failures.append("agents")
        if failures:
            raise RuntimeError(f"Workspace resource deletion failed for {workspace_id}: {', '.join(failures)}")

    def _delete_app(self, workspace_id: str, app_id: str) -> None:
        with self._session_factory() as session:
            app = AppService.get_app_in_workspace(tenant_id=workspace_id, app_id=app_id, session=session)
            if app is not None:
                AppService().delete_app(app, session=session, account_id=None)

    def _delete_dataset(self, workspace_id: str, dataset_id: str) -> None:
        # Inner-API authentication authorizes the whole tenant. No member actor
        # is available here; preserve the normal deletion effects without RBAC.
        dataset_ref = DatasetRef(workspace_id, dataset_id)
        dataset = self._datasets.get_cleanup_record(dataset_ref)
        if dataset is None:
            return
        # Unlike the member deletion signal, also schedule incomplete or
        # empty datasets so their relational data is not skipped.
        clean_dataset_task.delay(
            dataset.id,
            workspace_id,
            dataset.indexing_technique,
            dataset.index_struct,
            dataset.collection_binding_id,
            dataset.doc_form or "text_model",
            dataset.pipeline_id,
        )
        with self._session_factory.begin() as session:
            dataset_api_key_bindings.delete_keys_scoped_only_to(session, dataset.id)
            build_resource_access_token_cleanup_service(session=session).delete_resource_relations(
                tenant_id=workspace_id,
                resource_type=ResourceAccessTokenResourceType.KNOWLEDGE,
                resource_id=dataset.id,
            )
        # Delete the row last so a failed step is retried from the remaining Dataset.
        self._datasets.delete(dataset_ref)

    def _retire_agents(self, workspace_id: str) -> None:
        # Sweep independently of App records: archived, workflow-only and
        # backing-App-less Agents must also be collected on repeated requests.
        archived = self._agent_resources.archive_agents(workspace_id)
        workspace_ids = self._agent_resources.list_agent_workspace_ids(workspace_id)
        binding_ids = self._agent_resources.list_agent_workspace_binding_ids(workspace_id)
        with self._session_factory.begin() as session:
            snapshot_ids = AgentHomeSnapshotService.retire_all_for_tenant(session=session, tenant_id=workspace_id)
            # Both retire calls skip resources that are no longer active.
            for resource_id in workspace_ids:
                AgentWorkspaceService.retire_workspace(
                    session=session, tenant_id=workspace_id, workspace_id=resource_id
                )
            for binding_id in binding_ids:
                AgentWorkspaceService.retire_binding(session=session, tenant_id=workspace_id, binding_id=binding_id)
        self._agent_resources.delete_agent_bindings(workspace_id)

        # Backing App records can already be gone; re-publish their idempotent
        # related-data cleanup before collecting the archived Agent aggregates.
        for app_id in archived.backing_app_ids:
            remove_app_and_related_data_task.delay(tenant_id=workspace_id, app_id=app_id)
        enqueue_agent_resource_collection(
            tenant_id=workspace_id,
            binding_ids=binding_ids,
            workspace_ids=workspace_ids,
            home_snapshot_ids=snapshot_ids,
            purge_agent_ids=archived.agent_ids,
        )
