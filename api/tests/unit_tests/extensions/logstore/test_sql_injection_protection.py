"""
Integration tests for SQL injection protection in LogStore repositories.

These tests verify that all LogStore repository methods properly escape
user inputs to prevent SQL injection attacks, with focus on cross-tenant
access prevention in SAAS scenarios.
"""

from unittest.mock import Mock

import pytest

from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_run_repository import (
    LogstoreAPIWorkflowRunRepository,
)
from models.enums import WorkflowRunTriggeredFrom


class TestLogstoreAPIWorkflowRunRepositorySQLInjection:
    """Test SQL injection protection in LogstoreAPIWorkflowRunRepository."""

    @pytest.fixture
    def mock_logstore_client(self):
        """Create a mock LogStore client that captures SQL queries."""
        mock_client = Mock(spec=AliyunLogStore)
        mock_client.supports_pg_protocol = True

        # Store executed queries for inspection
        mock_client.executed_queries = []

        def capture_execute_sql(sql, logstore, **kwargs):
            mock_client.executed_queries.append(sql)
            return []  # Return empty results

        mock_client.execute_sql = Mock(side_effect=capture_execute_sql)
        return mock_client

    @pytest.fixture
    def repository(self, mock_logstore_client):
        """Create repository with mocked LogStore client."""
        repo = LogstoreAPIWorkflowRunRepository()
        repo.logstore_client = mock_logstore_client
        return repo

    # === get_workflow_run_by_id Tests ===

    def test_get_workflow_run_by_id_prevents_injection(self, repository, mock_logstore_client):
        """Test that get_workflow_run_by_id escapes malicious inputs."""
        # Attempt SQL injection through run_id
        malicious_run_id = "run123' OR '1'='1"
        malicious_tenant_id = "tenant' UNION SELECT"
        malicious_app_id = "app' --"

        repository.get_workflow_run_by_id(
            tenant_id=malicious_tenant_id,
            app_id=malicious_app_id,
            run_id=malicious_run_id,
        )

        # Check the executed SQL
        assert len(mock_logstore_client.executed_queries) == 1
        sql = mock_logstore_client.executed_queries[0]

        # Verify all inputs are escaped
        assert "run123'' OR ''1''=''1" in sql
        assert "tenant'' UNION SELECT" in sql
        assert "app'' --" in sql

        # Verify SQL structure is maintained
        assert "WHERE id = " in sql
        assert "AND tenant_id = " in sql
        assert "AND app_id = " in sql

    def test_get_workflow_run_by_id_cross_tenant_attempt(self, repository, mock_logstore_client):
        """Test prevention of cross-tenant access via run_id injection."""
        # Attacker tries to access another tenant's data
        run_id = "run1"
        tenant_id = "tenant_a' OR tenant_id='tenant_b"
        app_id = "app1"

        repository.get_workflow_run_by_id(
            tenant_id=tenant_id,
            app_id=app_id,
            run_id=run_id,
        )

        sql = mock_logstore_client.executed_queries[0]

        # The OR condition is escaped and becomes part of the string
        assert "tenant_a'' OR tenant_id=''tenant_b" in sql

        # The injection attempt is neutralized - tenant_id appears in WHERE clause
        # and also inside the escaped string literal
        assert "WHERE id = " in sql
        assert "AND tenant_id = " in sql

    # === get_workflow_run_by_id_without_tenant Tests ===

    def test_get_workflow_run_by_id_without_tenant_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention when querying without tenant filter."""
        malicious_run_id = "run' UNION SELECT password FROM users--"

        repository.get_workflow_run_by_id_without_tenant(run_id=malicious_run_id)

        sql = mock_logstore_client.executed_queries[0]

        # UNION attack is escaped
        assert "run'' UNION SELECT password FROM users--" in sql

        # SQL structure remains intact
        assert "WHERE id = " in sql

    # === get_paginated_workflow_runs Tests ===

    def test_get_paginated_workflow_runs_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in paginated queries."""
        malicious_tenant_id = "tenant' OR '1'='1"
        malicious_app_id = "app' OR app_id LIKE '%"
        malicious_status = "running' OR status='succeeded"

        repository.get_paginated_workflow_runs(
            tenant_id=malicious_tenant_id,
            app_id=malicious_app_id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
            status=malicious_status,
            limit=20,
        )

        sql = mock_logstore_client.executed_queries[0]

        # All parameters are escaped
        assert "tenant'' OR ''1''=''1" in sql
        assert "app'' OR app_id LIKE ''%" in sql
        assert "running'' OR status=''succeeded" in sql

    def test_get_paginated_workflow_runs_multiple_triggered_from(self, repository, mock_logstore_client):
        """Test SQL injection with multiple triggered_from values."""
        repository.get_paginated_workflow_runs(
            tenant_id="tenant1",
            app_id="app1",
            triggered_from=[WorkflowRunTriggeredFrom.DEBUGGING, WorkflowRunTriggeredFrom.APP_RUN],
            limit=10,
        )

        sql = mock_logstore_client.executed_queries[0]

        # Verify triggered_from values are properly escaped
        assert "triggered_from=" in sql
        assert " OR " in sql  # Multiple values joined with OR

    # === get_workflow_runs_count Tests ===

    def test_get_workflow_runs_count_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in count queries."""
        malicious_tenant_id = "tenant' UNION SELECT COUNT(*) FROM users--"
        malicious_triggered_from = "debug' OR '1'='1"

        repository.get_workflow_runs_count(
            tenant_id=malicious_tenant_id,
            app_id="app1",
            triggered_from=malicious_triggered_from,
            status="running",
        )

        sql = mock_logstore_client.executed_queries[0]

        # UNION attack is escaped
        assert "tenant'' UNION SELECT COUNT(*) FROM users--" in sql
        assert "debug'' OR ''1''=''1" in sql

    def test_get_workflow_runs_count_status_injection(self, repository, mock_logstore_client):
        """Test status parameter injection prevention."""
        malicious_status = "running' OR status IN ('succeeded', 'failed"

        repository.get_workflow_runs_count(
            tenant_id="tenant1",
            app_id="app1",
            triggered_from="debugging",
            status=malicious_status,
        )

        sql = mock_logstore_client.executed_queries[0]

        # Status injection is escaped
        assert "running'' OR status IN (''succeeded'', ''failed" in sql

    # === Statistics Methods Tests ===

    def test_get_daily_runs_statistics_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in daily statistics."""
        from datetime import datetime

        malicious_tenant_id = "tenant' OR COUNT(*)>0--"

        repository.get_daily_runs_statistics(
            tenant_id=malicious_tenant_id,
            app_id="app1",
            triggered_from="api",
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 12, 31),
        )

        sql = mock_logstore_client.executed_queries[0]

        # Injection attempt is escaped
        assert "tenant'' OR COUNT(*)>0--" in sql

    def test_get_daily_terminals_statistics_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in terminal statistics."""
        from datetime import datetime

        repository.get_daily_terminals_statistics(
            tenant_id="tenant' UNION",
            app_id="app' SELECT",
            triggered_from="api' OR",
            start_date=datetime(2024, 1, 1),
        )

        sql = mock_logstore_client.executed_queries[0]

        # All parameters escaped
        assert "tenant'' UNION" in sql
        assert "app'' SELECT" in sql
        assert "api'' OR" in sql

    def test_get_daily_token_cost_statistics_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in token cost statistics."""
        repository.get_daily_token_cost_statistics(
            tenant_id="tenant' OR SUM(total_tokens)>0",
            app_id="app1",
            triggered_from="api",
        )

        sql = mock_logstore_client.executed_queries[0]
        assert "tenant'' OR SUM(total_tokens)>0" in sql

    def test_get_average_app_interaction_statistics_prevents_injection(self, repository, mock_logstore_client):
        """Test SQL injection prevention in interaction statistics."""
        repository.get_average_app_interaction_statistics(
            tenant_id="tenant' OR AVG(*)>0",
            app_id="app1",
            triggered_from="api",
        )

        sql = mock_logstore_client.executed_queries[0]
        assert "tenant'' OR AVG(*)>0" in sql

    # === Real-world Attack Scenarios ===

    def test_saas_cross_tenant_attack_scenario(self, repository, mock_logstore_client):
        """Test realistic SAAS cross-tenant attack scenario."""
        # Scenario: Tenant A tries to access Tenant B's data by manipulating tenant_id
        attacker_tenant_id = "tenant_a' OR tenant_id='tenant_b' OR tenant_id='tenant_c"

        repository.get_paginated_workflow_runs(
            tenant_id=attacker_tenant_id,
            app_id="app1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            limit=100,
        )

        sql = mock_logstore_client.executed_queries[0]

        # Attack is neutralized - all quotes are escaped
        assert "tenant_a'' OR tenant_id=''tenant_b'' OR tenant_id=''tenant_c" in sql

        # Query will look for literal string, returning no results
        assert sql.count("WHERE") >= 1

    def test_bypass_app_isolation_attempt(self, repository, mock_logstore_client):
        """Test attempt to bypass app isolation."""
        # Attacker tries to see data from multiple apps
        attacker_app_id = "app1' OR app_id IN ('app2', 'app3"

        repository.get_workflow_runs_count(
            tenant_id="tenant1",
            app_id=attacker_app_id,
            triggered_from="api",
        )

        sql = mock_logstore_client.executed_queries[0]

        # IN clause is escaped
        assert "app1'' OR app_id IN (''app2'', ''app3" in sql

    def test_status_filter_bypass_attempt(self, repository, mock_logstore_client):
        """Test attempt to bypass status filters."""
        # Attacker wants to see all statuses, not just running
        attacker_status = "running' OR status LIKE '%"

        repository.get_workflow_runs_count(
            tenant_id="tenant1",
            app_id="app1",
            triggered_from="api",
            status=attacker_status,
        )

        sql = mock_logstore_client.executed_queries[0]

        # LIKE wildcard is escaped
        assert "running'' OR status LIKE ''%" in sql

    @pytest.mark.parametrize(
        ("attack_scenario", "field", "malicious_value"),
        [
            ("Boolean injection", "tenant_id", "t' OR '1'='1"),
            ("Union injection", "app_id", "a' UNION SELECT * FROM users--"),
            ("Comment injection", "run_id", "r' --"),
            ("Stacked queries", "tenant_id", "t'; DROP TABLE workflow_runs; --"),
            ("Wildcard injection", "status", "s' OR status LIKE '%"),
            ("Time-based blind", "tenant_id", "t' AND SLEEP(5)--"),
        ],
    )
    def test_various_injection_attacks(self, repository, mock_logstore_client, attack_scenario, field, malicious_value):
        """Parametrized test for various injection attack patterns."""
        # Construct a query with the malicious value
        kwargs = {
            "tenant_id": "tenant1",
            "app_id": "app1",
        }

        if field == "run_id":
            kwargs["run_id"] = malicious_value
            repository.get_workflow_run_by_id(**kwargs)
        else:
            if field == "tenant_id":
                kwargs["tenant_id"] = malicious_value
            elif field == "app_id":
                kwargs["app_id"] = malicious_value
            elif field == "status":
                kwargs["status"] = malicious_value

            kwargs["triggered_from"] = "api"
            repository.get_workflow_runs_count(**kwargs)

        # Verify SQL was executed and quotes are escaped
        assert len(mock_logstore_client.executed_queries) > 0
        sql = mock_logstore_client.executed_queries[0]

        # Count single quotes in malicious value
        quote_count = malicious_value.count("'")
        # Each quote should be doubled in the SQL
        assert sql.count("''") >= quote_count


