from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from configs.feature import TokenerSignupBillingCandidate
from enums import DeploymentEdition
from models.account import Account, Tenant
from models.tokener import AccountTokenerSignupIntent
from repositories.tokener_signup_canary_repository import CANARY_BILLING_URL
from services.billing_service import BillingService, BillingUpstreamUnavailableError
from tests.helpers.unit.config_override import config_overrides_context

_CANDIDATE = "http://tokener-signup-billing-candidate:8081"
_EXISTING = "http://dify-saas-billing:8081"
_SHARED_UID = "langgenius/tokener-staging:0.4.5-dev2026112203@" + "a" * 64


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


def test_hosted_candidate_does_not_move_existing_signup_or_fall_back_on_disable(sqlite_session: Session) -> None:
    owner = Account(name="hosted signup", email="isolated-hosted@example.invalid")
    native_owner = Account(name="older signup", email="older-signup@example.invalid")
    hosted = Tenant(name="hosted signup")
    native = Tenant(name="older native signup")
    sqlite_session.add_all([owner, native_owner, hosted, native])
    sqlite_session.flush()
    now = datetime(2026, 11, 19, 4, 0)
    sqlite_session.add_all(
        [
            AccountTokenerSignupIntent(
                account_id=owner.id,
                consumed_tenant_id=hosted.id,
                consumed_at=now,
                plugin_unique_identifier="langgenius/tokener-staging:0.4.4@signup-test",
            ),
            AccountTokenerSignupIntent(
                account_id=native_owner.id,
                consumed_tenant_id=native.id,
                consumed_at=now,
                plugin_unique_identifier="langgenius/tokener:0.4.3-dev21@signup-test",
            ),
        ]
    )
    sqlite_session.commit()

    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL=_EXISTING,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=CANARY_BILLING_URL,
    ):
        assert BillingService._tokener_signup_validation_base(hosted.id) == (CANARY_BILLING_URL, True)
        assert BillingService._tokener_signup_validation_base(native.id) == (_EXISTING, False)
    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL=_EXISTING,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL="",
    ):
        with pytest.raises(BillingUpstreamUnavailableError):
            BillingService._tokener_signup_validation_base(hosted.id)

    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL=_EXISTING,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=TokenerSignupBillingCandidate.SHARED_STAGING,
        TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER=_SHARED_UID,
    ):
        # Same persisted staging intent, without re-enrollment or credential rebind.
        assert BillingService._tokener_signup_validation_base(hosted.id) == (_EXISTING, True)
        # The shared server uses the original Partner for an existing non-staging enrollment.
        assert BillingService._tokener_signup_validation_base(native.id) == (_EXISTING, False)

    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_BILLING_API_URL="https://invalid.example",
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=TokenerSignupBillingCandidate.SHARED_STAGING,
        TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER=_SHARED_UID,
    ):
        with pytest.raises(BillingUpstreamUnavailableError):
            BillingService._tokener_signup_validation_base(hosted.id)
