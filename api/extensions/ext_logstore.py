"""
Logstore extension for Dify application.

This extension initializes the logstore (Aliyun SLS) on application startup,
creating necessary projects, logstores, and indexes if they don't exist.
"""

import logging

from configs import dify_config
from dify_app import DifyApp
from extensions.logstore.aliyun_logstore import AliyunLogStore
from repositories.workflow.logstore.schema import workflow_logstore_indexes

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """
    Check if logstore extension is enabled.

    Logstore is considered enabled when:
    1. All required Aliyun SLS environment variables are set
    2. Workflow run or node execution storage uses LogStore

    Returns:
        True if logstore should be initialized, False otherwise
    """
    # Check if Aliyun SLS connection parameters are configured
    sls_vars_set = all(
        (
            dify_config.ALIYUN_SLS_ACCESS_KEY_ID,
            dify_config.ALIYUN_SLS_ACCESS_KEY_SECRET,
            dify_config.ALIYUN_SLS_ENDPOINT,
            dify_config.ALIYUN_SLS_REGION,
            dify_config.ALIYUN_SLS_PROJECT_NAME,
        )
    )

    if not sls_vars_set:
        return False

    uses_logstore = "logstore" in (
        dify_config.WORKFLOW_RUN_STORAGE_BACKEND,
        dify_config.WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND,
    )

    if not uses_logstore:
        return False

    logger.info("Logstore extension enabled: SLS variables set and workflow storage uses LogStore")
    return True


def init_app(app: DifyApp):
    """
    Initialize logstore on application startup.
    If initialization fails, the application continues running without logstore features.

    Args:
        app: The Dify application instance
    """
    try:
        logger.info("Initializing Aliyun SLS Logstore...")

        # Create logstore client and initialize resources
        logstore_client = AliyunLogStore()
        logstore_client.init_project_logstore(workflow_logstore_indexes())

        app.extensions["logstore"] = logstore_client

        logger.info("Logstore initialized successfully")

    except Exception:
        logger.exception(
            "Logstore initialization failed. Configuration: endpoint=%s, region=%s, project=%s, timeout=%ss. "
            "Application will continue but logstore features will NOT work.",
            dify_config.ALIYUN_SLS_ENDPOINT,
            dify_config.ALIYUN_SLS_REGION,
            dify_config.ALIYUN_SLS_PROJECT_NAME,
            dify_config.ALIYUN_SLS_CHECK_CONNECTIVITY_TIMEOUT,
        )
        # Don't raise - allow application to continue even if logstore setup fails
