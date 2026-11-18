from datetime import datetime

from sqlalchemy.orm import Session

from enums import DeploymentEdition
from models.account import Account, Tenant
from models.tokener import AccountTokenerSignupIntent
from services.billing_service import BillingService
from tests.helpers.unit.config_override import config_overrides_context

_CANDIDATE = "http://tokener-signup-billing-candidate:8081"
_EXISTING = "http://dify-saas-billing:8081"


def test_candidate_requires_consumed_signup_intent(sqlite_session: Session) -> None:
    owner = Account(name="dev signup", email="separate-signup@example.invalid")
    admitted = Tenant(name="dev signup")
    old = Tenant(name="retained legacy fixture")
    sqlite_session.add_all([owner, admitted, old])
    sqlite_session.flush()
    sqlite_session.add(
        AccountTokenerSignupIntent(
            account_id=owner.id,
            consumed_tenant_id=admitted.id,
            consumed_at=datetime(2026, 11, 18, 4, 0),
        )
    )
    sqlite_session.commit()

    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL=_EXISTING,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=_CANDIDATE,
    ):
        assert BillingService._tokener_signup_validation_base(admitted.id) == (_CANDIDATE, True)
        assert BillingService._tokener_signup_validation_base(old.id) == (_EXISTING, False)
    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL=_EXISTING,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL="",
    ):
        assert BillingService._tokener_signup_validation_base(admitted.id) == (_EXISTING, False)
