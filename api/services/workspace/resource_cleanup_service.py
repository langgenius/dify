"""Schedule existing resource deletion lifecycles for an enterprise workspace.

This service does not delete the Tenant or its memberships, and does not claim
that publishing child tasks means their physical cleanup has completed.
"""

import logging

from constants.resource_access_token import ResourceAccessTokenResourceType
from core.db.session_factory import session_factory
from extensions.application_services.resource_access_token import build_resource_access_token_cleanup_service
from libs.datetime_utils import naive_utc_now
from models.agent import AgentStatus, AgentWorkingResourceStatus
from repositories.knowledge import dataset_api_key_bindings
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from repositories.workspace.resource_cleanup_repository import WorkspaceResourceCleanupRepository
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService
from services.app_service import AppService
from tasks.clean_dataset_task import clean_dataset_task
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.remove_app_and_related_data_task import remove_app_and_related_data_task

logger = logging.getLogger(__name__)


class WorkspaceResourceCleanupService:
    @classmethod
    def cleanup(cls, workspace_id: str) -> None:
        """Attempt all resource groups; propagate failures to the caller."""
        failures: list[str] = []
        with session_factory.create_session() as session:
            repository = WorkspaceResourceCleanupRepository(session=session)
            app_ids = repository.list_app_ids(workspace_id)
            dataset_ids = repository.list_dataset_ids(workspace_id)

        for app_id in app_ids:
            try:
                with session_factory.create_session() as session:
                    app = WorkspaceResourceCleanupRepository(session=session).get_app(workspace_id, app_id)
                    if app is not None:
                        AppService().delete_app(app, session=session, account_id=None)
            except Exception:
                logger.exception("Workspace App deletion failed: %s:%s", workspace_id, app_id)
                failures.append(f"app:{app_id}")

        for dataset_id in dataset_ids:
            try:
                cls._delete_dataset(workspace_id, dataset_id)
            except Exception:
                logger.exception("Workspace Dataset deletion failed: %s:%s", workspace_id, dataset_id)
                failures.append(f"dataset:{dataset_id}")

        try:
            cls._retire_agents(workspace_id)
        except Exception:
            logger.exception("Workspace Agent retirement failed: %s", workspace_id)
            failures.append("agents")
        if failures:
            raise RuntimeError(f"Workspace resource deletion failed for {workspace_id}: {', '.join(failures)}")

    @staticmethod
    def _delete_dataset(workspace_id: str, dataset_id: str) -> None:
        # Inner-API authentication authorizes the whole tenant. No member actor
        # is available here; preserve the normal deletion effects without RBAC.
        with session_factory.create_session() as session:
            repository = WorkspaceResourceCleanupRepository(session=session)
            dataset = repository.get_dataset(workspace_id, dataset_id)
            if dataset is None:
                return
            # Unlike the member deletion signal, also schedule incomplete or
            # empty datasets so their relational data is not skipped.
            doc_form = get_dataset_doc_form(dataset, session=session) or "text_model"
            clean_dataset_task.delay(
                dataset.id,
                workspace_id,
                dataset.indexing_technique,
                dataset.index_struct,
                dataset.collection_binding_id,
                doc_form,
                dataset.pipeline_id,
            )
            dataset_api_key_bindings.delete_keys_scoped_only_to(session, str(dataset.id))
            build_resource_access_token_cleanup_service(session=session).delete_resource_relations(
                tenant_id=workspace_id,
                resource_type=ResourceAccessTokenResourceType.KNOWLEDGE,
                resource_id=dataset.id,
            )
            repository.delete_dataset(dataset)
            session.commit()

    @staticmethod
    def _retire_agents(workspace_id: str) -> None:
        # Sweep independently of App records: archived, workflow-only and
        # backing-App-less Agents must also be collected on repeated requests.
        with session_factory.create_session() as session:
            repository = WorkspaceResourceCleanupRepository(session=session)
            agents = repository.list_agents(workspace_id)
            bindings = repository.list_workspace_bindings(workspace_id)
            workspaces = repository.list_workspaces(workspace_id)
            now = naive_utc_now()
            snapshot_ids: list[str] = []
            for agent in agents:
                if agent.status != AgentStatus.ARCHIVED:
                    agent.status = AgentStatus.ARCHIVED
                    agent.archived_at = now
                    agent.updated_at = now
                snapshot_ids.extend(
                    AgentHomeSnapshotService.retire_all_for_agent(
                        session=session, tenant_id=workspace_id, agent_id=agent.id
                    )
                )
            # Include orphan Home snapshots whose Agent row is already gone.
            snapshots = repository.list_home_snapshots(workspace_id)
            for snapshot in snapshots:
                if snapshot.status == AgentWorkingResourceStatus.ACTIVE:
                    snapshot.status = AgentWorkingResourceStatus.RETIRED
                    snapshot.retired_at = now
            snapshot_ids = [snapshot.id for snapshot in snapshots]
            for workspace in workspaces:
                if workspace.status == AgentWorkingResourceStatus.ACTIVE:
                    AgentWorkspaceService.retire_workspace(
                        session=session, tenant_id=workspace_id, workspace_id=workspace.id
                    )
            for binding in bindings:
                if binding.status == AgentWorkingResourceStatus.ACTIVE:
                    AgentWorkspaceService.retire_binding(session=session, tenant_id=workspace_id, binding_id=binding.id)
            repository.delete_agent_bindings(workspace_id)
            agent_ids = [agent.id for agent in agents]
            backing_app_ids = sorted({agent.backing_app_id for agent in agents if agent.backing_app_id})
            binding_ids = [binding.id for binding in bindings]
            workspace_ids = [workspace.id for workspace in workspaces]
            session.commit()

        # Backing App records can already be gone; re-publish their idempotent
        # related-data cleanup before collecting the archived Agent aggregates.
        for app_id in backing_app_ids:
            remove_app_and_related_data_task.delay(tenant_id=workspace_id, app_id=app_id)
        enqueue_agent_resource_collection(
            tenant_id=workspace_id,
            binding_ids=binding_ids,
            workspace_ids=workspace_ids,
            home_snapshot_ids=snapshot_ids,
            purge_agent_ids=agent_ids,
        )
