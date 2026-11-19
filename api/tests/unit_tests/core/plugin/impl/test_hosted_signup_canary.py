import json
from datetime import datetime

from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.plugin.impl import model as plugin_model
from models.account import Account, Tenant
from models.model_billing import TenantModelBillingProfile
from models.provider import ProviderCredential
from models.tokener import AccountTokenerSignupIntent, TenantTokenerIntegration, TenantTokenerIntegrationStatus
from repositories.tokener_signup_canary_repository import CANARY_STAGING_PROVIDER
from services.entities.hosted_model_routing import TokenerHostedModelCredentials


def test_hosted_signup_uses_only_pinned_target_and_preserves_raw_payload(
    sqlite_session: Session, mocker: MockerFixture
) -> None:
    uid = "langgenius/tokener-staging:0.4.4@signup-test"
    tenant = Tenant(name="isolated signup")
    owner = Account(name="test", email="canary-dispatch@example.invalid")
    sqlite_session.add_all([tenant, owner])
    sqlite_session.flush()
    credential = ProviderCredential(
        tenant_id=tenant.id,
        provider_name=CANARY_STAGING_PROVIDER,
        credential_name="managed",
        encrypted_config='{"api_key":"encrypted-unit-value"}',
    )
    sqlite_session.add(credential)
    sqlite_session.flush()
    sqlite_session.add_all(
        [
            AccountTokenerSignupIntent(
                account_id=owner.id,
                consumed_tenant_id=tenant.id,
                consumed_at=datetime(2026, 11, 19, 4, 0),
                plugin_unique_identifier=uid,
            ),
            TenantModelBillingProfile(tenant_id=tenant.id, model_billing_source="tokener"),
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                status=TenantTokenerIntegrationStatus.READY,
                plugin_unique_identifier=uid,
                provider_credential_id=credential.id,
            ),
        ]
    )
    sqlite_session.commit()

    mocker.patch.object(plugin_model.encrypter, "decrypt_token", return_value="unit-model-credential")
    mocker.patch.object(plugin_model, "runtime_check_credential_policy_compliance")
    client = plugin_model.PluginModelClient()
    request_path = f"plugin/{tenant.id}/dispatch/llm/invoke"
    headers = {"X-Plugin-ID": "langgenius/openai", "Content-Type": "application/json"}
    marker = TokenerHostedModelCredentials(
        tenant_id=tenant.id, provider="langgenius/openai/openai", model_type="llm", model="gpt-4o-mini"
    )
    raw = {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "model_type": "llm",
        "model_parameters": {"arbitrary": [None, 9007199254740993, {"unknown": True}]},
        "prompt_messages": [{"role": "user", "content": "ping"}],
        "stream": True,
    }
    url, _, body, _, _ = client._prepare_request(
        request_path,
        headers,
        client._dispatch_payload(user_id=None, app_id="app-id", data={**raw, "credentials": marker}),
        None,
        None,
    )
    payload = json.loads(body)
    assert url.endswith(f"/plugin/{tenant.id}/dispatch/redirect/v1/llm/invoke")
    assert payload["data"] == {**raw, "credentials": {}}
    assert payload["app_id"] == "app-id"
    assert payload["redirect"]["target"] == {
        "plugin_id": "langgenius/tokener-staging",
        "expected_unique_identifier": uid,
        "provider": "tokener",
        "model_type": "llm",
        "model": "gpt-4o-mini",
        "credentials": {"api_key": "unit-model-credential"},
    }

    url, _, body, _, _ = client._prepare_request(
        request_path,
        headers,
        client._dispatch_payload(user_id=None, data={**raw, "credentials": {"api_key": "ordinary-custom-unit-value"}}),
        None,
        None,
    )
    assert url.endswith(f"/{request_path}")
    assert "redirect" not in json.loads(body)
