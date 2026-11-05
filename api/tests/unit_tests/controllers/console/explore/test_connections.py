"""Installed App Connection transport uses the Web App field vocabulary and Console admission."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import create_autospec
from uuid import uuid4

import pytest

import controllers.console.explore.connections as module
from services.end_user_connections.contracts import ConnectionPage, ConnectionSummary
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.preflight import ConnectionPreflightStatus, ConnectionPreflightView
from services.end_user_connections.selections import ConnectionConfiguration
from services.installed_app_connections import InstalledAppConnectionService
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import harness

__all__ = ["harness"]


@pytest.fixture
def transport(harness, monkeypatch: pytest.MonkeyPatch):
    connections = create_autospec(InstalledAppConnectionService, instance=True, spec_set=True)
    monkeypatch.setattr(
        module, "application_services", lambda: SimpleNamespace(installed_apps=SimpleNamespace(connections=connections))
    )
    prefix = "/installed-apps/<uuid:installed_app_id>/connections"
    for resource, suffix in (
        (module.InstalledConnectionsApi, ""),
        (module.InstalledConnectionConfigurationApi, "/configuration"),
        (module.InstalledConnectionPreflightApi, "/preflight"),
    ):
        harness.api.add_resource(resource, prefix + suffix)
    now = datetime(2026, 11, 4)
    summary = ConnectionSummary(
        id=str(uuid4()),
        name="Team OAuth",
        provider="vendor/calendar/calendar",
        credential_type="oauth2",
        credential_status=None,
        account_label=None,
        created_at=now,
        updated_at=now,
        last_active_at=None,
        expires_at=None,
    )
    revision = str(uuid4())
    connections.list_connections.return_value = ConnectionPage(data=(summary,), next_cursor=None)
    connections.configuration.return_value = ConnectionConfiguration(
        connections={"root": summary}, reauthorization_required=False
    )
    connections.save_configuration.return_value = connections.configuration.return_value
    connections.preflight.return_value = ConnectionPreflightView(
        workflow_id=str(uuid4()),
        connection_revision=revision,
        connections=(
            ConnectionPreflightStatus(
                node_id="root", provider=summary.provider, connection_id=summary.id, status="connected", check=None
            ),
        ),
    )
    return SimpleNamespace(
        harness=harness,
        service=connections,
        summary=summary,
        revision=revision,
        client=harness.app.test_client(),
        url=f"/installed-apps/{harness.installed_app.id}/connections",
    )


def test_list_serializes_webapp_fields_and_admitted_member_scope(transport):
    response = transport.client.get(transport.url, query_string={"provider": transport.summary.provider, "limit": 10})
    assert response.status_code == 200
    result = response.get_json()
    assert set(result) == {"data", "has_more", "next_cursor"}
    assert set(result["data"][0]) == {
        "id",
        "name",
        "provider",
        "credential_type",
        "credential_status",
        "account_label",
        "expires_at",
        "created_at",
        "updated_at",
        "last_active_at",
    }
    assert isinstance(result["data"][0]["created_at"], int)
    assert result["data"][0]["last_active_at"] is None
    args, kwargs = transport.service.list_connections.call_args
    assert args[0].account_id == transport.harness.account.id
    assert args[0].tenant_id == transport.harness.installed_app.tenant_id
    assert args[0].installed_app_id == transport.harness.installed_app.id
    assert kwargs == {"provider": transport.summary.provider, "cursor": None, "limit": 10}


def test_configuration_get_put_preserves_ids_and_explicit_empty_selection(transport):
    conversation_id = str(uuid4())
    response = transport.client.get(transport.url + "/configuration", query_string={"conversation_id": conversation_id})
    assert response.status_code == 200
    assert response.get_json()["connections"]["root"]["id"] == transport.summary.id
    assert transport.service.configuration.call_args.args[1] == conversation_id
    response = transport.client.put(
        transport.url + "/configuration",
        json={"connection_revision": transport.revision, "connections": {}, "conversation_id": conversation_id},
    )
    assert response.status_code == 200
    command = transport.service.save_configuration.call_args.args[1]
    assert command.connections == {}
    assert str(command.conversation_id) == conversation_id


def test_preflight_uses_webapp_request_and_response_contract(transport):
    response = transport.client.post(
        transport.url + "/preflight",
        json={"connection_revision": transport.revision, "connections": {"root": transport.summary.id}},
    )
    assert response.status_code == 200
    assert response.get_json() == {
        "connection_revision": transport.revision,
        "ready": True,
        "connections": [
            {"node_id": "root", "connection_id": transport.summary.id, "status": "connected", "check": None}
        ],
    }
    assert str(transport.service.preflight.call_args.args[1].connections["root"]) == transport.summary.id


def test_queries_require_console_admission_before_connection_lookup(transport):
    transport.harness.state.allowed = False
    response = transport.client.get(transport.url)
    assert response.status_code == 403
    transport.service.list_connections.assert_not_called()
    transport.service.configuration.assert_not_called()


def test_changed_revision_preserves_webapp_error_shape(transport):
    transport.service.preflight.side_effect = ConnectionRevisionChangedError(current_revision=transport.revision)
    response = transport.client.post(
        transport.url + "/preflight", json={"connection_revision": str(uuid4()), "connections": {}}
    )
    assert response.status_code == 409
    assert response.get_json()["code"] == "connection_revision_changed"
    assert response.get_json()["details"] == {"connection_revision": transport.revision}


def test_invalid_preflight_payload_is_rejected_before_service(transport):
    response = transport.client.post(
        transport.url + "/preflight",
        json={"connection_revision": transport.revision, "connections": {"root": "not-a-credential"}},
    )
    assert response.status_code == 400
    transport.service.preflight.assert_not_called()
