"""Queue managed Tokener provisioning after a tenant is committed."""

import logging

from configs import dify_config
from events.tenant_event import tenant_was_created
from extensions.application_services.model_billing import build_model_billing_profiles
from services.model_billing_profile_service import ModelBillingProfileResolutionError
from tasks.bootstrap_tokener_tenant_task import bootstrap_tokener_tenant_task

logger = logging.getLogger(__name__)


@tenant_was_created.connect
def handle(sender, **kwargs) -> None:
    if not dify_config.TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED:
        return

    try:
        if not build_model_billing_profiles().resolve(sender.id).uses_tokener:
            return
    except ModelBillingProfileResolutionError:
        logger.error("Tokener bootstrap profile is unavailable for tenant %s", sender.id)  # noqa: TRY400
        return

    try:
        bootstrap_tokener_tenant_task.delay(sender.id)
    except Exception:
        # Registration itself is already committed. The durable integration row
        # remains pending so an operator or recovery sweep can safely requeue it.
        # Do not serialize broker exception details into a registration request log.
        logger.error("Failed to queue Tokener bootstrap for tenant %s", sender.id)  # noqa: TRY400
