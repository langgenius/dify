"""Unit tests for runtime credential inner API."""

import inspect
import json
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.inner_api.runtime_credentials import (
    EnterpriseRuntimeCredentialsResolve,
    InnerRuntimeCredentialsResolvePayload,
)
from models.provider import ProviderCredential
from models.tools import BuiltinToolProvider


def test_runtime_credentials_payload_accepts_items():
    payload = InnerRuntimeCredentialsResolvePayload.model_validate(
        {
            "tenant_id": "tenant-1",
            "credentials": [
                {
                    "credential_id": "credential-1",
                    "provider": "langgenius/openai/openai",
                    "kind": "model",
                }
            ],
        }
    )

    assert payload.tenant_id == "tenant-1"
    assert payload.credentials[0].provider == "langgenius/openai/openai"
    assert payload.credentials[0].kind == "model"


@patch("controllers.inner_api.runtime_credentials.encrypter.decrypt_token")
@patch("controllers.inner_api.runtime_credentials.db")
@patch("controllers.inner_api.runtime_credentials.create_plugin_provider_manager")
@pytest.mark.parametrize("sqlite_session", [(ProviderCredential,)], indirect=True)
def test_runtime_model_credentials_resolve_returns_decrypted_values(
    mock_provider_manager_factory,
    mock_db,
    mock_decrypt_token,
    app: Flask,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    provider_configuration = MagicMock()
    provider_configuration.provider.provider_credential_schema.credential_form_schemas = []
    provider_configuration.extract_secret_variables.return_value = ["openai_api_key"]
    provider_configuration._get_provider_names.return_value = ["langgenius/openai/openai", "openai"]

    provider_configurations = MagicMock()
    provider_configurations.get.return_value = provider_configuration
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value = provider_configurations
    mock_provider_manager_factory.return_value = provider_manager

    credential = ProviderCredential(
        tenant_id="tenant-1",
        provider_name="langgenius/openai/openai",
        credential_name="OpenAI",
        encrypted_config='{"openai_api_key":"encrypted","api_base":"https://api.openai.com/v1"}',
    )
    credential.id = "credential-1"
    sqlite_session.add(credential)
    sqlite_session.commit()
    mock_db.engine = sqlite_engine
    mock_decrypt_token.return_value = "sk-test"

    handler = EnterpriseRuntimeCredentialsResolve()
    unwrapped = inspect.unwrap(handler.post)
    with app.test_request_context():
        with patch("controllers.inner_api.runtime_credentials.inner_api_ns") as mock_ns:
            mock_ns.payload = {
                "tenant_id": "tenant-1",
                "credentials": [
                    {
                        "credential_id": "credential-1",
                        "provider": "langgenius/openai/openai",
                        "kind": "model",
                    }
                ],
            }
            body, status_code = unwrapped(handler)

    assert status_code == 200
    assert body["credentials"][0]["kind"] == "model"
    assert body["credentials"][0]["values"]["openai_api_key"] == "sk-test"
    assert body["credentials"][0]["values"]["api_base"] == "https://api.openai.com/v1"
    mock_decrypt_token.assert_called_once_with(tenant_id="tenant-1", token="encrypted")


@patch("controllers.inner_api.runtime_credentials.create_plugin_provider_manager")
def test_runtime_model_credentials_resolve_rejects_unknown_provider(mock_provider_manager_factory, app: Flask):
    provider_configurations = MagicMock()
    provider_configurations.get.return_value = None
    provider_manager = MagicMock()
    provider_manager.get_configurations.return_value = provider_configurations
    mock_provider_manager_factory.return_value = provider_manager

    handler = EnterpriseRuntimeCredentialsResolve()
    unwrapped = inspect.unwrap(handler.post)
    with app.test_request_context():
        with patch("controllers.inner_api.runtime_credentials.inner_api_ns") as mock_ns:
            mock_ns.payload = {
                "tenant_id": "tenant-1",
                "credentials": [{"credential_id": "credential-1", "provider": "missing", "kind": "model"}],
            }
            body, status_code = unwrapped(handler)

    assert status_code == 404
    assert "provider" in body["message"]


@patch("controllers.inner_api.runtime_credentials.create_provider_encrypter")
@patch("controllers.inner_api.runtime_credentials.ToolProviderCredentialsCache")
@patch("controllers.inner_api.runtime_credentials.db")
@patch("controllers.inner_api.runtime_credentials.ToolManager")
@pytest.mark.parametrize("sqlite_session", [(BuiltinToolProvider,)], indirect=True)
def test_runtime_tool_credentials_resolve_returns_decrypted_values(
    mock_tool_manager,
    mock_db,
    mock_cache_cls,
    mock_create_encrypter,
    app: Flask,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    provider_controller = MagicMock()
    provider_controller.get_credentials_schema_by_type.return_value = []
    mock_tool_manager.get_builtin_provider.return_value = provider_controller

    builtin_provider = BuiltinToolProvider(
        tenant_id="tenant-1",
        user_id="user-1",
        provider="langgenius/tavily/tavily",
        name="Tavily",
        encrypted_credentials=json.dumps({"tavily_api_key": "encrypted"}),
    )
    builtin_provider.id = "credential-1"
    sqlite_session.add(builtin_provider)
    sqlite_session.commit()
    mock_db.engine = sqlite_engine

    provider_encrypter = MagicMock()
    provider_encrypter.decrypt.return_value = {"tavily_api_key": "tvly-secret"}
    mock_create_encrypter.return_value = (provider_encrypter, MagicMock())

    handler = EnterpriseRuntimeCredentialsResolve()
    unwrapped = inspect.unwrap(handler.post)
    with app.test_request_context():
        with patch("controllers.inner_api.runtime_credentials.inner_api_ns") as mock_ns:
            mock_ns.payload = {
                "tenant_id": "tenant-1",
                "credentials": [
                    {
                        "credential_id": "credential-1",
                        "provider": "langgenius/tavily/tavily",
                        "kind": "tool",
                    }
                ],
            }
            body, status_code = unwrapped(handler)

    assert status_code == 200
    assert body["credentials"][0]["kind"] == "tool"
    assert body["credentials"][0]["provider"] == "langgenius/tavily/tavily"
    assert body["credentials"][0]["values"]["tavily_api_key"] == "tvly-secret"
    provider_encrypter.decrypt.assert_called_once_with({"tavily_api_key": "encrypted"})


@patch("controllers.inner_api.runtime_credentials.db")
@patch("controllers.inner_api.runtime_credentials.ToolManager")
@pytest.mark.parametrize("sqlite_session", [(BuiltinToolProvider,)], indirect=True)
def test_runtime_tool_credentials_resolve_rejects_unknown_credential(
    mock_tool_manager,
    mock_db,
    app: Flask,
    sqlite_engine: Engine,
    sqlite_session: Session,
):
    mock_tool_manager.get_builtin_provider.return_value = MagicMock()

    # The requested id exists for another tenant, proving the resolver does not
    # expose a credential across workspace boundaries.
    builtin_provider = BuiltinToolProvider(
        tenant_id="tenant-2",
        user_id="user-2",
        provider="langgenius/tavily/tavily",
        name="Other workspace Tavily",
        encrypted_credentials=json.dumps({"tavily_api_key": "encrypted"}),
    )
    builtin_provider.id = "missing"
    sqlite_session.add(builtin_provider)
    sqlite_session.commit()
    mock_db.engine = sqlite_engine

    handler = EnterpriseRuntimeCredentialsResolve()
    unwrapped = inspect.unwrap(handler.post)
    with app.test_request_context():
        with patch("controllers.inner_api.runtime_credentials.inner_api_ns") as mock_ns:
            mock_ns.payload = {
                "tenant_id": "tenant-1",
                "credentials": [{"credential_id": "missing", "provider": "langgenius/tavily/tavily", "kind": "tool"}],
            }
            body, status_code = unwrapped(handler)

    assert status_code == 404
    assert "credential" in body["message"]


def test_runtime_credentials_resolve_rejects_unknown_kind(app: Flask):
    handler = EnterpriseRuntimeCredentialsResolve()
    unwrapped = inspect.unwrap(handler.post)
    with app.test_request_context():
        with patch("controllers.inner_api.runtime_credentials.inner_api_ns") as mock_ns:
            mock_ns.payload = {
                "tenant_id": "tenant-1",
                "credentials": [{"credential_id": "credential-1", "provider": "x", "kind": "secret"}],
            }
            body, status_code = unwrapped(handler)

    assert status_code == 400
    assert "kind" in body["message"]
