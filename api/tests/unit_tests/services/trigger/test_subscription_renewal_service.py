"""Renewal guards exercise the real service and repository without external I/O."""

from contextvars import Context
from http import HTTPStatus
from uuid import uuid4

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from extensions.ext_application_services import application_services
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _refresh(harness: _Harness, tenant_id: str, subscription_id: str) -> None:
    def run() -> None:
        with harness.app.app_context():
            application_services().workspaces.trigger_subscription_renewal.refresh_if_due(
                tenant_id=tenant_id, subscription_id=subscription_id, now=100
            )

    Context().run(run)


@pytest.mark.parametrize(
    ("credential_type", "credential_expiry", "subscription_expiry"),
    [
        pytest.param(CredentialType.OAUTH2, -1, -1, id="never-expires"),
        pytest.param(CredentialType.OAUTH2, 111, 111, id="outside-threshold"),
        pytest.param(CredentialType.OAUTH2, -1, 110, id="subscription-waits-until-expired"),
        pytest.param(CredentialType.API_KEY, 0, -1, id="api-key-is-not-oauth"),
        pytest.param(CredentialType.UNAUTHORIZED, 0, -1, id="manual-is-not-oauth"),
    ],
)
def test_not_due_subscriptions_do_not_contact_provider_or_change_database(
    harness: _Harness,
    daemon: _Daemon,
    credential_type: CredentialType,
    credential_expiry: int,
    subscription_expiry: int,
) -> None:
    subscription = _add_subscription(harness, credential_type=credential_type)
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.credential_expires_at = credential_expiry
        row.expires_at = subscription_expiry
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)

    with config_overrides_context(
        TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS=10,
        TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS=10,
    ):
        _refresh(harness, harness.tenant_id, subscription.id)

    assert daemon.requests == []
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert all(not session.in_transaction() and not session.identity_map for session in harness.metadata.sessions)


@pytest.mark.parametrize("missing_scope", ["tenant", "subscription"])
def test_missing_owned_subscription_does_not_contact_provider(
    harness: _Harness, daemon: _Daemon, missing_scope: str
) -> None:
    subscription = _add_subscription(harness, credential_type=CredentialType.OAUTH2)
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.credential_expires_at = row.expires_at = 1

    _refresh(
        harness,
        str(uuid4()) if missing_scope == "tenant" else harness.tenant_id,
        str(uuid4()) if missing_scope == "subscription" else subscription.id,
    )

    assert daemon.requests == []
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        assert saved is not None
        assert saved.credential_expires_at == saved.expires_at == 1


def test_provider_failure_is_logged_after_repository_transaction_closes(
    harness: _Harness, daemon: _Daemon, caplog: pytest.LogCaptureFixture
) -> None:
    subscription = _add_subscription(harness, credential_type=CredentialType.API_KEY)
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.expires_at = 1
    daemon.status = HTTPStatus.SERVICE_UNAVAILABLE
    repository = TriggerSubscriptionRepository(session_factory=harness.session_factory)
    before = repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id)

    _refresh(harness, harness.tenant_id, subscription.id)

    assert len(daemon.requests) == 1
    assert daemon.requests[0].method == "GET"
    assert not daemon.requests[0].open_transactions
    assert repository.get(tenant_id=harness.tenant_id, subscription_id=subscription.id) == before
    assert any(record.exc_info and subscription.id in record.getMessage() for record in caplog.records)