class TestLogStoreSDKModeInjectionProtection:
    """Test SQL injection protection for SDK mode (non-PG protocol)."""

    @pytest.fixture
    def mock_sdk_client(self):
        """Create a mock LogStore client in SDK mode."""
        mock_client = Mock(spec=AliyunLogStore)
        mock_client.supports_pg_protocol = False  # SDK mode

        mock_client.executed_queries = []

        def capture_get_logs(logstore, query, **kwargs):
            mock_client.executed_queries.append(query)
            return []

        mock_client.get_logs = Mock(side_effect=capture_get_logs)
        return mock_client

    @pytest.fixture
    def sdk_repository(self, mock_sdk_client):
        """Create repository using SDK mode."""
        repo = LogstoreAPIWorkflowRunRepository()
        repo.logstore_client = mock_sdk_client
        return repo

    def test_sdk_mode_query_syntax_or_injection(self, sdk_repository, mock_sdk_client):
        """Test that SDK mode prevents OR-based cross-tenant injection."""
        # Attempt to inject 'or' to access other tenants
        malicious_tenant_id = "tenant_a or tenant_id:tenant_b"

        sdk_repository.get_workflow_run_by_id(
            tenant_id=malicious_tenant_id,
            app_id="app1",
            run_id="run123",
        )

        # Check LogStore query syntax
        query = mock_sdk_client.executed_queries[0]

        # Verify the query structure uses double quotes
        assert 'tenant_id:"tenant_a or tenant_id:tenant_b"' in query
        # The 'or' should be inside quotes (treated as literal)
        assert query.count(":") >= 3  # id:, tenant_id:, app_id:

    def test_sdk_mode_query_syntax_and_injection(self, sdk_repository, mock_sdk_client):
        """Test that SDK mode prevents AND-based injection."""
        # Attempt to inject 'and' condition
        malicious_app_id = "app1 and (app_id:app2 or app_id:app3)"

        sdk_repository.get_workflow_run_by_id(
            tenant_id="tenant1",
            app_id=malicious_app_id,
            run_id="run123",
        )

        query = mock_sdk_client.executed_queries[0]

        # Verify parentheses and 'and'/'or' are quoted (literals)
        assert 'app_id:"app1 and (app_id:app2 or app_id:app3)"' in query

    def test_sdk_mode_query_syntax_colon_injection(self, sdk_repository, mock_sdk_client):
        """Test that SDK mode prevents colon-based field injection."""
        # Attempt to inject additional field conditions via colon
        malicious_run_id = "run123 and tenant_id:evil_tenant"

        sdk_repository.get_workflow_run_by_id(
            tenant_id="tenant1",
            app_id="app1",
            run_id=malicious_run_id,
        )

        query = mock_sdk_client.executed_queries[0]

        # The malicious colon should be inside quotes (literal)
        assert 'id:"run123 and tenant_id:evil_tenant"' in query
        # Verify the overall query structure is correct
        # Should be: id:"..." and tenant_id:"..." and app_id:"..."
        assert query.startswith('id:"')
        assert ' and tenant_id:"tenant1"' in query
        assert ' and app_id:"app1"' in query
