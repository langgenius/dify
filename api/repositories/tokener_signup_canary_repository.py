"""Read the on-disk signup binding used by the isolated agent-dev canary."""

from sqlalchemy import select

from core.db.session_factory import session_factory
from models.tokener import AccountTokenerSignupIntent

CANARY_STAGING_PROVIDER = "langgenius/tokener-staging/tokener"
CANARY_STAGING_PLUGIN_PREFIX = "langgenius/tokener-staging:"
CANARY_BILLING_URL = "http://tokener-hosted-billing-candidate:8081"


def signup_used_staging_package(tenant_id: str) -> bool:
    """Check the durable self-signup intent, not the current email or installed plugins.

    No legacy migration can create this proof. A read failure propagates so a
    caller cannot treat an unknown binding as authorization to the shared wallet.
    """
    with session_factory.create_session() as session:
        identifier = session.scalar(
            select(AccountTokenerSignupIntent.plugin_unique_identifier).where(
                AccountTokenerSignupIntent.consumed_tenant_id == tenant_id,
            )
        )
    return identifier is not None and identifier.startswith(CANARY_STAGING_PLUGIN_PREFIX)
