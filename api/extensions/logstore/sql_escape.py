"""
SQL Escape Utility for LogStore Queries

This module provides escaping utilities to prevent injection attacks in LogStore queries.

LogStore supports two query modes:
1. PG Protocol Mode: Uses SQL syntax with single quotes for strings
2. SDK Mode: Uses LogStore query syntax (key: value) with double quotes

Key Security Concerns:
- Prevent tenant A from accessing tenant B's data via injection
- SLS queries are read-only, so we focus on data access control
- Different escaping strategies for SQL vs LogStore query syntax
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

    This function is for PG protocol mode (SQL syntax).
    For SDK mode, use escape_logstore_query_value() instead.

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


def escape_logstore_query_value(value: str) -> str:
    """
    Escape value for LogStore query syntax (SDK mode).

    LogStore query syntax rules:
    1. Keywords (and/or/not) are case-insensitive
    2. Single quotes are ordinary characters (no special meaning)
    3. Double quotes wrap values: key:"value"
    4. Backslash is the escape character:
       - \" for double quote inside value
       - \\ for backslash itself
    5. Parentheses can change query structure

    To prevent injection:
    - Wrap value in double quotes to treat special chars as literals
    - Escape backslashes and double quotes using backslash

    Args:
        value: The value to escape for LogStore query syntax

    Returns:
        Quoted and escaped value safe for LogStore query syntax (includes the quotes)

    Examples:
        >>> escape_logstore_query_value("normal_value")
        '"normal_value"'
        >>> escape_logstore_query_value("value or field:evil")
        '"value or field:evil"'  # 'or' and ':' are now literals
        >>> escape_logstore_query_value('value"test')
        '"value\\"test"'  # Internal double quote escaped
        >>> escape_logstore_query_value('value\\test')
        '"value\\\\test"'  # Backslash escaped

    Security:
        - Prevents injection via and/or/not keywords
        - Prevents injection via colons (:)
        - Prevents injection via parentheses
        - Protects against cross-tenant data access

    Note:
        Escape order is critical: backslash first, then double quotes.
        Otherwise, we'd double-escape the escape character itself.
    """
    if not value:
        return '""'

    # IMPORTANT: Escape backslashes FIRST, then double quotes
    # This prevents double-escaping (e.g., " -> \" -> \\" incorrectly)
    escaped = value.replace("\\", "\\\\")  # \ -> \\
    escaped = escaped.replace('"', '\\"')  # " -> \"

    # Wrap in double quotes to treat as literal string
    # This prevents and/or/not/:/() from being interpreted as operators
    return f'"{escaped}"'
