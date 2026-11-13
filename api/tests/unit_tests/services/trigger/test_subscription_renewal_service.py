"""Renewal guards exercise the real service and repository without external I/O."""

from contextvars import Context
from http import HTTPStatus
from threading import Event, Thread
from uuid import uuid4

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.impl.trigger import PluginTriggerClient
from extensions.ext_application_services import application_services
from models.trigger import TriggerSubscription
from repositories.trigger.subscription_repository import TriggerSubscriptionRepository
from services.trigger.credential_encryption import delete_cache_for_subscription
from services.trigger.oauth_gateway import PluginTriggerOAuthGateway
from services.trigger.provider_loader import PluginTriggerProviderLoader
from services.trigger.subscription_codec import ProviderTriggerSubscriptionCodec
from services.trigger.subscription_gateway import PluginTriggerSubscriptionGateway, invalidate_subscription_properties
from services.trigger.subscription_renewal_service import TriggerSubscriptionRenewalService
from services.trigger.subscription_service import TriggerSubscriptionLeaseLostError, TriggerSubscriptionService
from tests.unit_tests.controllers.console.workspace import test_trigger_oauth_client, test_trigger_subscription_builder
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_builder import _Daemon
from tests.unit_tests.controllers.console.workspace.test_trigger_subscription_query import _add_subscription
from tests.unit_tests.services.trigger.test_subscription_mutation_serialization import _Locks

application_redis = test_trigger_oauth_client.application_redis
harness = test_trigger_oauth_client.harness
daemon = test_trigger_subscription_builder.daemon


def _refresh(harness: _Harness, tenant_id: str, subscription_id: str, locks: _Locks | None = None) -> None:
    def run() -> None:
        with harness.app.app_context():
            renewal = TriggerSubscriptionRenewalService(
                subscriptions=TriggerSubscriptionRepository(session_factory=harness.session_factory),
                providers=PluginTriggerSubscriptionGateway(
                    providers=PluginTriggerProviderLoader(client=PluginTriggerClient())
                ),
                oauth=PluginTriggerOAuthGateway(
                    oauth=OAuthHandler(), providers=PluginTriggerProviderLoader(client=PluginTriggerClient())
                ),
                clients=application_services().triggers.oauth_clients,
                locks=locks or _Locks(),
                codec=ProviderTriggerSubscriptionCodec(),
                credential_threshold=10,
                subscription_threshold=10,
                console_api_url="https://console.example.test",
                invalidate_cache=delete_cache_for_subscription,
                invalidate_properties=invalidate_subscription_properties,
            )
            renewal.refresh_if_due(tenant_id=tenant_id, subscription_id=subscription_id, now=100)

    Context().run(run)


def _prepare_oauth_renewal(harness: _Harness, daemon: _Daemon, *, subscription_expiry: int) -> TriggerSubscription:
    subscription = _add_subscription(harness, credential_type=CredentialType.OAUTH2, credentials={"token": "old"})
    with harness.session_factory.begin() as session:
        row = session.get(TriggerSubscription, subscription.id)
        assert row is not None
        row.credential_expires_at = 100
        row.expires_at = subscription_expiry
    declaration = daemon.provider["declaration"]
    assert isinstance(declaration, dict)
    credential_schema: list[dict[str, object]] = []
    declaration["subscription_constructor"] = {"oauth_schema": {"credentials_schema": credential_schema}}
    path = f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials"
    daemon.responses_by_path[path] = {"credentials": {"token": "new"}, "expires_at": 1000}
    daemon.pause_path = path
    return subscription


