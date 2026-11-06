"""
Unit tests for SQL escape utility functions.

These tests ensure that SQL injection attacks are properly prevented
in LogStore queries, particularly for cross-tenant access scenarios.
"""

import pytest

from extensions.logstore.sql_escape import escape_identifier, escape_sql_string


class TestEscapeSQLString:
    """Test escape_sql_string function."""

    def test_escape_empty_string(self):
        """Test escaping empty string."""
        assert escape_sql_string("") == ""

    def test_escape_normal_string(self):
        """Test escaping string without special characters."""
        assert escape_sql_string("tenant_abc123") == "tenant_abc123"
        assert escape_sql_string("app-uuid-1234") == "app-uuid-1234"

    def test_escape_single_quote(self):
        """Test escaping single quote."""
        # Single quote should be doubled
        assert escape_sql_string("tenant'id") == "tenant''id"
        assert escape_sql_string("O'Reilly") == "O''Reilly"

    def test_escape_multiple_quotes(self):
        """Test escaping multiple single quotes."""
        assert escape_sql_string("a'b'c") == "a''b''c"
        assert escape_sql_string("'''") == "''''''"

    # === SQL Injection Attack Scenarios ===

    def test_prevent_boolean_injection(self):
        """Test prevention of boolean injection attacks."""
        # Classic OR 1=1 attack
        malicious_input = "tenant' OR '1'='1"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant'' OR ''1''=''1"

        # When used in SQL, this becomes a safe string literal
        sql = f"WHERE tenant_id='{escaped}'"
        assert sql == "WHERE tenant_id='tenant'' OR ''1''=''1'"
        # The entire input is now a string literal that won't match any tenant

    def test_prevent_or_injection(self):
        """Test prevention of OR-based injection."""
        malicious_input = "tenant_a' OR tenant_id='tenant_b"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant_a'' OR tenant_id=''tenant_b"

        sql = f"WHERE tenant_id='{escaped}'"
        # The OR is now part of the string literal, not SQL logic
        assert "OR tenant_id=" in sql
        # The SQL has: opening ', doubled internal quotes '', and closing '
        assert sql == "WHERE tenant_id='tenant_a'' OR tenant_id=''tenant_b'"

    def test_prevent_union_injection(self):
        """Test prevention of UNION-based injection."""
        malicious_input = "xxx' UNION SELECT password FROM users WHERE '1'='1"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "xxx'' UNION SELECT password FROM users WHERE ''1''=''1"

        # UNION becomes part of the string literal
        assert "UNION" in escaped
        assert escaped.count("''") == 4  # All internal quotes are doubled

    def test_prevent_comment_injection(self):
        """Test prevention of comment-based injection."""
        # SQL comment to bypass remaining conditions
        malicious_input = "tenant' --"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant'' --"

        sql = f"WHERE tenant_id='{escaped}' AND deleted=false"
        # The -- is now inside the string, not a SQL comment
        assert "--" in sql
        assert "AND deleted=false" in sql  # This part is NOT commented out

    def test_prevent_semicolon_injection(self):
        """Test prevention of semicolon-based multi-statement injection."""
        malicious_input = "tenant'; DROP TABLE users; --"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant''; DROP TABLE users; --"

        # Semicolons and DROP are now part of the string
        assert "DROP TABLE" in escaped

    def test_prevent_time_based_blind_injection(self):
        """Test prevention of time-based blind SQL injection."""
        malicious_input = "tenant' AND SLEEP(5) --"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant'' AND SLEEP(5) --"

        # SLEEP becomes part of the string
        assert "SLEEP" in escaped

    def test_prevent_wildcard_injection(self):
        """Test prevention of wildcard-based injection."""
        malicious_input = "tenant' OR tenant_id LIKE '%"
        escaped = escape_sql_string(malicious_input)
        assert escaped == "tenant'' OR tenant_id LIKE ''%"

        # The LIKE and wildcard are now part of the string
        assert "LIKE" in escaped

    def test_prevent_null_byte_injection(self):
        """Test handling of null bytes."""
        # Null bytes can sometimes bypass filters
        malicious_input = "tenant\x00' OR '1'='1"
        escaped = escape_sql_string(malicious_input)
        # Null byte is preserved, but quote is escaped
        assert "''1''=''1" in escaped

    # === Real-world SAAS Scenarios ===

    def test_cross_tenant_access_attempt(self):
        """Test prevention of cross-tenant data access."""
        # Attacker tries to access another tenant's data
        attacker_input = "tenant_b' OR tenant_id='tenant_a"
        escaped = escape_sql_string(attacker_input)

        sql = f"SELECT * FROM workflow_runs WHERE tenant_id='{escaped}'"
        # The query will look for a tenant literally named "tenant_b' OR tenant_id='tenant_a"
        # which doesn't exist - preventing access to either tenant's data
        assert "tenant_b'' OR tenant_id=''tenant_a" in sql

    def test_cross_app_access_attempt(self):
        """Test prevention of cross-application data access."""
        attacker_input = "app1' OR app_id='app2"
        escaped = escape_sql_string(attacker_input)

        sql = f"WHERE app_id='{escaped}'"
        # Cannot access app2's data
        assert "app1'' OR app_id=''app2" in sql

    def test_bypass_status_filter(self):
        """Test prevention of bypassing status filters."""
        # Try to see all statuses instead of just 'running'
        attacker_input = "running' OR status LIKE '%"
        escaped = escape_sql_string(attacker_input)

        sql = f"WHERE status='{escaped}'"
        # Status condition is not bypassed
        assert "running'' OR status LIKE ''%" in sql

    # === Edge Cases ===

    def test_escape_only_quotes(self):
        """Test string with only quotes."""
        assert escape_sql_string("'") == "''"
        assert escape_sql_string("''") == "''''"

    def test_escape_mixed_content(self):
        """Test string with mixed quotes and other chars."""
        input_str = "It's a 'test' of O'Reilly's code"
        escaped = escape_sql_string(input_str)
        assert escaped == "It''s a ''test'' of O''Reilly''s code"

    def test_escape_unicode_with_quotes(self):
        """Test Unicode strings with quotes."""
        input_str = "租户' OR '1'='1"
        escaped = escape_sql_string(input_str)
        assert escaped == "租户'' OR ''1''=''1"


