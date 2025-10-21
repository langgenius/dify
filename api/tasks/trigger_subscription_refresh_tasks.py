import logging
import time

from celery import shared_task
from sqlalchemy.orm import Session

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.provider import PluginTriggerProviderController
from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import create_trigger_provider_encrypter_for_properties
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


def _now_ts() -> int:
    return int(time.time())


@shared_task(queue="trigger_refresh_executor")
def trigger_subscription_refresh(tenant_id: str, subscription_id: str) -> None:
    """Refresh a trigger subscription if needed, guarded by a Redis in-flight lock."""
    lock_key = f"trigger_provider_refresh_lock:{tenant_id}_{subscription_id}"
    if not redis_client.get(lock_key):  # Lock missing means job already timed out/handled
        logger.debug("Refresh lock missing, skip: %s", lock_key)
        return

    try:
        now: int = _now_ts()
        with Session(db.engine) as session:
            subscription: TriggerSubscription | None = (
                session.query(TriggerSubscription)
                .filter_by(tenant_id=tenant_id, id=subscription_id)
                .first()
            )

            if not subscription:
                logger.warning("Subscription not found: tenant=%s id=%s", tenant_id, subscription_id)
                return

            # Refresh OAuth token if already expired
            if (
                subscription.credential_expires_at != -1
                and int(subscription.credential_expires_at) <= now
                and CredentialType.of(subscription.credential_type) == CredentialType.OAUTH2
            ):
                try:
                    TriggerProviderService.refresh_oauth_token(tenant_id, subscription.id)
                except Exception:
                    logger.exception("OAuth refresh failed for %s/%s", tenant_id, subscription.id)
                    # proceed to subscription refresh; provider may still accept late refresh

            # Only refresh subscription when it's actually expired
            if subscription.expires_at != -1 and int(subscription.expires_at) <= now:
                # Load decrypted subscription and properties
                loaded = TriggerProviderService.get_subscription_by_id(
                    tenant_id=tenant_id, subscription_id=subscription.id
                )
                if not loaded:
                    logger.warning("Subscription vanished during refresh: tenant=%s id=%s", tenant_id, subscription_id)
                    return

                controller: PluginTriggerProviderController = TriggerManager.get_trigger_provider(
                    tenant_id, TriggerProviderID(loaded.provider_id)
                )
                refreshed = controller.refresh_trigger(
                    subscription=loaded.to_entity(),
                    credentials=loaded.credentials,
                    credential_type=CredentialType.of(loaded.credential_type),
                )

                # Persist refreshed properties/expires_at with encryption
                properties_encrypter, properties_cache = create_trigger_provider_encrypter_for_properties(
                    tenant_id=tenant_id,
                    controller=controller,
                    subscription=loaded,
                )

                db_sub: TriggerSubscription | None = (
                    session.query(TriggerSubscription)
                    .filter_by(tenant_id=tenant_id, id=subscription.id)
                    .first()
                )
                if db_sub is not None:
                    db_sub.properties = dict(properties_encrypter.encrypt(dict(refreshed.properties)))
                    db_sub.expires_at = int(refreshed.expires_at)
                    session.commit()
                    properties_cache.delete()
    finally:
        try:
            redis_client.delete(lock_key)
        except Exception:
            # Best-effort lock cleanup
            pass
