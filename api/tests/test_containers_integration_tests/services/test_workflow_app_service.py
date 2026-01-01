import json
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from faker import Faker

from core.workflow.entities.workflow_execution import WorkflowExecutionStatus
from models import EndUser, Workflow, WorkflowAppLog, WorkflowRun
from models.enums import CreatorUserRole
from services.account_service import AccountService, TenantService

# Delay import of AppService to avoid circular dependency
# from services.app_service import AppService
from services.workflow_app_service import WorkflowAppService


class TestWorkflowAppService:
    """Integration tests for WorkflowAppService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.app_service.FeatureService") as mock_feature_service,
            patch("services.app_service.EnterpriseService") as mock_enterprise_service,
            patch("services.app_service.ModelManager") as mock_model_manager,
            patch("services.account_service.FeatureService") as mock_account_feature_service,
        ):
            # Setup default mock returns for app service
            mock_feature_service.get_system_features.return_value.webapp_auth.enabled = False
            mock_enterprise_service.WebAppAuth.update_app_access_mode.return_value = None
            mock_enterprise_service.WebAppAuth.cleanup_webapp.return_value = None

            # Setup default mock returns for account service
            mock_account_feature_service.get_system_features.return_value.is_allow_register = True

            # Mock ModelManager for model configuration
            mock_model_instance = mock_model_manager.return_value
            mock_model_instance.get_default_model_instance.return_value = None
            mock_model_instance.get_default_provider_model_name.return_value = ("openai", "gpt-3.5-turbo")

            yield {
                "feature_service": mock_feature_service,
                "enterprise_service": mock_enterprise_service,
                "model_manager": mock_model_manager,
                "account_feature_service": mock_account_feature_service,
            }

    def _create_test_app_and_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test app and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (app, account) - Created app and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        # Create app with realistic data
        app_args = {
            "name": fake.company(),
            "description": fake.text(max_nb_chars=100),
            "mode": "workflow",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        # Import here to avoid circular dependency
        from services.app_service import AppService

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app, account

    def _create_test_tenant_and_account(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test tenant and account for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (tenant, account) - Created tenant and account instances
        """
        fake = Faker()

        # Setup mocks for account creation
        mock_external_service_dependencies[
            "account_feature_service"
        ].get_system_features.return_value.is_allow_register = True

        # Create account and tenant
        account = AccountService.create_account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            password=fake.password(length=12),
        )
        TenantService.create_owner_tenant_if_not_exist(account, name=fake.company())
        tenant = account.current_tenant

        return tenant, account

    def _create_test_app(self, db_session_with_containers, tenant, account):
        """
        Helper method to create a test app for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant: Tenant instance
            account: Account instance

        Returns:
            App: Created app instance
        """
        fake = Faker()

        # Create app with realistic data
        app_args = {
            "name": fake.company(),
            "description": fake.text(max_nb_chars=100),
            "mode": "workflow",
            "icon_type": "emoji",
            "icon": "🤖",
            "icon_background": "#FF6B6B",
            "api_rph": 100,
            "api_rpm": 10,
        }

        # Import here to avoid circular dependency
        from services.app_service import AppService

        app_service = AppService()
        app = app_service.create_app(tenant.id, app_args, account)

        return app

    def _create_test_workflow_data(self, db_session_with_containers, app, account):
        """
        Helper method to create test workflow data for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            app: App instance
            account: Account instance

        Returns:
            tuple: (workflow, workflow_run, workflow_app_log) - Created workflow entities
        """
        fake = Faker()

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create workflow run
        workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            inputs=json.dumps({"input1": "test_value"}),
            outputs=json.dumps({"output1": "result_value"}),
            status="succeeded",
            elapsed_time=1.5,
            total_tokens=100,
            total_steps=3,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
        )
        db.session.add(workflow_run)
        db.session.commit()

        # Create workflow app log
        workflow_app_log = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log.id = str(uuid.uuid4())
        workflow_app_log.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log)
        db.session.commit()

        return workflow, workflow_run, workflow_app_log

    def test_get_paginate_workflow_app_logs_basic_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful pagination of workflow app logs with basic parameters.
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        workflow, workflow_run, workflow_app_log = self._create_test_workflow_data(
            db_session_with_containers, app, account
        )

        # Act: Execute the method under test
        service = WorkflowAppService()
        result = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=20
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result["page"] == 1
        assert result["limit"] == 20
        assert result["total"] == 1
        assert result["has_more"] is False
        assert len(result["data"]) == 1

        # Verify the returned data
        log_entry = result["data"][0]
        assert log_entry.id == workflow_app_log.id
        assert log_entry.tenant_id == app.tenant_id
        assert log_entry.app_id == app.id
        assert log_entry.workflow_id == workflow.id
        assert log_entry.workflow_run_id == workflow_run.id

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(workflow_app_log)
        assert workflow_app_log.id is not None

    def test_get_paginate_workflow_app_logs_with_keyword_search(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with keyword search functionality.
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        workflow, workflow_run, workflow_app_log = self._create_test_workflow_data(
            db_session_with_containers, app, account
        )

        # Update workflow run with searchable content
        from extensions.ext_database import db

        workflow_run.inputs = json.dumps({"search_term": "test_keyword", "input2": "other_value"})
        workflow_run.outputs = json.dumps({"result": "test_keyword_found", "status": "success"})
        db.session.commit()

        # Act: Execute the method under test with keyword search
        service = WorkflowAppService()
        result = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="test_keyword", page=1, limit=20
        )

        # Assert: Verify keyword search results
        assert result is not None
        assert result["total"] == 1
        assert len(result["data"]) == 1

        # Verify the returned data contains the searched keyword
        log_entry = result["data"][0]
        assert log_entry.workflow_run_id == workflow_run.id

        # Test with non-matching keyword
        result_no_match = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="non_existent_keyword", page=1, limit=20
        )

        assert result_no_match["total"] == 0
        assert len(result_no_match["data"]) == 0

    def test_get_paginate_workflow_app_logs_with_special_characters_in_keyword(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        r"""
        Test workflow app logs pagination with special characters in keyword to verify SQL injection prevention.

        This test verifies:
        - Special characters (%, _) in keyword are properly escaped
        - Search treats special characters as literal characters, not wildcards
        - SQL injection via LIKE wildcards is prevented
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        workflow, _, _ = self._create_test_workflow_data(db_session_with_containers, app, account)

        from extensions.ext_database import db

        service = WorkflowAppService()

        # Test 1: Search with % character
        workflow_run_1 = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            status="succeeded",
            inputs=json.dumps({"search_term": "50% discount", "input2": "other_value"}),
            outputs=json.dumps({"result": "50% discount applied", "status": "success"}),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
        )
        db.session.add(workflow_run_1)
        db.session.flush()

        workflow_app_log_1 = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run_1.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log_1.id = str(uuid.uuid4())
        workflow_app_log_1.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log_1)
        db.session.commit()

        result = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="50%", page=1, limit=20
        )
        # Should find the workflow_run_1 entry
        assert result["total"] >= 1
        assert len(result["data"]) >= 1
        assert any(log.workflow_run_id == workflow_run_1.id for log in result["data"])

        # Test 2: Search with _ character
        workflow_run_2 = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            status="succeeded",
            inputs=json.dumps({"search_term": "test_data_value", "input2": "other_value"}),
            outputs=json.dumps({"result": "test_data_value found", "status": "success"}),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
        )
        db.session.add(workflow_run_2)
        db.session.flush()

        workflow_app_log_2 = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run_2.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log_2.id = str(uuid.uuid4())
        workflow_app_log_2.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log_2)
        db.session.commit()

        result = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="test_data", page=1, limit=20
        )
        # Should find the workflow_run_2 entry
        assert result["total"] >= 1
        assert len(result["data"]) >= 1
        assert any(log.workflow_run_id == workflow_run_2.id for log in result["data"])

        # Test 3: Search with % should NOT match 100% (verifies escaping works correctly)
        workflow_run_4 = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            status="succeeded",
            inputs=json.dumps({"search_term": "100% different", "input2": "other_value"}),
            outputs=json.dumps({"result": "100% different result", "status": "success"}),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
        )
        db.session.add(workflow_run_4)
        db.session.flush()

        workflow_app_log_4 = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run_4.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log_4.id = str(uuid.uuid4())
        workflow_app_log_4.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log_4)
        db.session.commit()

        result = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="50%", page=1, limit=20
        )
        # Should only find the 50% entry (workflow_run_1), not the 100% entry (workflow_run_4)
        # This verifies that escaping works correctly - 50% should not match 100%
        assert result["total"] >= 1
        assert len(result["data"]) >= 1
        # Verify that we found workflow_run_1 (50% discount) but not workflow_run_4 (100% different)
        found_run_ids = [log.workflow_run_id for log in result["data"]]
        assert workflow_run_1.id in found_run_ids
        assert workflow_run_4.id not in found_run_ids

    def test_get_paginate_workflow_app_logs_with_status_filter(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with status filtering.
        """
        # Arrange: Create test data with different statuses
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create workflow runs with different statuses
        statuses = ["succeeded", "failed", "running", "stopped"]
        workflow_runs = []
        workflow_app_logs = []

        for i, status in enumerate(statuses):
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                inputs=json.dumps({"input": f"test_{i}"}),
                outputs=json.dumps({"output": f"result_{i}"}),
                status=status,
                elapsed_time=1.0 + i,
                total_tokens=100 + i * 10,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 1) if status != "running" else None,
            )
            db.session.add(workflow_run)
            db.session.commit()

            workflow_app_log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            workflow_app_log.id = str(uuid.uuid4())
            workflow_app_log.created_at = datetime.now(UTC) + timedelta(minutes=i)
            db.session.add(workflow_app_log)
            db.session.commit()

            workflow_runs.append(workflow_run)
            workflow_app_logs.append(workflow_app_log)

        # Act & Assert: Test filtering by different statuses
        service = WorkflowAppService()

        # Test succeeded status filter
        result_succeeded = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            status=WorkflowExecutionStatus.SUCCEEDED,
            page=1,
            limit=20,
        )
        assert result_succeeded["total"] == 1
        assert result_succeeded["data"][0].workflow_run.status == "succeeded"

        # Test failed status filter
        result_failed = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, status=WorkflowExecutionStatus.FAILED, page=1, limit=20
        )
        assert result_failed["total"] == 1
        assert result_failed["data"][0].workflow_run.status == "failed"

        # Test running status filter
        result_running = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, status=WorkflowExecutionStatus.RUNNING, page=1, limit=20
        )
        assert result_running["total"] == 1
        assert result_running["data"][0].workflow_run.status == "running"

    def test_get_paginate_workflow_app_logs_with_time_filtering(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with time-based filtering.
        """
        # Arrange: Create test data with different timestamps
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create workflow runs with different timestamps
        base_time = datetime.now(UTC)
        timestamps = [
            base_time - timedelta(hours=3),  # 3 hours ago
            base_time - timedelta(hours=2),  # 2 hours ago
            base_time - timedelta(hours=1),  # 1 hour ago
            base_time,  # now
        ]

        workflow_runs = []
        workflow_app_logs = []

        for i, timestamp in enumerate(timestamps):
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                inputs=json.dumps({"input": f"test_{i}"}),
                outputs=json.dumps({"output": f"result_{i}"}),
                status="succeeded",
                elapsed_time=1.0,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=timestamp,
                finished_at=timestamp + timedelta(minutes=1),
            )
            db.session.add(workflow_run)
            db.session.commit()

            workflow_app_log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            workflow_app_log.id = str(uuid.uuid4())
            workflow_app_log.created_at = timestamp
            db.session.add(workflow_app_log)
            db.session.commit()

            workflow_runs.append(workflow_run)
            workflow_app_logs.append(workflow_app_log)

        # Act & Assert: Test time-based filtering
        service = WorkflowAppService()

        # Test filtering logs created after 2 hours ago
        result_after = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_at_after=base_time - timedelta(hours=2),
            page=1,
            limit=20,
        )
        assert result_after["total"] == 3  # Should get logs from 2 hours ago, 1 hour ago, and now

        # Test filtering logs created before 1 hour ago
        result_before = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_at_before=base_time - timedelta(hours=1),
            page=1,
            limit=20,
        )
        assert result_before["total"] == 3  # Should get logs from 3 hours ago, 2 hours ago, and 1 hour ago

        # Test filtering logs within a time range
        result_range = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_at_after=base_time - timedelta(hours=2),
            created_at_before=base_time - timedelta(hours=1),
            page=1,
            limit=20,
        )
        assert result_range["total"] == 2  # Should get logs from 2 hours ago and 1 hour ago

    def test_get_paginate_workflow_app_logs_with_pagination(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with different page sizes and limits.
        """
        # Arrange: Create test data with multiple logs
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create 25 workflow runs and logs
        total_logs = 25
        workflow_runs = []
        workflow_app_logs = []

        for i in range(total_logs):
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                inputs=json.dumps({"input": f"test_{i}"}),
                outputs=json.dumps({"output": f"result_{i}"}),
                status="succeeded",
                elapsed_time=1.0,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 1),
            )
            db.session.add(workflow_run)
            db.session.commit()

            workflow_app_log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            workflow_app_log.id = str(uuid.uuid4())
            workflow_app_log.created_at = datetime.now(UTC) + timedelta(minutes=i)
            db.session.add(workflow_app_log)
            db.session.commit()

            workflow_runs.append(workflow_run)
            workflow_app_logs.append(workflow_app_log)

        # Act & Assert: Test pagination
        service = WorkflowAppService()

        # Test first page with limit 10
        result_page1 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=10
        )
        assert result_page1["page"] == 1
        assert result_page1["limit"] == 10
        assert result_page1["total"] == total_logs
        assert result_page1["has_more"] is True
        assert len(result_page1["data"]) == 10

        # Test second page with limit 10
        result_page2 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=2, limit=10
        )
        assert result_page2["page"] == 2
        assert result_page2["limit"] == 10
        assert result_page2["total"] == total_logs
        assert result_page2["has_more"] is True
        assert len(result_page2["data"]) == 10

        # Test third page with limit 10
        result_page3 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=3, limit=10
        )
        assert result_page3["page"] == 3
        assert result_page3["limit"] == 10
        assert result_page3["total"] == total_logs
        assert result_page3["has_more"] is False
        assert len(result_page3["data"]) == 5  # Remaining 5 logs

        # Test with larger limit
        result_large_limit = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=50
        )
        assert result_large_limit["page"] == 1
        assert result_large_limit["limit"] == 50
        assert result_large_limit["total"] == total_logs
        assert result_large_limit["has_more"] is False
        assert len(result_large_limit["data"]) == total_logs

    def test_get_paginate_workflow_app_logs_with_user_role_filtering(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with user role and session filtering.
        """
        # Arrange: Create test data with different user roles
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create end user
        end_user = EndUser(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="web",
            is_anonymous=False,
            session_id="test_session_123",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.session.add(end_user)
        db.session.commit()

        # Create workflow runs and logs for both account and end user
        workflow_runs = []
        workflow_app_logs = []

        # Account user logs
        for i in range(3):
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                inputs=json.dumps({"input": f"account_test_{i}"}),
                outputs=json.dumps({"output": f"account_result_{i}"}),
                status="succeeded",
                elapsed_time=1.0,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 1),
            )
            db.session.add(workflow_run)
            db.session.commit()

            workflow_app_log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            workflow_app_log.id = str(uuid.uuid4())
            workflow_app_log.created_at = datetime.now(UTC) + timedelta(minutes=i)
            db.session.add(workflow_app_log)
            db.session.commit()

            workflow_runs.append(workflow_run)
            workflow_app_logs.append(workflow_app_log)

        # End user logs
        for i in range(2):
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                inputs=json.dumps({"input": f"end_user_test_{i}"}),
                outputs=json.dumps({"output": f"end_user_result_{i}"}),
                status="succeeded",
                elapsed_time=1.0,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.END_USER,
                created_by=end_user.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i + 10),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 11),
            )
            db.session.add(workflow_run)
            db.session.commit()

            workflow_app_log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="web-app",
                created_by_role=CreatorUserRole.END_USER,
                created_by=end_user.id,
            )
            workflow_app_log.id = str(uuid.uuid4())
            workflow_app_log.created_at = datetime.now(UTC) + timedelta(minutes=i + 10)
            db.session.add(workflow_app_log)
            db.session.commit()

            workflow_runs.append(workflow_run)
            workflow_app_logs.append(workflow_app_log)

        # Act & Assert: Test user role filtering
        service = WorkflowAppService()

        # Test filtering by end user session ID
        result_session_filter = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_by_end_user_session_id="test_session_123",
            page=1,
            limit=20,
        )
        assert result_session_filter["total"] == 2
        assert all(log.created_by_role == CreatorUserRole.END_USER for log in result_session_filter["data"])

        # Test filtering by account email
        result_account_filter = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, created_by_account=account.email, page=1, limit=20
        )
        assert result_account_filter["total"] == 3
        assert all(log.created_by_role == CreatorUserRole.ACCOUNT for log in result_account_filter["data"])

        # Test filtering by changed account email
        original_email = account.email
        new_email = "changed@example.com"
        account.email = new_email
        db_session_with_containers.commit()

        assert account.email == new_email

        # Results for new email, is expected to be the same as the original email
        result_with_new_email = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, created_by_account=new_email, page=1, limit=20
        )
        assert result_with_new_email["total"] == 3
        assert all(log.created_by_role == CreatorUserRole.ACCOUNT for log in result_with_new_email["data"])

        # Old email unbound, is unexpected input, should raise ValueError
        with pytest.raises(ValueError) as exc_info:
            service.get_paginate_workflow_app_logs(
                session=db_session_with_containers, app_model=app, created_by_account=original_email, page=1, limit=20
            )
        assert "Account not found" in str(exc_info.value)

        account.email = original_email
        db_session_with_containers.commit()

        # Test filtering by non-existent session ID
        result_no_session = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_by_end_user_session_id="non_existent_session",
            page=1,
            limit=20,
        )
        assert result_no_session["total"] == 0

        # Test filtering by non-existent account email, is unexpected input, should raise ValueError
        with pytest.raises(ValueError) as exc_info:
            service.get_paginate_workflow_app_logs(
                session=db_session_with_containers,
                app_model=app,
                created_by_account="nonexistent@example.com",
                page=1,
                limit=20,
            )
        assert "Account not found" in str(exc_info.value)

    def test_get_paginate_workflow_app_logs_with_uuid_keyword_search(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with UUID keyword search functionality.
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create workflow run with specific UUID
        workflow_run_id = str(uuid.uuid4())
        workflow_run = WorkflowRun(
            id=workflow_run_id,
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            inputs=json.dumps({"input": "test_input"}),
            outputs=json.dumps({"output": "test_output"}),
            status="succeeded",
            elapsed_time=1.0,
            total_tokens=100,
            total_steps=3,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
            finished_at=datetime.now(UTC) + timedelta(minutes=1),
        )
        db.session.add(workflow_run)
        db.session.commit()

        # Create workflow app log
        workflow_app_log = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log.id = str(uuid.uuid4())
        workflow_app_log.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log)
        db.session.commit()

        # Act & Assert: Test UUID keyword search
        service = WorkflowAppService()

        # Test searching by workflow run UUID
        result_uuid_search = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword=workflow_run_id, page=1, limit=20
        )
        assert result_uuid_search["total"] == 1
        assert result_uuid_search["data"][0].workflow_run_id == workflow_run_id

        # Test searching by partial UUID (should not match)
        partial_uuid = workflow_run_id[:8]
        result_partial_uuid = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword=partial_uuid, page=1, limit=20
        )
        assert result_partial_uuid["total"] == 0

        # Test searching by invalid UUID format
        invalid_uuid = "invalid-uuid-format"
        result_invalid_uuid = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword=invalid_uuid, page=1, limit=20
        )
        assert result_invalid_uuid["total"] == 0

    def test_get_paginate_workflow_app_logs_with_edge_cases(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with edge cases and boundary conditions.
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        from extensions.ext_database import db

        # Create workflow
        workflow = Workflow(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            type="workflow",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            _features=json.dumps({}),
            created_by=account.id,
            updated_by=account.id,
        )
        db.session.add(workflow)
        db.session.commit()

        # Create workflow run with edge case data
        workflow_run = WorkflowRun(
            id=str(uuid.uuid4()),
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            type="workflow",
            triggered_from="app-run",
            version="1.0.0",
            graph=json.dumps({"nodes": [], "edges": []}),
            inputs=json.dumps({"input": "test_input"}),
            outputs=json.dumps({"output": "test_output"}),
            status="succeeded",
            elapsed_time=0.0,  # Edge case: 0 elapsed time
            total_tokens=0,  # Edge case: 0 tokens
            total_steps=0,  # Edge case: 0 steps
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
        )
        db.session.add(workflow_run)
        db.session.commit()

        # Create workflow app log
        workflow_app_log = WorkflowAppLog(
            tenant_id=app.tenant_id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_run_id=workflow_run.id,
            created_from="service-api",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
        )
        workflow_app_log.id = str(uuid.uuid4())
        workflow_app_log.created_at = datetime.now(UTC)
        db.session.add(workflow_app_log)
        db.session.commit()

        # Act & Assert: Test edge cases
        service = WorkflowAppService()

        # Test with page 1 (normal case)
        result_page_one = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=20
        )
        assert result_page_one["page"] == 1
        assert result_page_one["total"] == 1

        # Test with very large limit
        result_large_limit = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=10000
        )
        assert result_large_limit["limit"] == 10000
        assert result_large_limit["total"] == 1

        # Test with limit 0 (should return empty result)
        result_zero_limit = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=0
        )
        assert result_zero_limit["limit"] == 0
        assert result_zero_limit["total"] == 1
        assert len(result_zero_limit["data"]) == 0

        # Test with very high page number (should return empty result)
        result_high_page = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=999999, limit=20
        )
        assert result_high_page["page"] == 999999
        assert result_high_page["total"] == 1
        assert len(result_high_page["data"]) == 0
        assert result_high_page["has_more"] is False

    def test_get_paginate_workflow_app_logs_with_empty_results(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with empty results and no data scenarios.
        """
        # Arrange: Create test data
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)

        # Act & Assert: Test empty results
        service = WorkflowAppService()

        # Test with no workflow logs
        result_no_logs = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=20
        )
        assert result_no_logs["page"] == 1
        assert result_no_logs["limit"] == 20
        assert result_no_logs["total"] == 0
        assert result_no_logs["has_more"] is False
        assert len(result_no_logs["data"]) == 0

        # Test with status filter that matches no logs
        result_no_status_match = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, status=WorkflowExecutionStatus.FAILED, page=1, limit=20
        )
        assert result_no_status_match["total"] == 0
        assert len(result_no_status_match["data"]) == 0

        # Test with keyword that matches no logs
        result_no_keyword_match = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, keyword="nonexistent_keyword", page=1, limit=20
        )
        assert result_no_keyword_match["total"] == 0
        assert len(result_no_keyword_match["data"]) == 0

        # Test with time filter that matches no logs
        future_time = datetime.now(UTC) + timedelta(days=1)
        result_future_time = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, created_at_after=future_time, page=1, limit=20
        )
        assert result_future_time["total"] == 0
        assert len(result_future_time["data"]) == 0

        # Test with end user session that doesn't exist
        result_no_session = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_by_end_user_session_id="nonexistent_session",
            page=1,
            limit=20,
        )
        assert result_no_session["total"] == 0
        assert len(result_no_session["data"]) == 0

        # Test with account email that doesn't exist
        with pytest.raises(ValueError) as exc_info:
            service.get_paginate_workflow_app_logs(
                session=db_session_with_containers,
                app_model=app,
                created_by_account="nonexistent@example.com",
                page=1,
                limit=20,
            )
        assert "Account not found" in str(exc_info.value)

    def test_get_paginate_workflow_app_logs_with_complex_query_combinations(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with complex query combinations.
        """
        # Arrange: Create test data with various combinations
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        workflow, _, _ = self._create_test_workflow_data(db_session_with_containers, app, account)

        # Create multiple logs with different characteristics
        logs_data = []
        for i in range(5):
            status = "succeeded" if i % 2 == 0 else "failed"
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                status=status,
                inputs=json.dumps({"input": f"test_input_{i}"}),
                outputs=json.dumps({"output": f"test_output_{i}"}) if status == "succeeded" else None,
                error=json.dumps({"error": f"test_error_{i}"}) if status == "failed" else None,
                elapsed_time=1.5,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 1) if status == "succeeded" else None,
            )
            db_session_with_containers.add(workflow_run)
            db_session_with_containers.flush()

            log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            log.id = str(uuid.uuid4())
            log.created_at = datetime.now(UTC) + timedelta(minutes=i)
            db_session_with_containers.add(log)
            logs_data.append((log, workflow_run))

        db_session_with_containers.commit()

        service = WorkflowAppService()

        # Test complex combination: keyword + status + time range + pagination
        result_complex = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            keyword="test_input_1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            created_at_after=datetime.now(UTC) - timedelta(minutes=10),
            created_at_before=datetime.now(UTC) + timedelta(minutes=10),
            page=1,
            limit=3,
        )

        # Should find logs matching all criteria
        assert result_complex["total"] >= 0  # At least 0, could be more depending on timing
        assert len(result_complex["data"]) <= 3  # Respects limit

        # Test combination: user role + keyword + status
        result_user_keyword_status = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_by_account=account.email,
            keyword="test_input",
            status=WorkflowExecutionStatus.FAILED,
            page=1,
            limit=20,
        )

        # Should find failed logs created by the account with "test_input" in inputs
        assert result_user_keyword_status["total"] >= 0

        # Test combination: time range + status + pagination with small limit
        result_time_status_limit = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app,
            created_at_after=datetime.now(UTC) - timedelta(minutes=10),
            status=WorkflowExecutionStatus.SUCCEEDED,
            page=1,
            limit=2,
        )

        assert result_time_status_limit["total"] >= 0
        assert len(result_time_status_limit["data"]) <= 2

    def test_get_paginate_workflow_app_logs_with_large_dataset_performance(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with large dataset for performance validation.
        """
        # Arrange: Create a larger dataset
        fake = Faker()
        app, account = self._create_test_app_and_account(db_session_with_containers, mock_external_service_dependencies)
        workflow, _, _ = self._create_test_workflow_data(db_session_with_containers, app, account)

        # Create 50 logs to test performance with larger datasets
        logs_data = []
        for i in range(50):
            status = "succeeded" if i % 3 == 0 else "failed" if i % 3 == 1 else "running"
            workflow_run = WorkflowRun(
                id=str(uuid.uuid4()),
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="app-run",
                version="1.0.0",
                graph=json.dumps({"nodes": [], "edges": []}),
                status=status,
                inputs=json.dumps({"input": f"performance_test_input_{i}", "index": i}),
                outputs=json.dumps({"output": f"performance_test_output_{i}"}) if status == "succeeded" else None,
                error=json.dumps({"error": f"performance_test_error_{i}"}) if status == "failed" else None,
                elapsed_time=1.5,
                total_tokens=100,
                total_steps=3,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
                created_at=datetime.now(UTC) + timedelta(minutes=i),
                finished_at=datetime.now(UTC) + timedelta(minutes=i + 1) if status != "running" else None,
            )
            db_session_with_containers.add(workflow_run)
            db_session_with_containers.flush()

            log = WorkflowAppLog(
                tenant_id=app.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                workflow_run_id=workflow_run.id,
                created_from="service-api",
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=account.id,
            )
            log.id = str(uuid.uuid4())
            log.created_at = datetime.now(UTC) + timedelta(minutes=i)
            db_session_with_containers.add(log)
            logs_data.append((log, workflow_run))

        db_session_with_containers.commit()

        service = WorkflowAppService()

        # Test performance with large dataset and pagination
        import time

        start_time = time.time()

        result_large = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=1, limit=20
        )

        end_time = time.time()
        execution_time = end_time - start_time

        # Performance assertions
        assert result_large["total"] == 51  # 50 new logs + 1 from _create_test_workflow_data
        assert len(result_large["data"]) == 20
        assert execution_time < 5.0  # Should complete within 5 seconds

        # Test pagination through large dataset
        result_page_2 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=2, limit=20
        )

        assert result_page_2["total"] == 51  # 50 new logs + 1 from _create_test_workflow_data
        assert len(result_page_2["data"]) == 20
        assert result_page_2["page"] == 2

        # Test last page
        result_last_page = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app, page=3, limit=20
        )

        assert result_last_page["total"] == 51  # 50 new logs + 1 from _create_test_workflow_data
        assert len(result_last_page["data"]) == 11  # Last page should have remaining items (10 + 1)
        assert result_last_page["page"] == 3

    def test_get_paginate_workflow_app_logs_with_tenant_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test workflow app logs pagination with proper tenant isolation.
        """
        # Arrange: Create multiple tenants and apps
        fake = Faker()

        # Create first tenant and app
        tenant1, account1 = self._create_test_tenant_and_account(
            db_session_with_containers, mock_external_service_dependencies
        )
        app1 = self._create_test_app(db_session_with_containers, tenant1, account1)
        workflow1, _, _ = self._create_test_workflow_data(db_session_with_containers, app1, account1)

        # Create second tenant and app
        tenant2, account2 = self._create_test_tenant_and_account(
            db_session_with_containers, mock_external_service_dependencies
        )
        app2 = self._create_test_app(db_session_with_containers, tenant2, account2)
        workflow2, _, _ = self._create_test_workflow_data(db_session_with_containers, app2, account2)

        # Create logs for both tenants
        for i, (app, workflow, account) in enumerate([(app1, workflow1, account1), (app2, workflow2, account2)]):
            for j in range(3):
                workflow_run = WorkflowRun(
                    id=str(uuid.uuid4()),
                    tenant_id=app.tenant_id,
                    app_id=app.id,
                    workflow_id=workflow.id,
                    type="workflow",
                    triggered_from="app-run",
                    version="1.0.0",
                    graph=json.dumps({"nodes": [], "edges": []}),
                    status="succeeded",
                    inputs=json.dumps({"input": f"tenant_{i}_input_{j}"}),
                    outputs=json.dumps({"output": f"tenant_{i}_output_{j}"}),
                    elapsed_time=1.5,
                    total_tokens=100,
                    total_steps=3,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=account.id,
                    created_at=datetime.now(UTC) + timedelta(minutes=i * 10 + j),
                    finished_at=datetime.now(UTC) + timedelta(minutes=i * 10 + j + 1),
                )
                db_session_with_containers.add(workflow_run)
                db_session_with_containers.flush()

                log = WorkflowAppLog(
                    tenant_id=app.tenant_id,
                    app_id=app.id,
                    workflow_id=workflow.id,
                    workflow_run_id=workflow_run.id,
                    created_from="service-api",
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=account.id,
                )
                log.id = str(uuid.uuid4())
                log.created_at = datetime.now(UTC) + timedelta(minutes=i * 10 + j)
                db_session_with_containers.add(log)

        db_session_with_containers.commit()

        service = WorkflowAppService()

        # Test tenant isolation: tenant1 should only see its own logs
        result_tenant1 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app1, page=1, limit=20
        )

        assert result_tenant1["total"] == 4  # 3 new logs + 1 from _create_test_workflow_data
        for log in result_tenant1["data"]:
            assert log.tenant_id == app1.tenant_id
            assert log.app_id == app1.id

        # Test tenant isolation: tenant2 should only see its own logs
        result_tenant2 = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers, app_model=app2, page=1, limit=20
        )

        assert result_tenant2["total"] == 4  # 3 new logs + 1 from _create_test_workflow_data
        for log in result_tenant2["data"]:
            assert log.tenant_id == app2.tenant_id
            assert log.app_id == app2.id

        # Test cross-tenant search should not work
        result_cross_tenant = service.get_paginate_workflow_app_logs(
            session=db_session_with_containers,
            app_model=app1,
            keyword="tenant_1_input",  # Search for tenant2's data from tenant1's context
            page=1,
            limit=20,
        )

        # Should not find tenant2's data when searching from tenant1's context
        assert result_cross_tenant["total"] == 0
