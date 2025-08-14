import uuid

import pytest
from sqlalchemy import delete

from core.variables.segments import StringSegment
from models import Tenant, db
from models.model import App
from models.workflow import WorkflowDraftVariable
from tasks.remove_app_and_related_data_task import _delete_draft_variables, delete_draft_variables_batch


@pytest.fixture
def app_and_tenant(flask_req_ctx):
    tenant_id = uuid.uuid4()
    tenant = Tenant(
        id=tenant_id,
        name="test_tenant",
    )
    db.session.add(tenant)

    app = App(
        tenant_id=tenant_id,  # Now tenant.id will have a value
        name=f"Test App for tenant {tenant.id}",
        mode="workflow",
        enable_site=True,
        enable_api=True,
    )
    db.session.add(app)
    db.session.flush()
    yield (tenant, app)

    # Cleanup with proper error handling
    db.session.delete(app)
    db.session.delete(tenant)


class TestDeleteDraftVariablesIntegration:
    @pytest.fixture
    def setup_test_data(self, app_and_tenant):
        """Create test data with apps and draft variables."""
        tenant, app = app_and_tenant

        # Create a second app for testing
        app2 = App(
            tenant_id=tenant.id,
            name="Test App 2",
            mode="workflow",
            enable_site=True,
            enable_api=True,
        )
        db.session.add(app2)
        db.session.commit()

        # Create draft variables for both apps
        variables_app1 = []
        variables_app2 = []

        for i in range(5):
            var1 = WorkflowDraftVariable.new_node_variable(
                app_id=app.id,
                node_id=f"node_{i}",
                name=f"var_{i}",
                value=StringSegment(value="test_value"),
                node_execution_id=str(uuid.uuid4()),
            )
            db.session.add(var1)
            variables_app1.append(var1)

            var2 = WorkflowDraftVariable.new_node_variable(
                app_id=app2.id,
                node_id=f"node_{i}",
                name=f"var_{i}",
                value=StringSegment(value="test_value"),
                node_execution_id=str(uuid.uuid4()),
            )
            db.session.add(var2)
            variables_app2.append(var2)

        # Commit all the variables to the database
        db.session.commit()

        yield {
            "app1": app,
            "app2": app2,
            "tenant": tenant,
            "variables_app1": variables_app1,
            "variables_app2": variables_app2,
        }

        # Cleanup - refresh session and check if objects still exist
        db.session.rollback()  # Clear any pending changes

        # Clean up remaining variables
        cleanup_query = (
            delete(WorkflowDraftVariable)
            .where(
                WorkflowDraftVariable.app_id.in_([app.id, app2.id]),
            )
            .execution_options(synchronize_session=False)
        )
        db.session.execute(cleanup_query)

        # Clean up app2
        app2_obj = db.session.get(App, app2.id)
        if app2_obj:
            db.session.delete(app2_obj)

        db.session.commit()

    def test_delete_draft_variables_batch_removes_correct_variables(self, setup_test_data):
        """Test that batch deletion only removes variables for the specified app."""
        data = setup_test_data
        app1_id = data["app1"].id
        app2_id = data["app2"].id

        # Verify initial state
        app1_vars_before = db.session.query(WorkflowDraftVariable).filter_by(app_id=app1_id).count()
        app2_vars_before = db.session.query(WorkflowDraftVariable).filter_by(app_id=app2_id).count()
        assert app1_vars_before == 5
        assert app2_vars_before == 5

        # Delete app1 variables
        deleted_count = delete_draft_variables_batch(app1_id, batch_size=10)

        # Verify results
        assert deleted_count == 5

        app1_vars_after = db.session.query(WorkflowDraftVariable).filter_by(app_id=app1_id).count()
        app2_vars_after = db.session.query(WorkflowDraftVariable).filter_by(app_id=app2_id).count()

        assert app1_vars_after == 0  # All app1 variables deleted
        assert app2_vars_after == 5  # App2 variables unchanged

    def test_delete_draft_variables_batch_with_small_batch_size(self, setup_test_data):
        """Test batch deletion with small batch size processes all records."""
        data = setup_test_data
        app1_id = data["app1"].id

        # Use small batch size to force multiple batches
        deleted_count = delete_draft_variables_batch(app1_id, batch_size=2)

        assert deleted_count == 5

        # Verify all variables are deleted
        remaining_vars = db.session.query(WorkflowDraftVariable).filter_by(app_id=app1_id).count()
        assert remaining_vars == 0

    def test_delete_draft_variables_batch_nonexistent_app(self, setup_test_data):
        """Test that deleting variables for nonexistent app returns 0."""
        nonexistent_app_id = str(uuid.uuid4())  # Use a valid UUID format

        deleted_count = delete_draft_variables_batch(nonexistent_app_id, batch_size=100)

        assert deleted_count == 0

    def test_delete_draft_variables_wrapper_function(self, setup_test_data):
        """Test that _delete_draft_variables wrapper function works correctly."""
        data = setup_test_data
        app1_id = data["app1"].id

        # Verify initial state
        vars_before = db.session.query(WorkflowDraftVariable).filter_by(app_id=app1_id).count()
        assert vars_before == 5

        # Call wrapper function
        deleted_count = _delete_draft_variables(app1_id)

        # Verify results
        assert deleted_count == 5

        vars_after = db.session.query(WorkflowDraftVariable).filter_by(app_id=app1_id).count()
        assert vars_after == 0

    def test_batch_deletion_handles_large_dataset(self, app_and_tenant):
        """Test batch deletion with larger dataset to verify batching logic."""
        tenant, app = app_and_tenant

        # Create many draft variables
        variables = []
        for i in range(25):
            var = WorkflowDraftVariable.new_node_variable(
                app_id=app.id,
                node_id=f"node_{i}",
                name=f"var_{i}",
                value=StringSegment(value="test_value"),
                node_execution_id=str(uuid.uuid4()),
            )
            db.session.add(var)
            variables.append(var)
        variable_ids = [i.id for i in variables]

        # Commit the variables to the database
        db.session.commit()

        try:
            # Use small batch size to force multiple batches
            deleted_count = delete_draft_variables_batch(app.id, batch_size=8)

            assert deleted_count == 25

            # Verify all variables are deleted
            remaining_vars = db.session.query(WorkflowDraftVariable).filter_by(app_id=app.id).count()
            assert remaining_vars == 0

        finally:
            query = (
                delete(WorkflowDraftVariable)
                .where(
                    WorkflowDraftVariable.id.in_(variable_ids),
                )
                .execution_options(synchronize_session=False)
            )
            db.session.execute(query)
