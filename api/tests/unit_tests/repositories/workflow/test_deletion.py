"""Published workflow deletion and binding ownership are repository operations."""

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session

from enums.agent import WorkflowAgentBindingType
from models.agent import WorkflowAgentNodeBinding
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from repositories.workflow.definition_repository import WorkflowDefinitionStore
from services.errors.workflow_service import DraftWorkflowDeletionError, WorkflowInUseError
from services.workflow_ref_service import WorkflowRef
from tests.unit_tests.model_factories import make_workflow


class TestWorkflowDeletion:
    # ==================== Delete Workflow Tests ====================
    # These tests verify workflow deletion with safety checks

    def test_delete_workflow_success(self, sqlite_session: Session) -> None:
        """
        Test delete_workflow successfully deletes a published workflow.

        Users can delete old published versions they no longer need.
        This helps manage storage and keeps the version list clean.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        app_id = "app-789"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id=app_id, workflow_id=workflow_id)
        workflow = make_workflow(workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id, version="v1")
        inline_binding = WorkflowAgentNodeBinding(
            id="inline-binding",
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_version="v1",
            node_id="inline-node",
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
            agent_id="inline-agent",
            current_snapshot_id="snapshot-1",
            node_job_config={},
        )
        roster_binding = WorkflowAgentNodeBinding(
            id="roster-binding",
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_version="v1",
            node_id="roster-node",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id="roster-agent",
            current_snapshot_id="snapshot-2",
            node_job_config={},
        )
        non_target_bindings = [
            WorkflowAgentNodeBinding(
                id=f"non-target-{key}",
                tenant_id="other-tenant" if key == "tenant" else tenant_id,
                app_id="other-app" if key == "app" else app_id,
                workflow_id="other-workflow" if key == "workflow" else workflow_id,
                workflow_version="other-version" if key == "version" else workflow.version,
                node_id=f"{key}-node",
                binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                agent_id=f"{key}-inline-agent",
                current_snapshot_id=f"{key}-snapshot",
                node_job_config={},
            )
            for key in ("tenant", "app", "workflow", "version")
        ]
        sqlite_session.add_all([workflow, inline_binding, roster_binding, *non_target_bindings])
        sqlite_session.commit()

        result = WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)
        sqlite_session.flush()

        assert {binding.agent_id for binding in result} == {"inline-agent", "roster-agent"}
        assert sqlite_session.get(Workflow, workflow_id) is None
        assert sqlite_session.get(WorkflowAgentNodeBinding, inline_binding.id) is None
        assert sqlite_session.get(WorkflowAgentNodeBinding, roster_binding.id) is None
        for binding in non_target_bindings:
            assert sqlite_session.get(WorkflowAgentNodeBinding, binding.id) is binding

    def test_delete_workflow_locks_source_until_caller_commits(self, sqlite_session: Session) -> None:
        workflow = make_workflow(version="v1")
        workflow_ref = WorkflowRef(
            tenant_id=workflow.tenant_id,
            owner_id=workflow.app_id,
            workflow_id=workflow.id,
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()
        queries: list[str] = []

        def capture(state: ORMExecuteState) -> None:
            if isinstance(state.statement, Select):
                queries.append(str(state.statement.compile(dialect=postgresql.dialect())))

        event.listen(sqlite_session, "do_orm_execute", capture)
        try:
            result = WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)
            sqlite_session.flush()
        finally:
            event.remove(sqlite_session, "do_orm_execute", capture)
        assert result == []
        assert "FOR UPDATE" in queries[0]
        assert sqlite_session.get(Workflow, workflow.id) is None

    def test_delete_workflow_with_ref_scopes_lookup_to_app(self, sqlite_session: Session) -> None:
        """Test delete_workflow includes the trusted app owner in the lookup."""
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        app_id = "app-789"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="other-app", workflow_id=workflow_id)
        workflow = make_workflow(workflow_id=workflow_id, tenant_id=tenant_id, app_id=app_id, version="v1")
        sqlite_session.add(workflow)
        sqlite_session.commit()

        with pytest.raises(ValueError, match="not found"):
            WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)

        assert sqlite_session.get(Workflow, workflow_id) is workflow

    def test_delete_workflow_draft_raises_error(self, sqlite_session: Session) -> None:
        """
        Test delete_workflow raises error when trying to delete draft.

        Draft workflows cannot be deleted - they're the working copy.
        Users can only delete published versions to clean up old snapshots.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="app-789", workflow_id=workflow_id)
        workflow = make_workflow(
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            app_id=workflow_ref.owner_id,
            version=Workflow.VERSION_DRAFT,
        )
        sqlite_session.add(workflow)
        sqlite_session.commit()

        with pytest.raises(DraftWorkflowDeletionError, match="Cannot delete draft workflow"):
            WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)

    def test_delete_workflow_in_use_by_app_raises_error(self, sqlite_session: Session) -> None:
        """
        Test delete_workflow raises error when workflow is in use by app.

        Cannot delete a workflow version that's currently published/active.
        This would break the app for users. Must publish a different version first.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="app-789", workflow_id=workflow_id)
        workflow = make_workflow(
            workflow_id=workflow_id, tenant_id=tenant_id, app_id=workflow_ref.owner_id, version="v1"
        )
        app = App(
            id="active-app",
            tenant_id=tenant_id,
            name="Active App",
            description="",
            mode=AppMode.WORKFLOW,
            workflow_id=workflow_id,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )
        sqlite_session.add_all([workflow, app])
        sqlite_session.commit()

        with pytest.raises(WorkflowInUseError, match="currently in use by app"):
            WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)

    def test_delete_workflow_published_as_tool_raises_error(self, sqlite_session: Session) -> None:
        """
        Test delete_workflow raises error when workflow is published as tool.

        Workflows can be published as reusable tools for other workflows.
        Cannot delete a version that's being used as a tool, as this would
        break other workflows that depend on it.
        """
        workflow_id = "workflow-123"
        tenant_id = "tenant-456"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="app-789", workflow_id=workflow_id)
        workflow = make_workflow(
            workflow_id=workflow_id, tenant_id=tenant_id, app_id=workflow_ref.owner_id, version="v1"
        )
        tool_provider = WorkflowToolProvider(
            name="workflow-tool",
            label="Workflow Tool",
            icon="icon.svg",
            app_id=workflow.app_id,
            version=workflow.version,
            user_id="user-123",
            tenant_id=workflow.tenant_id,
            description="Test provider",
            parameter_configuration="[]",
        )
        sqlite_session.add_all([workflow, tool_provider])
        sqlite_session.commit()

        with pytest.raises(WorkflowInUseError, match="published as a tool"):
            WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)

    def test_delete_workflow_not_found_raises_error(self, sqlite_session: Session) -> None:
        """Test delete_workflow raises error when workflow not found."""
        workflow_id = "nonexistent"
        tenant_id = "tenant-456"
        workflow_ref = WorkflowRef(tenant_id=tenant_id, owner_id="app-789", workflow_id=workflow_id)

        with pytest.raises(ValueError, match="not found"):
            WorkflowDefinitionStore.delete_workflow(session=sqlite_session, workflow_ref=workflow_ref)
