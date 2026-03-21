"""
Utilities for detecting if database service is available for workflow tests.
"""

import psycopg2
import pytest

from configs import dify_config


def is_database_available() -> bool:
    """
    Check if the database service is available by attempting to connect to it.

    Returns:
        True if database is available, False otherwise.
    """
    try:
        # Try to establish a database connection using a context manager
        with psycopg2.connect(
            host=dify_config.DB_HOST,
            port=dify_config.DB_PORT,
            database=dify_config.DB_DATABASE,
            user=dify_config.DB_USERNAME,
            password=dify_config.DB_PASSWORD,
            connect_timeout=2,  # 2 second timeout
        ) as conn:
            pass  # Connection established and will be closed automatically
        return True
    except (psycopg2.OperationalError, psycopg2.Error):
        return False


def skip_if_database_unavailable():
    """
    Pytest skip decorator that skips tests when database service is unavailable.

    Usage:
        @skip_if_database_unavailable()
        def test_my_workflow():
            ...
    """
    return pytest.mark.skipif(
        not is_database_available(),
        reason="Database service is not available (connection refused or authentication failed)",
    )
