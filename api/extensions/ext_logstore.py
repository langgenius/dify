"""
Logstore extension for Dify application.

This extension initializes the logstore (Aliyun SLS) on application startup,
creating necessary projects, logstores, and indexes if they don't exist.
"""

import logging
import os

from dotenv import load_dotenv

from dify_app import DifyApp

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """
    Check if logstore extension is enabled.

    Returns:
        True if all required Aliyun SLS environment variables are set, False otherwise
    """
    # Load environment variables from .env file
    load_dotenv()

    required_vars = [
        "ALIYUN_SLS_ACCESS_KEY_ID",
        "ALIYUN_SLS_ACCESS_KEY_SECRET",
        "ALIYUN_SLS_ENDPOINT",
        "ALIYUN_SLS_REGION",
        "ALIYUN_SLS_PROJECT_NAME",
    ]

    all_set = all(os.environ.get(var) for var in required_vars)

    if not all_set:
        logger.info("Logstore extension disabled: required Aliyun SLS environment variables not set")

    return all_set


def init_app(app: DifyApp):
    """
    Initialize logstore on application startup.

    This function:
    1. Creates Aliyun SLS project if it doesn't exist
    2. Creates logstores (workflow_execution, workflow_node_execution) if they don't exist
    3. Creates indexes with field configurations based on PostgreSQL table structures

    This operation is idempotent and only executes once during application startup.

    Args:
        app: The Dify application instance
    """
    try:
        from extensions.logstore.aliyun_logstore import AliyunLogStore

        logger.info("Initializing logstore...")

        # Create logstore client and initialize project/logstores/indexes
        logstore_client = AliyunLogStore()
        logstore_client.init_project_logstore()

        # Attach to app for potential later use
        app.extensions["logstore"] = logstore_client

        logger.info("Logstore initialized successfully")
    except Exception:
        logger.exception("Failed to initialize logstore")
        # Don't raise - allow application to continue even if logstore init fails
        # This ensures that the application can still run if logstore is misconfigured
