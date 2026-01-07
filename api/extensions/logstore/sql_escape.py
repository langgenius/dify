"""
SQL Escape Utility for LogStore Queries

This module provides simple SQL escaping utilities to prevent SQL injection attacks
in LogStore queries, with a focus on preventing cross-tenant data access.

Key Security Concerns:
- Prevent tenant A from accessing tenant B's data via injection
- SLS queries are read-only, so we focus on data access control
- Simple escaping is sufficient for identifier fields (tenant_id, app_id, etc.)
"""


def escape_sql_string(value: str) -> str:
    """
    Escape a string value for safe use in SQL queries.

    This function escapes single quotes by doubling them, which is the standard
    SQL escaping method. This prevents SQL injection by ensuring that user input
    cannot break out of string literals.

    Args:
        value: The string value to escape

    Returns:
        Escaped string safe for use in SQL queries

    Examples:
        >>> escape_sql_string("normal_value")
        "normal_value"
        >>> escape_sql_string("value' OR '1'='1")
        "value'' OR ''1''=''1"
        >>> escape_sql_string("tenant's_id")
        "tenant''s_id"

    Security:
        - Prevents breaking out of string literals
        - Stops injection attacks like: ' OR '1'='1
        - Protects against cross-tenant data access
    """
    if not value:
        return value

    # Escape single quotes by doubling them (standard SQL escaping)
    # This prevents breaking out of string literals in SQL queries
    return value.replace("'", "''")


def escape_identifier(value: str) -> str:
    """
    Escape an identifier (tenant_id, app_id, run_id, etc.) for safe SQL use.

    For LogStore queries, identifiers are typically UUIDs or alphanumeric strings.
    This function provides basic escaping to prevent injection attacks while
    keeping the validation lightweight.

    Args:
        value: The identifier value to escape

    Returns:
        Escaped identifier safe for use in SQL queries

    Examples:
        >>> escape_identifier("550e8400-e29b-41d4-a716-446655440000")
        "550e8400-e29b-41d4-a716-446655440000"
        >>> escape_identifier("tenant_id' OR '1'='1")
        "tenant_id'' OR ''1''=''1"

    Security:
        - Prevents SQL injection via identifiers
        - Stops cross-tenant access attempts
        - Works for UUIDs, alphanumeric IDs, and similar identifiers
    """
    # For identifiers, use the same escaping as strings
    # This is simple and effective for preventing injection
    return escape_sql_string(value)
