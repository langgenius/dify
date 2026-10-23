from sqlalchemy import select
from sqlalchemy.orm import Session

from core.trigger.trigger_manager import TriggerManager
from core.trigger.utils.encryption import (
    create_trigger_provider_encrypter_for_properties,
    create_trigger_provider_encrypter_for_subscription,
)
from extensions.ext_database import db
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription


class TriggerProviderService:
    """Legacy ORM subscription reads for debug and asynchronous event execution.

    Console management and builder writes use the injected TriggerSubscriptionService.
    Renewal uses the injected TriggerSubscriptionRenewalService.
    TODO: Retire these ORM-returning reads when debug invocation and asynchronous
    event execution migrate to detached subscription queries.
    """

    @classmethod
    def get_subscription_by_id(
        cls, tenant_id: str, subscription_id: str | None = None, *, provider_id: TriggerProviderID | None = None
    ) -> TriggerSubscription | None:
        """
        Get a trigger subscription by the ID.
        """
        with Session(db.engine, expire_on_commit=False) as session:
            query = select(TriggerSubscription).where(TriggerSubscription.tenant_id == tenant_id)
            if subscription_id:
                query = query.where(TriggerSubscription.id == subscription_id)
            if provider_id is not None:
                query = query.where(TriggerSubscription.provider_id == str(provider_id))
            subscription = session.scalar(query.limit(1))
            if subscription:
                provider_controller = TriggerManager.get_trigger_provider(
                    tenant_id, TriggerProviderID(subscription.provider_id)
                )
                encrypter, _ = create_trigger_provider_encrypter_for_subscription(
                    tenant_id=tenant_id,
                    controller=provider_controller,
                    subscription=subscription,
                )
                subscription.credentials = dict(encrypter.decrypt(subscription.credentials))
                properties_encrypter, _ = create_trigger_provider_encrypter_for_properties(
                    tenant_id=subscription.tenant_id,
                    controller=provider_controller,
                    subscription=subscription,
                )
                subscription.properties = dict(properties_encrypter.decrypt(subscription.properties))
            return subscription
