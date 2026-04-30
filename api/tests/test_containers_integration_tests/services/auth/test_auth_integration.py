"""
API Key Authentication System Integration Tests
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.orm import Session

from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_factory import ApiKeyAuthFactory
from services.auth.api_key_auth_service import ApiKeyAuthService
from services.auth.auth_type import AuthType


class TestAuthIntegration:
    @pytest.fixture
    def tenant_id_1(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def tenant_id_2(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def category(self) -> str:
        return "search"

    @pytest.fixture
    def firecrawl_credentials(self) -> dict:
        return {"auth_type": "bearer", "config": {"api_key": "fc_test_key_123"}}

    @pytest.fixture
    def jina_credentials(self) -> dict:
        return {"auth_type": "bearer", "config": {"api_key": "jina_test_key_456"}}

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token")
    def test_end_to_end_auth_flow(
        self,
        mock_encrypt,
        mock_http,
        flask_app_with_containers,
        db_session_with_containers,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_fc_test_key_123"

        args = {"category": category, "provider": AuthType.FIRECRAWL, "credentials": firecrawl_credentials}
        ApiKeyAuthService.create_provider_auth(tenant_id_1, args)

        mock_http.assert_called_once()
        call_args = mock_http.call_args
        assert "https://api.firecrawl.dev/v1/crawl" in call_args[0][0]
        assert call_args[1]["headers"]["Authorization"] == "Bearer fc_test_key_123"

        mock_encrypt.assert_called_once_with(tenant_id_1, "fc_test_key_123")

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id_1).all()
        assert len(bindings) == 1
        assert bindings[0].provider == AuthType.FIRECRAWL

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_cross_component_integration(self, mock_http, firecrawl_credentials):
        mock_http.return_value = self._create_success_response()
        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, firecrawl_credentials)
        result = factory.validate_credentials()

        assert result is True
        mock_http.assert_called_once()

    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.jina.jina._http_client.post")
    def test_multi_tenant_isolation(
        self,
        mock_jina_http,
        mock_fc_http,
        mock_encrypt,
        flask_app_with_containers,
        db_session_with_containers,
        tenant_id_1,
        tenant_id_2,
        category,
        firecrawl_credentials,
        jina_credentials,
    ):
        mock_fc_http.return_value = self._create_success_response()
        mock_jina_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_key"

        args1 = {"category": category, "provider": AuthType.FIRECRAWL, "credentials": firecrawl_credentials}
        ApiKeyAuthService.create_provider_auth(tenant_id_1, args1)

        args2 = {"category": category, "provider": AuthType.JINA, "credentials": jina_credentials}
        ApiKeyAuthService.create_provider_auth(tenant_id_2, args2)

        db_session_with_containers.expire_all()

        result1 = ApiKeyAuthService.get_provider_auth_list(tenant_id_1)
        result2 = ApiKeyAuthService.get_provider_auth_list(tenant_id_2)

        assert len(result1) == 1
        assert result1[0].tenant_id == tenant_id_1
        assert len(result2) == 1
        assert result2[0].tenant_id == tenant_id_2

    def test_cross_tenant_access_prevention(
        self, flask_app_with_containers, db_session_with_containers: Session, tenant_id_2, category
    ):
        result = ApiKeyAuthService.get_auth_credentials(tenant_id_2, category, AuthType.FIRECRAWL)

        assert result is None

    def test_sensitive_data_protection(self):
        credentials_with_secrets = {
            "auth_type": "bearer",
            "config": {"api_key": "super_secret_key_do_not_log", "secret": "another_secret"},
        }

        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, credentials_with_secrets)
        factory_str = str(factory)

        assert "super_secret_key_do_not_log" not in factory_str
        assert "another_secret" not in factory_str

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token", return_value="encrypted_key")
    def test_concurrent_creation_safety(
        self,
        mock_encrypt,
        mock_http,
        flask_app_with_containers,
        db_session_with_containers,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        app = flask_app_with_containers
        mock_http.return_value = self._create_success_response()

        results = []
        exceptions = []

        def create_auth():
            try:
                with app.app_context():
                    thread_args = {
                        "category": category,
                        "provider": AuthType.FIRECRAWL,
                        "credentials": {"auth_type": "bearer", "config": {"api_key": "fc_test_key_123"}},
                    }
                    ApiKeyAuthService.create_provider_auth(tenant_id_1, thread_args)
                results.append("success")
            except Exception as e:
                exceptions.append(e)

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_auth) for _ in range(5)]
            for future in futures:
                future.result()

        assert len(results) == 5
        assert len(exceptions) == 0

    @pytest.mark.parametrize(
        "invalid_input",
        [
            None,
            {},
            {"auth_type": "bearer"},
            {"auth_type": "bearer", "config": {}},
        ],
    )
    def test_invalid_input_boundary(self, invalid_input):
        with pytest.raises((ValueError, KeyError, TypeError, AttributeError)):
            ApiKeyAuthFactory(AuthType.FIRECRAWL, invalid_input)

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_http_error_handling(self, mock_http, firecrawl_credentials):
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.text = '{"error": "Unauthorized"}'
        mock_response.raise_for_status.side_effect = httpx.HTTPError("Unauthorized")
        mock_http.return_value = mock_response

        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, firecrawl_credentials)
        with pytest.raises((httpx.HTTPError, Exception)):
            factory.validate_credentials()

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_network_failure_recovery(
        self,
        mock_http,
        flask_app_with_containers,
        db_session_with_containers,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.side_effect = httpx.RequestError("Network timeout")

        args = {"category": category, "provider": AuthType.FIRECRAWL, "credentials": firecrawl_credentials}

        with pytest.raises(httpx.RequestError):
            ApiKeyAuthService.create_provider_auth(tenant_id_1, args)

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id_1).all()
        assert len(bindings) == 0

    @pytest.mark.parametrize(
        ("provider", "credentials"),
        [
            (AuthType.FIRECRAWL, {"auth_type": "bearer", "config": {"api_key": "fc_key"}}),
            (AuthType.JINA, {"auth_type": "bearer", "config": {"api_key": "jina_key"}}),
            (AuthType.WATERCRAWL, {"auth_type": "x-api-key", "config": {"api_key": "wc_key"}}),
        ],
    )
    def test_all_providers_factory_creation(self, provider, credentials):
        auth_class = ApiKeyAuthFactory.get_apikey_auth_factory(provider)
        assert auth_class is not None

        factory = ApiKeyAuthFactory(provider, credentials)
        assert factory.auth is not None

    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_get_auth_credentials_returns_stored_credentials(
        self,
        mock_http,
        mock_encrypt,
        flask_app_with_containers,
        db_session_with_containers,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_key"

        args = {"category": category, "provider": AuthType.FIRECRAWL, "credentials": firecrawl_credentials}
        ApiKeyAuthService.create_provider_auth(tenant_id_1, args)

        db_session_with_containers.expire_all()

        result = ApiKeyAuthService.get_auth_credentials(tenant_id_1, category, AuthType.FIRECRAWL)
        assert result is not None
        assert result["config"]["api_key"] == "encrypted_key"

    def _create_success_response(self, status_code=200):
        mock_response = Mock()
        mock_response.status_code = status_code
        mock_response.json.return_value = {"status": "success"}
        mock_response.raise_for_status.return_value = None
        return mock_response
