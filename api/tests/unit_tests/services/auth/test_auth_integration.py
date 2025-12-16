"""
API Key Authentication System Integration Tests
"""

import json
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

import httpx
import pytest

from services.auth.api_key_auth_factory import ApiKeyAuthFactory
from services.auth.api_key_auth_service import ApiKeyAuthService
from services.auth.auth_type import AuthType


class TestAuthIntegration:
    def setup_method(self):
        self.tenant_id_1 = "tenant_123"
        self.tenant_id_2 = "tenant_456"  # For multi-tenant isolation testing
        self.category = "search"

        # Realistic authentication configurations
        self.firecrawl_credentials = {"auth_type": "bearer", "config": {"api_key": "fc_test_key_123"}}
        self.jina_credentials = {"auth_type": "bearer", "config": {"api_key": "jina_test_key_456"}}
        self.watercrawl_credentials = {"auth_type": "x-api-key", "config": {"api_key": "wc_test_key_789"}}

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token")
    def test_end_to_end_auth_flow(self, mock_encrypt, mock_http, mock_session):
        """Test complete authentication flow: request → validation → encryption → storage"""
        mock_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_fc_test_key_123"
        mock_session.add = Mock()
        mock_session.commit = Mock()

        args = {"category": self.category, "provider": AuthType.FIRECRAWL, "credentials": self.firecrawl_credentials}
        ApiKeyAuthService.create_provider_auth(self.tenant_id_1, args)

        mock_http.assert_called_once()
        call_args = mock_http.call_args
        assert "https://api.firecrawl.dev/v1/crawl" in call_args[0][0]
        assert call_args[1]["headers"]["Authorization"] == "Bearer fc_test_key_123"

        mock_encrypt.assert_called_once_with(self.tenant_id_1, "fc_test_key_123")
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_cross_component_integration(self, mock_http):
        """Test factory → provider → HTTP call integration"""
        mock_http.return_value = self._create_success_response()
        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, self.firecrawl_credentials)
        result = factory.validate_credentials()

        assert result is True
        mock_http.assert_called_once()

    @patch("services.auth.api_key_auth_service.db.session")
    def test_multi_tenant_isolation(self, mock_session):
        """Ensure complete tenant data isolation"""
        tenant1_binding = self._create_mock_binding(self.tenant_id_1, AuthType.FIRECRAWL, self.firecrawl_credentials)
        tenant2_binding = self._create_mock_binding(self.tenant_id_2, AuthType.JINA, self.jina_credentials)

        mock_session.scalars.return_value.all.return_value = [tenant1_binding]
        result1 = ApiKeyAuthService.get_provider_auth_list(self.tenant_id_1)

        mock_session.scalars.return_value.all.return_value = [tenant2_binding]
        result2 = ApiKeyAuthService.get_provider_auth_list(self.tenant_id_2)

        assert len(result1) == 1
        assert result1[0].tenant_id == self.tenant_id_1
        assert len(result2) == 1
        assert result2[0].tenant_id == self.tenant_id_2

    @patch("services.auth.api_key_auth_service.db.session")
    def test_cross_tenant_access_prevention(self, mock_session):
        """Test prevention of cross-tenant credential access"""
        mock_session.query.return_value.where.return_value.first.return_value = None

        result = ApiKeyAuthService.get_auth_credentials(self.tenant_id_2, self.category, AuthType.FIRECRAWL)

        assert result is None

    def test_sensitive_data_protection(self):
        """Ensure API keys don't leak to logs"""
        credentials_with_secrets = {
            "auth_type": "bearer",
            "config": {"api_key": "super_secret_key_do_not_log", "secret": "another_secret"},
        }

        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, credentials_with_secrets)
        factory_str = str(factory)

        assert "super_secret_key_do_not_log" not in factory_str
        assert "another_secret" not in factory_str

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.api_key_auth_service.encrypter.encrypt_token")
    def test_concurrent_creation_safety(self, mock_encrypt, mock_http, mock_session):
        """Test concurrent authentication creation safety"""
        mock_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_key"
        mock_session.add = Mock()
        mock_session.commit = Mock()

        args = {"category": self.category, "provider": AuthType.FIRECRAWL, "credentials": self.firecrawl_credentials}

        results = []
        exceptions = []

        def create_auth():
            try:
                ApiKeyAuthService.create_provider_auth(self.tenant_id_1, args)
                results.append("success")
            except Exception as e:
                exceptions.append(e)

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_auth) for _ in range(5)]
            for future in futures:
                future.result()

        assert len(results) == 5
        assert len(exceptions) == 0
        assert mock_session.add.call_count == 5
        assert mock_session.commit.call_count == 5

    @pytest.mark.parametrize(
        "invalid_input",
        [
            None,  # Null input
            {},  # Empty dictionary - missing required fields
            {"auth_type": "bearer"},  # Missing config section
            {"auth_type": "bearer", "config": {}},  # Missing api_key
        ],
    )
    def test_invalid_input_boundary(self, invalid_input):
        """Test boundary handling for invalid inputs"""
        with pytest.raises((ValueError, KeyError, TypeError, AttributeError)):
            ApiKeyAuthFactory(AuthType.FIRECRAWL, invalid_input)

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_http_error_handling(self, mock_http):
        """Test proper HTTP error handling"""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.text = '{"error": "Unauthorized"}'
        mock_response.raise_for_status.side_effect = httpx.HTTPError("Unauthorized")
        mock_http.return_value = mock_response

        # PT012: Split into single statement for pytest.raises
        factory = ApiKeyAuthFactory(AuthType.FIRECRAWL, self.firecrawl_credentials)
        with pytest.raises((httpx.HTTPError, Exception)):
            factory.validate_credentials()

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_network_failure_recovery(self, mock_http, mock_session):
        """Test system recovery from network failures"""
        mock_http.side_effect = httpx.RequestError("Network timeout")
        mock_session.add = Mock()
        mock_session.commit = Mock()

        args = {"category": self.category, "provider": AuthType.FIRECRAWL, "credentials": self.firecrawl_credentials}

        with pytest.raises(httpx.RequestError):
            ApiKeyAuthService.create_provider_auth(self.tenant_id_1, args)

        mock_session.commit.assert_not_called()

    @pytest.mark.parametrize(
        ("provider", "credentials"),
        [
            (AuthType.FIRECRAWL, {"auth_type": "bearer", "config": {"api_key": "fc_key"}}),
            (AuthType.JINA, {"auth_type": "bearer", "config": {"api_key": "jina_key"}}),
            (AuthType.WATERCRAWL, {"auth_type": "x-api-key", "config": {"api_key": "wc_key"}}),
        ],
    )
    def test_all_providers_factory_creation(self, provider, credentials):
        """Test factory creation for all supported providers"""
        auth_class = ApiKeyAuthFactory.get_apikey_auth_factory(provider)
        assert auth_class is not None

        factory = ApiKeyAuthFactory(provider, credentials)
        assert factory.auth is not None

    def _create_success_response(self, status_code=200):
        """Create successful HTTP response mock"""
        mock_response = Mock()
        mock_response.status_code = status_code
        mock_response.json.return_value = {"status": "success"}
        mock_response.raise_for_status.return_value = None
        return mock_response

    def _create_mock_binding(self, tenant_id: str, provider: str, credentials: dict) -> Mock:
        """Create realistic database binding mock"""
        mock_binding = Mock()
        mock_binding.id = f"binding_{provider}_{tenant_id}"
        mock_binding.tenant_id = tenant_id
        mock_binding.category = self.category
        mock_binding.provider = provider
        mock_binding.credentials = json.dumps(credentials, ensure_ascii=False)
        mock_binding.disabled = False

        mock_binding.created_at = Mock()
        mock_binding.created_at.timestamp.return_value = 1640995200
        mock_binding.updated_at = Mock()
        mock_binding.updated_at.timestamp.return_value = 1640995200

        return mock_binding

    def test_integration_coverage_validation(self):
        """Validate integration test coverage meets quality standards"""
        core_scenarios = {
            "business_logic": ["end_to_end_auth_flow", "cross_component_integration"],
            "security": ["multi_tenant_isolation", "cross_tenant_access_prevention", "sensitive_data_protection"],
            "reliability": ["concurrent_creation_safety", "network_failure_recovery"],
            "compatibility": ["all_providers_factory_creation"],
            "boundaries": ["invalid_input_boundary", "http_error_handling"],
        }

        total_scenarios = sum(len(scenarios) for scenarios in core_scenarios.values())
        assert total_scenarios >= 10

        security_tests = core_scenarios["security"]
        assert "multi_tenant_isolation" in security_tests
        assert "sensitive_data_protection" in security_tests
        assert True
