"""Initialize default RBAC access for existing workspace members after app creation."""

import logging

from celery import shared_task

from configs import dify_config
from core.rbac import RBACResourceWhitelistScope
from extensions.ext_database import db
from services.account_service import TenantService
from services.enterprise import rbac_service as enterprise_rbac_service

logger = logging.getLogger(__name__)

APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE = 500
APP_RBAC_DEFAULT_ACCESS_POLICY_ID = "default"
APP_RBAC_QUEUE = "app_rbac"


@shared_task(queue=APP_RBAC_QUEUE, bind=True, max_retries=3, default_retry_delay=60)
def initialize_created_app_rbac_access_task(self, tenant_id: str, account_id: str, app_id: str) -> None:
    """Grant the default app policy to current members after a committed app creation.

    The replace operations are idempotent, so retrying the whole initialization
    is safe when the enterprise RBAC service is temporarily unavailable.
    """
    if not dify_config.RBAC_ENABLED:
        return

    try:
        enterprise_rbac_service.RBACService.AppAccess.replace_whitelist(
            tenant_id=tenant_id,
            account_id=account_id,
            app_id=app_id,
            payload=enterprise_rbac_service.ReplaceMemberBindings(scope=RBACResourceWhitelistScope.ALL),
        )

        for account_ids in TenantService.iter_member_account_id_batches(
            tenant_id,
            APP_RBAC_ACCOUNT_POLICY_BATCH_SIZE,
            session=db.session(),
        ):
            enterprise_rbac_service.RBACService.AppAccess.replace_user_access_policies(
                tenant_id=tenant_id,
                account_id=account_id,
                app_id=app_id,
                target_account_id=None,
                payload=enterprise_rbac_service.ReplaceUserAccessPolicies(
                    access_policy_ids=[APP_RBAC_DEFAULT_ACCESS_POLICY_ID],
                    account_ids=account_ids,
                ),
            )
    except Exception as exc:
        logger.exception(
            "Failed to initialize app RBAC access; retrying: tenant_id=%s app_id=%s attempt=%s",
            tenant_id,
            app_id,
            self.request.retries + 1,
        )
        raise self.retry(exc=exc)
