"""Tenant-scoped cleanup orchestration for enterprise workspaces."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models import App, Dataset
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from services import dataset_api_key_service
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from services.app_service import AppService
from tasks.clean_dataset_task import clean_dataset_task
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkspaceResourceCleanupService:
    """Schedule existing App, Dataset, and Agent cleanup lifecycles.

    The Tenant row and workspace memberships are retained. Missing resources are
    treated as already cleaned, so the operation can be retried safely.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        agent_resources: WorkspaceResourceCleanupRepository,
    ) -> None:
        self._session_factory = session_factory
        self._agent_resources = agent_resources

    def cleanup(self, workspace_id: str) -> None:
        failures: list[str] = []
        with self._session_factory() as session:
            app_ids = list(session.scalars(select(App.id).where(App.tenant_id == workspace_id)).all())
            dataset_ids = list(session.scalars(select(Dataset.id).where(Dataset.tenant_id == workspace_id)).all())

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
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == workspace_id))
            if app is not None:
                AppService().delete_app(app, session=session, account_id=None)

    def _delete_dataset(self, workspace_id: str, dataset_id: str) -> None:
        with self._session_factory() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == workspace_id))
            if dataset is None:
                return
            cleanup_args = (
                dataset.id,
                workspace_id,
                dataset.indexing_technique,
                dataset.index_struct,
                dataset.collection_binding_id,
                dataset.get_doc_form(session=session) or "text_model",
                dataset.pipeline_id,
            )
        # Schedule cleanup outside the read transaction. The worker needs the
        # pre-delete index metadata to remove vector-store records.
        clean_dataset_task.delay(*cleanup_args)
        with self._session_factory.begin() as transaction:
            dataset_api_key_service.delete_keys_scoped_only_to(transaction, dataset_id)
            row = transaction.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == workspace_id))
            if row is not None:
                transaction.delete(row)

    def _retire_agents(self, workspace_id: str) -> None:
        archived = self._agent_resources.archive_agents(workspace_id)
        workspace_ids = self._agent_resources.list_agent_workspace_ids(workspace_id)
        binding_ids = self._agent_resources.list_agent_workspace_binding_ids(workspace_id)
        with self._session_factory.begin() as session:
            snapshot_ids = AgentHomeSnapshotService.retire_all_for_tenant(session=session, tenant_id=workspace_id)
            for resource_id in workspace_ids:
                AgentWorkspaceService.retire_workspace(
                    session=session, tenant_id=workspace_id, workspace_id=resource_id
                )
            for binding_id in binding_ids:
                AgentWorkspaceService.retire_binding(session=session, tenant_id=workspace_id, binding_id=binding_id)
        self._agent_resources.delete_agent_bindings(workspace_id)

        # Backing Apps may already be gone; republish their idempotent cleanup
        # before collecting archived Agents.
        for app_id in archived.backing_app_ids:
            remove_app_and_related_data_task.delay(tenant_id=workspace_id, app_id=app_id)
        enqueue_agent_resource_collection(
            tenant_id=workspace_id,
            binding_ids=binding_ids,
            workspace_ids=workspace_ids,
            home_snapshot_ids=snapshot_ids,
            purge_agent_ids=archived.agent_ids,
        )
