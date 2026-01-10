"""
Logstore extension for Dify application.

This extension initializes the logstore (Aliyun SLS) on application startup,
creating necessary projects, logstores, and indexes if they don't exist.
"""

import logging
import os

from dotenv import load_dotenv

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """
    Check if logstore extension is enabled.

    Logstore is considered enabled when:
    1. All required Aliyun SLS environment variables are set
    2. At least one repository configuration points to a logstore implementation

    Returns:
        True if logstore should be initialized, False otherwise
    """
    # Load environment variables from .env file
    load_dotenv()

    # Check if Aliyun SLS connection parameters are configured
    required_vars = [
        "ALIYUN_SLS_ACCESS_KEY_ID",
        "ALIYUN_SLS_ACCESS_KEY_SECRET",
        "ALIYUN_SLS_ENDPOINT",
        "ALIYUN_SLS_REGION",
        "ALIYUN_SLS_PROJECT_NAME",
    ]

    sls_vars_set = all(os.environ.get(var) for var in required_vars)

    if not sls_vars_set:
        return False

    # Check if any repository configuration points to logstore implementation
    repository_configs = [
        dify_config.CORE_WORKFLOW_EXECUTION_REPOSITORY,
        dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY,
        dify_config.API_WORKFLOW_NODE_EXECUTION_REPOSITORY,
        dify_config.API_WORKFLOW_RUN_REPOSITORY,
    ]

    uses_logstore = any("logstore" in config.lower() for config in repository_configs)

    if not uses_logstore:
        return False

    logger.info("Logstore extension enabled: SLS variables set and repository configured to use logstore")
    return True


def init_app(app: DifyApp):
    """
    Initialize logstore on application startup.
    If initialization fails, the application continues running without logstore features.

    Args:
        app: The Dify application instance
    """
    try:
        from extensions.logstore.aliyun_logstore import AliyunLogStore

        logger.info("Initializing Aliyun SLS Logstore...")

        # Create logstore client and initialize resources
        logstore_client = AliyunLogStore()
        logstore_client.init_project_logstore()

        app.extensions["logstore"] = logstore_client

        logger.info("Logstore initialized successfully")

    except Exception:
        logger.exception(
            "Logstore initialization failed. Configuration: endpoint=%s, region=%s, project=%s, timeout=%ss. "
            "Application will continue but logstore features will NOT work.",
            os.environ.get("ALIYUN_SLS_ENDPOINT"),
            os.environ.get("ALIYUN_SLS_REGION"),
            os.environ.get("ALIYUN_SLS_PROJECT_NAME"),
            os.environ.get("ALIYUN_SLS_CHECK_CONNECTIVITY_TIMEOUT", "30"),
        )
        # Don't raise - allow application to continue even if logstore setup fails