class TestEscapeIdentifier:
    """Test escape_identifier function."""

    def test_escape_uuid(self):
        """Test escaping UUID identifiers."""
        uuid = "550e8400-e29b-41d4-a716-446655440000"
        assert escape_identifier(uuid) == uuid

    def test_escape_alphanumeric_id(self):
        """Test escaping alphanumeric identifiers."""
        assert escape_identifier("tenant_123") == "tenant_123"
        assert escape_identifier("app-abc-123") == "app-abc-123"

    def test_escape_identifier_with_quote(self):
        """Test escaping identifier with single quote."""
        malicious = "tenant' OR '1'='1"
        escaped = escape_identifier(malicious)
        assert escaped == "tenant'' OR ''1''=''1"

    def test_identifier_injection_attempt(self):
        """Test prevention of injection through identifiers."""
        # Common identifier injection patterns
        test_cases = [
            ("id' OR '1'='1", "id'' OR ''1''=''1"),
            ("id'; DROP TABLE", "id''; DROP TABLE"),
            ("id' UNION SELECT", "id'' UNION SELECT"),
        ]

        for malicious, expected in test_cases:
            assert escape_identifier(malicious) == expected


class TestSQLInjectionIntegration:
    """Integration tests simulating real SQL construction scenarios."""

    def test_complete_where_clause_safety(self):
        """Test that a complete WHERE clause is safe from injection."""
        # Simulating typical query construction
        tenant_id = "tenant' OR '1'='1"
        app_id = "app' UNION SELECT"
        run_id = "run' --"

        escaped_tenant = escape_identifier(tenant_id)
        escaped_app = escape_identifier(app_id)
        escaped_run = escape_identifier(run_id)

        sql = f"""
            SELECT * FROM workflow_runs 
            WHERE tenant_id='{escaped_tenant}' 
              AND app_id='{escaped_app}' 
              AND id='{escaped_run}'
        """

        # Verify all special characters are escaped
        assert "tenant'' OR ''1''=''1" in sql
        assert "app'' UNION SELECT" in sql
        assert "run'' --" in sql

        # Verify SQL structure is preserved (3 conditions with AND)
        assert sql.count("AND") == 2

    def test_multiple_conditions_with_injection_attempts(self):
        """Test multiple conditions all attempting injection."""
        conditions = {
            "tenant_id": "t1' OR tenant_id='t2",
            "app_id": "a1' OR app_id='a2",
            "status": "running' OR '1'='1",
        }

        where_parts = []
        for field, value in conditions.items():
            escaped = escape_sql_string(value)
            where_parts.append(f"{field}='{escaped}'")

        where_clause = " AND ".join(where_parts)

        # All injection attempts are neutralized
        assert "t1'' OR tenant_id=''t2" in where_clause
        assert "a1'' OR app_id=''a2" in where_clause
        assert "running'' OR ''1''=''1" in where_clause

        # AND structure is preserved
        assert where_clause.count(" AND ") == 2

    @pytest.mark.parametrize(
        ("attack_vector", "description"),
        [
            ("' OR '1'='1", "Boolean injection"),
            ("' OR '1'='1' --", "Boolean with comment"),
            ("' UNION SELECT * FROM users --", "Union injection"),
            ("'; DROP TABLE workflow_runs; --", "Destructive command"),
            ("' AND SLEEP(10) --", "Time-based blind"),
            ("' OR tenant_id LIKE '%", "Wildcard injection"),
            ("admin' --", "Comment bypass"),
            ("' OR 1=1 LIMIT 1 --", "Limit bypass"),
        ],
    )
    def test_common_injection_vectors(self, attack_vector, description):
        """Test protection against common injection attack vectors."""
        escaped = escape_sql_string(attack_vector)

        # Build SQL
        sql = f"WHERE tenant_id='{escaped}'"

        # Verify the attack string is now a safe literal
        # The key indicator: all internal single quotes are doubled
        internal_quotes = escaped.count("''")
        original_quotes = attack_vector.count("'")

        # Each original quote should be doubled
        assert internal_quotes == original_quotes

        # Verify SQL has exactly 2 quotes (opening and closing)
        assert sql.count("'") >= 2  # At least opening and closing

    def test_logstore_specific_scenario(self):
        """Test SQL injection prevention in LogStore-specific scenarios."""
        # Simulate LogStore query with window function
        tenant_id = "tenant' OR '1'='1"
        app_id = "app' UNION SELECT"

        escaped_tenant = escape_identifier(tenant_id)
        escaped_app = escape_identifier(app_id)

        sql = f"""
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY log_version DESC) as rn
                FROM workflow_execution_logstore
                WHERE tenant_id='{escaped_tenant}' 
                  AND app_id='{escaped_app}'
                  AND __time__ > 0
            ) AS subquery WHERE rn = 1
        """

        # Complex query structure is maintained
        assert "ROW_NUMBER()" in sql
        assert "PARTITION BY id" in sql

        # Injection attempts are escaped
        assert "tenant'' OR ''1''=''1" in sql
        assert "app'' UNION SELECT" in sql
