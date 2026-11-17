"""Exact native-node reads keep unknown separate from false and scope subscriptions."""

import inspect
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from controllers.inner_api.app.trigger_native import NativeTriggerStates
from core.plugin.entities.plugin_daemon import CredentialType
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger, TriggerSubscription
from repositories.app.enterprise_app_repository import EnterpriseAppRepository
from services.app.trigger_native import NativeTriggerNode, NativeTriggerState


def test_native_endpoint_preserves_null_and_passes_exact_nodes(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    """Validated ownership and node references reach the use case; null remains null on the wire."""
    tenant_id, app_id = uuid4(), uuid4()

    def states(tenant: str, app: str, nodes: list[NativeTriggerNode]) -> dict[str, NativeTriggerState]:
        assert tenant == str(tenant_id)
        assert app == str(app_id)
        assert nodes == [NativeTriggerNode("plugin", "trigger-plugin", "subscription", "provider")]
        return {"plugin": NativeTriggerState(enabled=None, authorized=False)}

    monkeypatch.setattr(
        "controllers.inner_api.app.trigger_native.application_services",
        lambda: SimpleNamespace(apps=SimpleNamespace(enterprise=SimpleNamespace(native_trigger_states=states))),
    )
    with app.test_request_context(
        json={
            "tenant_id": str(tenant_id),
            "nodes": [
                {
                    "node_id": "plugin",
                    "trigger_type": "trigger-plugin",
                    "subscription_id": "subscription",
                    "provider_id": "provider",
                }
            ],
        }
    ):
        result = inspect.unwrap(NativeTriggerStates.post)(NativeTriggerStates(), UUID(str(app_id)))
    assert result == {"data": {"plugin": {"enabled": None, "authorized": False}}}


def test_native_state_and_subscription_deletion(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    """A successful read preserves unknown nodes; deleting a subscription changes only authorization."""
    tenant_id = str(uuid4())
    app = App(tenant_id=tenant_id, name="native", mode=AppMode.WORKFLOW, enable_site=False, enable_api=False)
    sqlite_session.add(app)
    sqlite_session.flush()
    subscription = TriggerSubscription(
        name="native",
        tenant_id=tenant_id,
        user_id=str(uuid4()),
        provider_id="provider",
        endpoint_id=str(uuid4()),
        parameters={},
        properties={},
        credentials={},
        credential_type=CredentialType.API_KEY,
    )
    sqlite_session.add(subscription)
    sqlite_session.add_all(
        [
            AppTrigger(
                tenant_id=tenant_id,
                app_id=app.id,
                node_id="enabled",
                title="enabled",
                trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
                status=AppTriggerStatus.ENABLED,
            ),
            AppTrigger(
                tenant_id=tenant_id,
                app_id=app.id,
                node_id="disabled",
                title="disabled",
                trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                status=AppTriggerStatus.DISABLED,
            ),
        ]
    )
    sqlite_session.commit()
    app_id, subscription_id = app.id, subscription.id
    nodes = [
        NativeTriggerNode("enabled", "trigger-webhook", "", ""),
        NativeTriggerNode("disabled", "trigger-schedule", "", ""),
        NativeTriggerNode("plugin", "trigger-plugin", subscription_id, "provider"),
        NativeTriggerNode("wrong-provider", "trigger-plugin", subscription_id, "other"),
        NativeTriggerNode("unknown", "trigger-webhook", "", ""),
    ]
    repo = EnterpriseAppRepository(session_factory=sqlite_session_factory, app_web_url="", service_api_url="")
    states = repo.native_trigger_states(tenant_id, app_id, nodes)
    assert states["enabled"].enabled is True
    assert states["disabled"].enabled is False
    assert states["unknown"].enabled is None
    assert states["unknown"].authorized is None
    assert states["plugin"].enabled is None
    assert states["plugin"].authorized is True
    assert states["wrong-provider"].authorized is False
    sqlite_session.delete(subscription)
    sqlite_session.commit()
    assert repo.native_trigger_states(tenant_id, app_id, nodes)["plugin"].authorized is False
    with pytest.raises(ValueError, match="app not found"):
        repo.native_trigger_states(str(uuid4()), app_id, nodes)
