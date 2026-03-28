import logging
import time
from collections.abc import Mapping
from typing import Any

from celery import shared_task
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.utils.locks import build_trigger_refresh_lock_key
from extensions.ext_redis import redis_client
from models.trigger import TriggerSubscription
from services.trigger.trigger_provider_service import TriggerProviderService

logger = logging.getLogger(__name__)


def _now_ts() -> int:
    return int(time.time())


def _load_subscription(session: Session, tenant_id: str, subscription_id: str) -> TriggerSubscription | None:
    return session.query(TriggerSubscription).filter_by(tenant_id=tenant_id, id=subscription_id).first()


def _refresh_oauth_if_expired(tenant_id: str, subscription: TriggerSubscription, now: int) -> None:
    threshold_seconds: int = int(dify_config.TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS)
    if (
        subscription.credential_expires_at != -1
        and int(subscription.credential_expires_at) <= now + threshold_seconds
        and CredentialType.of(subscription.credential_type) == CredentialType.OAUTH2
    ):
        logger.info(
            "Refreshing OAuth token: tenant=%s subscription_id=%s expires_at=%s now=%s",
            tenant_id,
            subscription.id,
            subscription.credential_expires_at,
            now,
        )
        try:
            result: Mapping[str, Any] = TriggerProviderService.refresh_oauth_token(
                tenant_id=tenant_id, subscription_id=subscription.id
            )
            logger.info(
                "OAuth token refreshed: tenant=%s subscription_id=%s result=%s", tenant_id, subscription.id, result
            )
        except Exception:
            logger.exception("OAuth refresh failed: tenant=%s subscription_id=%s", tenant_id, subscription.id)


def _refresh_subscription_if_expired(
    tenant_id: str,
    subscription: TriggerSubscription,
    now: int,
) -> None:
    threshold_seconds: int = int(dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS)
    if subscription.expires_at == -1 or int(subscription.expires_at) > now + threshold_seconds:
        logger.debug(
            "Subscription not due: tenant=%s subscription_id=%s expires_at=%s now=%s threshold=%s",
            tenant_id,
            subscription.id,
            subscription.expires_at,
            now,
            threshold_seconds,
        )
        return

    try:
        result: Mapping[str, Any] = TriggerProviderService.refresh_subscription(
            tenant_id=tenant_id, subscription_id=subscription.id, now=now
        )
        logger.info(
            "Subscription refreshed: tenant=%s subscription_id=%s result=%s",
            tenant_id,
            subscription.id,
            result.get("result"),
        )
    except Exception:
        logger.exception("Subscription refresh failed: tenant=%s id=%s", tenant_id, subscription.id)


@shared_task(queue="trigger_refresh_executor")
def trigger_subscription_refresh(tenant_id: str, subscription_id: str) -> None:
    """Refresh a trigger subscription if needed, guarded by a Redis in-flight lock."""
    lock_key: str = build_trigger_refresh_lock_key(tenant_id, subscription_id)
    if not redis_client.get(lock_key):
        logger.debug("Refresh lock missing, skip: %s", lock_key)
        return

    logger.info("Begin subscription refresh: tenant=%s id=%s", tenant_id, subscription_id)
    try:
        now: int = _now_ts()
        with session_factory.create_session() as session:
            subscription: TriggerSubscription | None = _load_subscription(session, tenant_id, subscription_id)

            if not subscription:
                logger.warning("Subscription not found: tenant=%s id=%s", tenant_id, subscription_id)
                return

            logger.debug(
                "Loaded subscription: tenant=%s id=%s cred_exp=%s sub_exp=%s now=%s",
                tenant_id,
                subscription.id,
                subscription.credential_expires_at,
                subscription.expires_at,
                now,
            )

            _refresh_oauth_if_expired(tenant_id=tenant_id, subscription=subscription, now=now)
            _refresh_subscription_if_expired(tenant_id=tenant_id, subscription=subscription, now=now)
    finally:
        try:
            redis_client.delete(lock_key)
            logger.debug("Lock released: %s", lock_key)
        except Exception:
            # Best-effort lock cleanup
            logger.warning("Failed to release lock: %s", lock_key, exc_info=True)
