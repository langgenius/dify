"""Provider consent stays scoped to the Web App without requiring a published node."""

from dataclasses import replace

import pytest

from services.end_user_connection_revision_adapters import ConnectionRevisionCodec, PluginConnectionProviderRevisions
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import ConnectionContractSnapshot, ProviderContractSnapshot
from tests.helpers.end_user_api_key import PROVIDER, ScriptedAuth, TestProviders, plugin_provider

pytestmark = pytest.mark.usefixtures("connection_revision_key")


def test_provider_revision_detects_unverified_replacement_and_returns_the_changed_artifact() -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers)
    previous = revisions.resolve(context, PROVIDER)
    original = providers.controller.plugin_unique_identifier
    upgraded = "vendor/calendar:2.0.0@" + "b" * 64
    providers.controller.plugin_unique_identifier = upgraded
    with pytest.raises(ConnectionRevisionChangedError) as caught:
        revisions.require(context, PROVIDER, previous)
    error = caught.value
    assert error.previous is not None
    assert error.current is not None
    assert error.previous.providers[0].plugin_unique_identifier == original
    assert error.current.providers[0].plugin_unique_identifier == upgraded
    assert error.current_revision == revisions.resolve(context, PROVIDER)
    providers.trusted_artifacts.add(upgraded)
    assert revisions.require(context, PROVIDER, previous).plugin_unique_identifier == upgraded


@pytest.mark.parametrize("change", ["app", "tenant", "provider", "signature"])
def test_provider_revision_cannot_cross_its_signed_scope(change: str) -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers)
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
        revision = ConnectionRevisionCodec.encode(snapshot)
    else:
        header, payload, signature = revision.split(".")
        revision = ".".join([header, payload, ("A" if signature[0] != "A" else "B") + signature[1:]])
    with pytest.raises(ConnectionRevisionChangedError):
        revisions.reference(context, PROVIDER, revision)


def test_revocation_reference_does_not_consult_the_current_installation(monkeypatch: pytest.MonkeyPatch) -> None:
    context = WebConnectionContext("tenant", "app", "user", "account")
    providers = TestProviders(ScriptedAuth(), plugin_provider(context.tenant_id))
    revisions = PluginConnectionProviderRevisions(providers=providers)
    revision = revisions.resolve(context, PROVIDER)

    def unavailable(_tenant_id: str, _provider: str) -> str:
        pytest.fail("Revocation consent must remain usable after uninstall or replacement.")

    monkeypatch.setattr(providers, "plugin_unique_identifier", unavailable)
    assert (
        revisions.reference(context, PROVIDER, revision).plugin_unique_identifier
        == providers.controller.plugin_unique_identifier
    )
