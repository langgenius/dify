from uuid import uuid4

import pytest
from blinker import Signal
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from models import TenantCreditPool
from models.model_billing import TenantModelBillingProfile
from models.tokener import AccountTokenerSignupIntent, TenantTokenerIntegration
from repositories.tokener_signup_canary_repository import CANARY_BILLING_URL
from services.account.adapters import DeploymentAccountLifecyclePolicy
from services.account.contracts import TokenerSignupEnrollment
from services.account.oauth_adapters import AccountLifecycleOAuthRegistrationGateway, WorkspaceProvisioningOAuthGateway
from services.account.signup_adapter import configured_signup_enrollment
from services.entities.account_oauth_entities import OAuthAccountRegistration
from services.workspace import gateways
from services.workspace.contracts import WorkspaceCreation
from tests.helpers.unit.account_domain import AccountDomain
from tests.helpers.unit.config_override import apply_config_overrides

UID = "langgenius/tokener:0.4.4@signup-test"
CANARY_UID = "langgenius/tokener-staging:0.4.4@signup-test"


@pytest.mark.parametrize(
    ("edition", "enabled", "expected"),
    [
        (DeploymentEdition.CLOUD, True, True),
        (DeploymentEdition.CLOUD, False, False),
        (DeploymentEdition.COMMUNITY, True, False),
        (DeploymentEdition.ENTERPRISE, True, False),
    ],
)
def test_signup_enrollment_is_explicit_cloud_policy(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
    enabled: bool,
    expected: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=edition,
        TOKENER_NEW_TENANT_COHORT_ENABLED=enabled,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER=UID,
    )
    assert configured_signup_enrollment() == (TokenerSignupEnrollment(UID) if expected else None)


def test_signup_canary_only_pins_the_exact_configured_account(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_NEW_TENANT_COHORT_ENABLED=True,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER=UID,
        TOKENER_SIGNUP_VALIDATION_EMAIL="stage-canary@example.invalid",
        TOKENER_SIGNUP_VALIDATION_PLUGIN_UNIQUE_IDENTIFIER=CANARY_UID,
        TOKENER_SIGNUP_VALIDATION_BILLING_API_URL=CANARY_BILLING_URL,
    )
    assert configured_signup_enrollment("Stage-Canary@example.invalid") == TokenerSignupEnrollment(CANARY_UID)
    assert configured_signup_enrollment("another@example.invalid") == TokenerSignupEnrollment(UID)


@pytest.fixture
def signup_domain(account_domain: AccountDomain, monkeypatch: pytest.MonkeyPatch) -> AccountDomain:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        TOKENER_NEW_TENANT_COHORT_ENABLED=True,
        TOKENER_PLUGIN_UNIQUE_IDENTIFIER=UID,
        TOKENER_NEW_TENANT_BOOTSTRAP_ENABLED=False,
        RBAC_ENABLED=False,
    )
    # Real enrollment policy and application/repository objects. Only external
    # account/license decisions and post-commit key/event effects are isolated.
    policy = DeploymentAccountLifecyclePolicy()
    monkeypatch.setattr(policy, "is_registration_allowed", lambda: True)
    monkeypatch.setattr(policy, "has_account_capacity", lambda: True)
    monkeypatch.setattr(policy, "get_email_freeze_type", lambda _email: None)
    monkeypatch.setattr(policy, "is_workspace_creation_allowed", lambda: True)
    monkeypatch.setattr(policy, "has_workspace_capacity", lambda: True)
    monkeypatch.setattr(policy, "try_join_default_workspace", lambda _account: None)
    monkeypatch.setattr(account_domain.accounts, "_policies", policy)
    monkeypatch.setattr(account_domain.provisioning, "_policies", policy)
    monkeypatch.setattr(gateways, "generate_key_pair", lambda _workspace: "unit-public-key")
    monkeypatch.setattr(gateways, "tenant_was_created", Signal())
    return account_domain


