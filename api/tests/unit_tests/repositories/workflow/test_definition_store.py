"""Tests migrated from removed WorkflowService persistence entry points."""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.agent import WorkflowAgentBindingType
from machinery.context import RequestContext
from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.workflow import Workflow
from repositories.agent.retirement_repository import WorkflowAgentRetirementRepository
from repositories.workflow.definition_repository import (
    WorkflowDefinitionStore,
    workflow_snapshot,
)
from repositories.workflow.draft_repository import WorkflowDraftRepository
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.workflow.contracts import WorkflowOwner
from services.workflow_ref_service import WorkflowRef
from tests.unit_tests.model_factories import make_tenant
from tests.unit_tests.services.test_workflow_service import TestWorkflowAssociatedDataFactory


class TestWorkflowDefinitionPersistence:
    def test_restore_historical_inline_agent_after_current_pointer_moves_uses_real_clone(
        self,
        sqlite_session: Session,
    ) -> None:
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id=None)
        account = TestWorkflowAssociatedDataFactory.create_account()
        graph: dict[str, object] = {
            "nodes": [
                {
                    "id": "agent-node",
                    "data": {
                        "type": "agent",
                        "version": "2",
                        "agent_node_kind": "dify_agent",
                    },
                }
            ],
            "edges": [],
        }
        historical = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id="historical-workflow",
            version="historical-version",
            graph=graph,
        )
        current = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id="current-workflow",
            version="current-version",
            graph=graph,
        )
        draft = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id="draft-workflow",
            version=Workflow.VERSION_DRAFT,
        )
        source_agent = Agent(
            id="historical-agent",
            tenant_id=app.tenant_id,
            name="Historical inline Agent",
            description="",
            role="",
            agent_kind=AgentKind.DIFY_AGENT,
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=app.id,
            workflow_id=historical.id,
            workflow_node_id="agent-node",
            active_config_snapshot_id="historical-snapshot",
            active_config_has_model=False,
            active_config_is_published=True,
            status=AgentStatus.ACTIVE,
            created_by=account.id,
            updated_by=account.id,
        )
        source_snapshot = AgentConfigSnapshot(
            id="historical-snapshot",
            tenant_id=app.tenant_id,
            agent_id=source_agent.id,
            version=1,
            config_snapshot=AgentSoulConfig(config_note="historical soul"),
            created_by=account.id,
        )
        historical_binding = WorkflowAgentNodeBinding(
            id="historical-binding",
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=historical.id,
            workflow_version=historical.version,
            node_id="agent-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id=source_agent.id,
            current_snapshot_id=source_snapshot.id,
            node_job_config={},
            created_by=account.id,
        )
        sqlite_session.add_all(
            [
                account,
                make_tenant(tenant_id=app.tenant_id),
                TenantAccountJoin(tenant_id=app.tenant_id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )
        sqlite_session.add_all([app, historical, current, draft, source_agent, source_snapshot, historical_binding])
        app.workflow_id = historical.id
        sqlite_session.commit()

        app.workflow_id = current.id
        sqlite_session.commit()

        factory = sessionmaker(sqlite_session.get_bind(), expire_on_commit=False)
        WorkflowAgentRetirementService(WorkflowAgentRetirementRepository(factory)).retire_unowned(
            tenant_id=app.tenant_id,
            agent_ids=[source_agent.id],
            account_id=account.id,
        )
        sqlite_session.expire_all()
        retained_agent = sqlite_session.get(Agent, source_agent.id)
        assert retained_agent is not None
        assert retained_agent.status is AgentStatus.ACTIVE

        with WorkflowDraftRepository(factory).draft_restore(
            RequestContext("restore", None, account.id, app.tenant_id),
            WorkflowOwner(app.id),
            workflow_snapshot(historical),
        ) as transaction:
            WorkflowAgentPublishService(repository=transaction.bindings).restore_agent_node_bindings_to_draft(
                source_workflow=workflow_snapshot(historical),
                draft_workflow=transaction.workflow,
                account_id=account.id,
            )
        sqlite_session.expire_all()

        restored_binding = sqlite_session.scalar(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.workflow_id == draft.id,
                WorkflowAgentNodeBinding.workflow_version == Workflow.VERSION_DRAFT,
                WorkflowAgentNodeBinding.node_id == "agent-node",
            )
        )
        assert transaction.workflow.id == draft.id
        assert app.workflow_id == current.id
        assert sqlite_session.get(Workflow, historical.id) is historical
        assert sqlite_session.get(WorkflowAgentNodeBinding, historical_binding.id) is historical_binding
        assert restored_binding is not None
        assert restored_binding.agent_id not in (None, source_agent.id)
        assert restored_binding.current_snapshot_id not in (None, source_snapshot.id)
        restored_agent = sqlite_session.get(Agent, restored_binding.agent_id)
        restored_snapshot = sqlite_session.get(AgentConfigSnapshot, restored_binding.current_snapshot_id)
        assert restored_agent is not None
        assert restored_agent.workflow_id == draft.id
        assert restored_agent.workflow_node_id == "agent-node"
        assert restored_snapshot is not None
        assert restored_snapshot.config_snapshot_dict == source_snapshot.config_snapshot_dict

    def test_get_all_published_workflow_with_pagination(self, sqlite_session: Session) -> None:
        """
        Test get_all_published_workflow returns paginated results.

        Apps can have many published versions over time.
        Pagination prevents loading all versions at once, improving performance.
        """
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id="workflow-123")

        sqlite_session.add_all(
            [
                TestWorkflowAssociatedDataFactory.create_workflow(workflow_id=f"workflow-{i}", version=f"v{i}")
                for i in range(5)
            ]
        )
        sqlite_session.commit()

        workflows, has_more = WorkflowDefinitionStore.get_all_published_workflow(
            session=sqlite_session, app_model=app, page=1, limit=10, user_id=None
        )

        assert len(workflows) == 5
        assert has_more is False

    def test_get_all_published_workflow_lists_the_draft_first(self, sqlite_session: Session) -> None:
        """
        Test the draft heads the version list no matter how old it is.

        A draft is created together with its app and its `created_at` is never refreshed,
        so ordering purely by publish time would put it last — off the first page entirely
        once the app has accumulated enough published versions.
        """
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id="workflow-3")
        app_created_at = datetime(2026, 1, 1)

        sqlite_session.add(
            TestWorkflowAssociatedDataFactory.create_workflow(
                workflow_id="workflow-draft",
                version=Workflow.VERSION_DRAFT,
                created_at=app_created_at,
            )
        )
        sqlite_session.add_all(
            [
                TestWorkflowAssociatedDataFactory.create_workflow(
                    workflow_id=f"workflow-{i}",
                    version=f"2026-02-0{i} 00:00:00",
                    created_at=app_created_at + timedelta(days=i),
                )
                for i in range(1, 4)
            ]
        )
        sqlite_session.commit()

        workflows, _ = WorkflowDefinitionStore.get_all_published_workflow(
            session=sqlite_session, app_model=app, page=1, limit=2, user_id=None
        )

        assert [workflow.id for workflow in workflows] == ["workflow-draft", "workflow-3"]

    def test_get_all_published_workflow_has_more(self, sqlite_session: Session) -> None:
        """
        Test get_all_published_workflow indicates has_more when results exceed limit.

        The has_more flag tells the UI whether to show a "Load More" button.
        This is determined by fetching limit+1 records and checking if we got that many.
        """
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id="workflow-123")

        sqlite_session.add_all(
            [
                TestWorkflowAssociatedDataFactory.create_workflow(workflow_id=f"workflow-{i}", version=f"v{i}")
                for i in range(11)
            ]
        )
        sqlite_session.commit()

        workflows, has_more = WorkflowDefinitionStore.get_all_published_workflow(
            session=sqlite_session, app_model=app, page=1, limit=10, user_id=None
        )

        assert len(workflows) == 10
        assert has_more is True

    def test_get_all_published_workflow_no_workflow_id(self, sqlite_session: Session) -> None:
        """Test get_all_published_workflow returns empty when app has no workflow_id."""
        app = TestWorkflowAssociatedDataFactory.create_app(workflow_id=None)

        workflows, has_more = WorkflowDefinitionStore.get_all_published_workflow(
            session=sqlite_session, app_model=app, page=1, limit=10, user_id=None
        )

        assert workflows == []
        assert has_more is False

    def test_update_workflow_success(self, sqlite_session: Session) -> None:
        """
        Test update_workflow updates workflow attributes.

        Allows updating metadata like marked_name and marked_comment
        without creating a new version. Only specific fields are allowed
        to prevent accidental modification of workflow logic.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        app_id = "app-789"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id=app_id, workflow_id=workflow_id)
        account_id = "user-123"
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = WorkflowDefinitionStore.update_workflow(
            session=sqlite_session,
            account_id=account_id,
            data={"marked_name": "Updated Name", "marked_comment": "Updated Comment"},
            workflow_ref=workflow_ref,
        )

        sqlite_session.flush()
        assert result is workflow
        assert workflow.marked_name == "Updated Name"
        assert workflow.marked_comment == "Updated Comment"
        assert workflow.updated_by == account_id

    def test_update_workflow_not_found(self, sqlite_session: Session) -> None:
        """Test update_workflow returns None when workflow not found."""
        result = WorkflowDefinitionStore.update_workflow(
            session=sqlite_session,
            account_id="user-123",
            data={"marked_name": "Test"},
            workflow_ref=WorkflowRef(tenant_id="tenant-456", owner_id="app-789", workflow_id="nonexistent"),
        )

        assert result is None

    def test_update_workflow_with_ref_scopes_lookup_to_app(self, sqlite_session: Session) -> None:
        """Test update_workflow includes the trusted app owner in the lookup."""
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        app_id = "app-789"
        account_id = "user-123"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="other-app", workflow_id=workflow_id)
        workflow = TestWorkflowAssociatedDataFactory.create_workflow(
            workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()

        result = WorkflowDefinitionStore.update_workflow(
            session=sqlite_session,
            account_id=account_id,
            data={"marked_name": "Updated Name"},
            workflow_ref=workflow_ref,
        )

        assert result is None
        assert workflow.marked_name == ""
