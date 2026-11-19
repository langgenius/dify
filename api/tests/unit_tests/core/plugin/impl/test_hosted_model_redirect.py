import json
from uuid import UUID

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.plugin.impl import model as plugin_model
from enums.model_billing import TenantTokenerIntegrationStatus
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.provider import ProviderCredential
from models.tokener import TenantTokenerIntegration
from services.entities.hosted_model_routing import TokenerHostedModelCredentials
from tests.helpers.unit.core.model_fixtures import make_model_config

SOURCE = "langgenius/openai/openai"
TARGET = "langgenius/tokener/tokener"
TARGET_UID = "langgenius/tokener:0.4.4@" + "a" * 64
MODEL = "gpt-4o-mini"
SOURCE_HEADERS = {"X-Plugin-ID": "langgenius/openai", "Content-Type": "application/json"}


def _bind_tenant(session: Session) -> tuple[str, str]:
    """Create a real ready tenant binding for the dispatch repository."""
    tenant = Tenant(name="Hosted route test")
    session.add(tenant)
    session.flush()
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name=TARGET,
        credential_name="managed",
        encrypted_config='{"api_key":"encrypted-test-only"}',
    )
    session.add(credential)
    session.flush()
    session.add_all(
        [
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source="tokener"),
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                status=TenantTokenerIntegrationStatus.READY,
                plugin_unique_identifier=TARGET_UID,
                provider_credential_id=credential.id,
            ),
        ]
    )
    session.commit()
    return tenant.id, credential.id


def test_hosted_dispatch_preserves_source_model_parameters_and_uses_only_bound_target(
    sqlite_session: Session, mocker: MockerFixture
) -> None:
    tenant_id, credential_id = _bind_tenant(sqlite_session)
    decrypt = mocker.patch.object(plugin_model.encrypter, "decrypt_token", return_value="decrypted-test-only")
    check_policy = mocker.patch.object(plugin_model, "runtime_check_credential_policy_compliance")
    marker = TokenerHostedModelCredentials(tenant_id=tenant_id, provider=SOURCE, model_type="llm", model=MODEL)
    model_config = make_model_config(provider=SOURCE, model=MODEL, mode="chat")
    arguments = model_config.model_dump()
    arguments["provider_model_bundle"] = model_config.provider_model_bundle
    arguments["credentials"] = marker
    coerced = ModelConfigWithCredentialsEntity.model_validate(arguments)
    assert coerced.credentials is marker
    assert coerced.model_dump()["credentials"] == {}
    original = {
        "provider": "openai",
        "model": MODEL,
        "model_type": "llm",
        "credentials": marker,
        "model_parameters": {"opaque": {"nullable": None, "precision": 9007199254740993}, "max_tokens": 9},
        "prompt_messages": [{"role": "user", "content": [{"type": "image", "url": "https://example.com/image"}]}],
        "tools": [{"name": "test", "opaque": ["literal", False]}],
        "stop": ["stop"],
        "stream": True,
    }
    client = plugin_model.PluginModelClient()
    url, _, body, _, _ = client._prepare_request(
        f"plugin/{tenant_id}/dispatch/llm/invoke",
        SOURCE_HEADERS,
        client._dispatch_payload(user_id=None, app_id="app-id", data=original),
        None,
        None,
    )
    assert url.endswith(f"/plugin/{tenant_id}/dispatch/redirect/v1/llm/invoke")
    assert isinstance(body, str)
    payload = json.loads(body)
    UUID(payload["redirect"].pop("route_id"))
    assert payload == {
        "user_id": "",
        "app_id": "app-id",
        "data": {**original, "credentials": {}},
        "redirect": {
            "version": 1,
            "target": {
                "plugin_id": "langgenius/tokener",
                "expected_unique_identifier": TARGET_UID,
                "provider": "tokener",
                "model_type": "llm",
                "model": MODEL,
                "credentials": {"api_key": "decrypted-test-only"},
            },
        },
    }
    decrypt.assert_called_once_with(tenant_id=tenant_id, token="encrypted-test-only")
    assert check_policy.call_args.kwargs["credential_id"] == credential_id


def test_plain_credentials_cannot_activate_hosted_redirect(mocker: MockerFixture) -> None:
    target = mocker.patch.object(plugin_model.PluginModelClient, "_tokener_target")
    credentials = {"api_key": "byok-test-only", "_managed_model_route": {"provider": SOURCE}}
    client = plugin_model.PluginModelClient()
    url, _, body, _, _ = client._prepare_request(
        "plugin/tenant-id/dispatch/llm/invoke",
        SOURCE_HEADERS,
        client._dispatch_payload(user_id="user-id", data={"provider": "openai", "credentials": credentials}),
        None,
        None,
    )
    assert url.endswith("/plugin/tenant-id/dispatch/llm/invoke")
    assert isinstance(body, str)
    assert json.loads(body) == {"user_id": "user-id", "data": {"provider": "openai", "credentials": credentials}}
    target.assert_not_called()


def test_managed_route_fails_closed_on_cross_tenant_or_unready_binding(
    sqlite_session: Session, mocker: MockerFixture
) -> None:
    tenant_id, _ = _bind_tenant(sqlite_session)
    decrypt = mocker.patch.object(plugin_model.encrypter, "decrypt_token")
    marker = TokenerHostedModelCredentials(tenant_id=tenant_id, provider=SOURCE, model_type="llm", model=MODEL)
    client = plugin_model.PluginModelClient()
    data = client._dispatch_payload(
        user_id=None,
        data={"provider": "openai", "model": MODEL, "model_type": "llm", "credentials": marker},
    )
    with pytest.raises(ValueError, match="does not match"):
        client._prepare_request("plugin/another-tenant/dispatch/llm/invoke", SOURCE_HEADERS, data, None, None)

    integration = sqlite_session.scalars(
        select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant_id)
    ).one()
    integration.status = TenantTokenerIntegrationStatus.CONFIGURING_PROVIDER
    sqlite_session.commit()
    with pytest.raises(ValueError, match="temporarily unavailable"):
        client._prepare_request(f"plugin/{tenant_id}/dispatch/llm/invoke", SOURCE_HEADERS, data, None, None)
    decrypt.assert_not_called()
