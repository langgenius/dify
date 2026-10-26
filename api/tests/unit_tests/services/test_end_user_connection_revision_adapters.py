"""Provider consent stays scoped to the Web App without requiring a published node."""

from dataclasses import replace

import pytest
from sqlalchemy.orm import Session, sessionmaker

from repositories.end_user_connection_repository import EndUserConnectionRepository
from services.end_user_connection_revision_adapters import PluginConnectionProviderRevisions
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import ConnectionContractSnapshot, ProviderContractSnapshot
from tests.helpers.end_user_api_key import PROVIDER, ScriptedAuth, TestProviders, plugin_provider


@pytest.fixture
def snapshots(sqlite_session_factory: sessionmaker[Session]) -> EndUserConnectionRepository:
    return EndUserConnectionRepository(session_factory=sqlite_session_factory)


def test_provider_revision_detects_unverified_replacement_and_returns_current_id(
    snapshots: EndUserConnectionRepository,
) -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers, snapshots=snapshots)
    previous = revisions.resolve(context, PROVIDER)
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    providers.controller.plugin_unique_identifier = upgraded
    with pytest.raises(ConnectionRevisionChangedError) as caught:
        revisions.require(context, PROVIDER, previous)
    error = caught.value
    assert error.current_revision == revisions.resolve(context, PROVIDER)
    providers.trusted_artifacts.add(upgraded)
    assert revisions.require(context, PROVIDER, previous).plugin_unique_identifier == upgraded


@pytest.mark.parametrize("change", ["app", "tenant", "provider", "unknown"])
def test_provider_revision_cannot_cross_its_persisted_scope(
    change: str, snapshots: EndUserConnectionRepository
) -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers, snapshots=snapshots)
    revision = revisions.resolve(context, PROVIDER)
    if change == "app":
        context = replace(context, app_id="other")
    elif change == "tenant":
        context = replace(context, tenant_id="other")
    elif change == "provider":
        snapshot = ConnectionContractSnapshot(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            requirements=(),
            providers=(
                ProviderContractSnapshot(
                    provider="other/plugin/provider", plugin_unique_identifier="other/plugin:1.0.0@" + "a" * 64
                ),
            ),
        )
        revision = snapshots.save_revision(snapshot)
    else:
        revision = "cr_" + "0" * 64
    with pytest.raises(ConnectionRevisionChangedError):
        revisions.reference(context, PROVIDER, revision)


def test_revocation_reference_does_not_consult_the_current_installation(
    monkeypatch: pytest.MonkeyPatch, snapshots: EndUserConnectionRepository
) -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers, snapshots=snapshots)
    revision = revisions.resolve(context, PROVIDER)

    def unavailable(_tenant_id: str, _provider: str) -> str:
        pytest.fail("Revocation consent must remain usable after uninstall or replacement.")

    monkeypatch.setattr(providers, "plugin_unique_identifier", unavailable)
    assert (
        revisions.reference(context, PROVIDER, revision).plugin_unique_identifier
        == providers.controller.plugin_unique_identifier
    )