def test_oauth_renewal_persists_non_string_credential_values(harness: _Harness, daemon: _Daemon) -> None:
    subscription = _prepare_oauth_renewal(harness, daemon, subscription_expiry=-1)
    path = f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials"
    empty_items: list[str] = []
    credentials: dict[str, object] = {"token": "new", "enabled": False, "count": 0, "details": {"items": empty_items}}
    daemon.responses_by_path[path] = {"credentials": credentials, "expires_at": 1000}
    daemon.pause_path = None

    _refresh(harness, harness.tenant_id, subscription.id)

    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        assert saved is not None
        assert saved.credentials == credentials
        assert saved.credential_expires_at == 1000
    snapshot = TriggerSubscriptionRepository(session_factory=harness.session_factory).get(
        tenant_id=harness.tenant_id, subscription_id=subscription.id
    )
    assert snapshot is not None
    assert snapshot.credentials == credentials


@pytest.mark.parametrize("second_operation", ["renewal", "rename"])
def test_oauth_renewal_serializes_other_mutations(harness: _Harness, daemon: _Daemon, second_operation: str) -> None:
    subscription = _prepare_oauth_renewal(harness, daemon, subscription_expiry=-1)
    path = f"/plugin/{harness.tenant_id}/dispatch/oauth/refresh_credentials"
    locks = _Locks()
    errors: list[BaseException] = []
    finished = Event()

    def run(*, rename: bool = False) -> None:
        try:
            if rename:

                def update_name() -> None:
                    with harness.app.app_context():
                        management = TriggerSubscriptionService(
                            subscriptions=TriggerSubscriptionRepository(session_factory=harness.session_factory),
                            providers=PluginTriggerSubscriptionGateway(
                                providers=PluginTriggerProviderLoader(client=PluginTriggerClient())
                            ),
                            locks=locks,
                            codec=ProviderTriggerSubscriptionCodec(),
                            invalidate_cache=delete_cache_for_subscription,
                        )
                        management.update(
                            tenant_id=harness.tenant_id,
                            subscription_id=subscription.id,
                            name="renamed",
                            credentials=None,
                            parameters=None,
                            properties=None,
                        )

                Context().run(update_name)
            else:
                _refresh(harness, harness.tenant_id, subscription.id, locks)
        except BaseException as error:
            errors.append(error)
        finally:
            finished.set()

    first = Thread(target=run, daemon=True)
    second = Thread(target=run, kwargs={"rename": second_operation == "rename"}, daemon=True)
    first.start()
    try:
        assert daemon.request_started.wait(timeout=5)
        second.start()
        assert locks.second_attempted.wait(timeout=5)
        assert not finished.is_set()
    finally:
        daemon.resume_response.set()
        first.join(timeout=10)
        if second.ident is not None:
            second.join(timeout=10)

    assert not first.is_alive()
    assert not second.is_alive()
    assert not errors
    assert [entry.path for entry in daemon.requests if entry.method == "POST"] == [path]
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        assert saved is not None
        assert saved.credentials == {"token": "new"}
        assert saved.credential_expires_at == 1000
        assert saved.name == ("renamed" if second_operation == "rename" else subscription.name)


def test_lost_lease_after_oauth_skips_write_and_subscription_refresh(harness: _Harness, daemon: _Daemon) -> None:
    subscription = _prepare_oauth_renewal(harness, daemon, subscription_expiry=100)
    locks = _Locks()
    errors: list[BaseException] = []

    def run() -> None:
        try:
            _refresh(harness, harness.tenant_id, subscription.id, locks)
        except BaseException as error:
            errors.append(error)

    worker = Thread(target=run, daemon=True)
    worker.start()
    try:
        assert daemon.request_started.wait(timeout=5)
        locks.lease.lost.set()
    finally:
        daemon.resume_response.set()
        worker.join(timeout=10)

    assert not worker.is_alive()
    assert len(errors) == 1
    assert isinstance(errors[0], TriggerSubscriptionLeaseLostError)
    assert [entry.path for entry in daemon.requests if entry.method == "POST"] == [daemon.pause_path]
    with harness.session_factory() as session:
        saved = session.get(TriggerSubscription, subscription.id)
        assert saved is not None
        assert saved.credentials == {"token": "old"}
        assert saved.credential_expires_at == 100
        assert saved.expires_at == 100


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