def _assert_native(sessions: sessionmaker[Session], account: str, tenant: str) -> None:
    with sessions() as session:
        intent = session.get(AccountTokenerSignupIntent, account)
        profile = session.get(TenantModelBillingProfile, tenant)
        assert intent is not None
        assert intent.consumed_tenant_id == tenant
        assert intent.consumed_at is not None
        assert profile is not None
        assert profile.model_billing_source == "tokener"
        integration = session.scalar(
            select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant)
        )
        assert integration is not None
        assert integration.plugin_unique_identifier == UID
        assert session.scalar(select(TenantCreditPool).where(TenantCreditPool.tenant_id == tenant)) is None


def test_verified_email_registration_producer_persists_intent_and_only_first_workspace(
    signup_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account = signup_domain.accounts.create_account_and_tenant(f"{uuid4()}@example.test", "New user", "en-US")
    tenants = signup_domain.workspaces.list_ids_for_account(account.id)
    assert len(tenants) == 1
    _assert_native(sqlite_session_factory, account.id, tenants[0])
    signup_domain.provisioning.create_owner_workspace(account.id, name="An ordinary later workspace")
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(TenantModelBillingProfile)) == 1
        assert session.scalar(select(func.count()).select_from(TenantTokenerIntegration)) == 1
        assert session.scalar(select(func.count()).select_from(TenantCreditPool)) == 1


def test_verified_email_code_atomic_account_workspace_producer(
    signup_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account_id = signup_domain.provisioning.create_with_owner_workspace(
        email=f"{uuid4()}@example.test",
        name="Code signup",
        interface_language="en-US",
        timezone="UTC",
        ip_address="127.0.0.1",
    )
    tenants = signup_domain.workspaces.list_ids_for_account(account_id)
    assert len(tenants) == 1
    _assert_native(sqlite_session_factory, account_id, tenants[0])


def test_actual_oauth_account_creation_intent_survives_workspace_failure_and_existing_login_retry(
    signup_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_id = AccountLifecycleOAuthRegistrationGateway(accounts=signup_domain.accounts).register(
        OAuthAccountRegistration(
            email=f"{uuid4()}@example.test",
            name="OAuth signup",
            language="en-US",
            timezone="UTC",
            ip_address="127.0.0.1",
        )
    )
    prepare = signup_domain.provisioning._effects.prepare
    failed = False

    def fail_once(name: str) -> WorkspaceCreation:
        nonlocal failed
        if not failed:
            failed = True
            raise RuntimeError("unit transient workspace preparation")
        return prepare(name)

    monkeypatch.setattr(signup_domain.provisioning._effects, "prepare", fail_once)
    adapter = WorkspaceProvisioningOAuthGateway(workspaces=signup_domain.provisioning)
    with pytest.raises(RuntimeError, match="unit transient"):
        adapter.create_registration_owner_workspace(account_id)
    with sqlite_session_factory() as session:
        intent = session.get(AccountTokenerSignupIntent, account_id)
        assert intent is not None
        assert intent.consumed_at is None
    apply_config_overrides(monkeypatch, TOKENER_NEW_TENANT_COHORT_ENABLED=False)
    adapter.create_owner_workspace(account_id)
    tenants = signup_domain.workspaces.list_ids_for_account(account_id)
    assert len(tenants) == 1
    _assert_native(sqlite_session_factory, account_id, tenants[0])


@pytest.mark.parametrize("workspace_required", [True, False])
def test_generic_cli_or_invitation_registration_does_not_manufacture_signup_intent(
    signup_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    workspace_required: bool,
) -> None:
    account = signup_domain.accounts.register(
        email=f"{uuid4()}@example.test",
        name="Non-self-signup",
        create_workspace_required=workspace_required,
    )
    with sqlite_session_factory() as session:
        assert session.get(AccountTokenerSignupIntent, account.id) is None
        assert session.scalar(select(func.count()).select_from(TenantModelBillingProfile)) == 0
        assert session.scalar(select(func.count()).select_from(TenantTokenerIntegration)) == 0
