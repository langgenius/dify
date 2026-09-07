"""Integration tests for the data-source API-key auth adapters."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import pytest
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.source import DataSourceApiKeyAuthBinding
from repositories.data_source_api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from services.auth.data_source_api_key_auth_gateways import (
    ProviderApiKeyAuthCredentialValidator,
    TenantApiKeyAuthCredentialEncryptor,
)
from services.auth.data_source_api_key_auth_service import DataSourceApiKeyAuthService
from services.auth.errors import DataSourceApiKeyAuthProviderUnavailableError
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthCredentials,
)

_FIRECRAWL_PROVIDER = "firecrawl"
_JINA_PROVIDER = "jinareader"


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
    def firecrawl_credentials(self) -> DataSourceApiKeyAuthCredentials:
        return DataSourceApiKeyAuthCredentials("bearer", "fc_test_key_123", {})

    @pytest.fixture
    def jina_credentials(self) -> DataSourceApiKeyAuthCredentials:
        return DataSourceApiKeyAuthCredentials("bearer", "jina_test_key_456", {})

    @staticmethod
    def _context(workspace_id: str) -> RequestContext:
        return RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id=workspace_id,
        )

    @staticmethod
    def _service(session: Session) -> DataSourceApiKeyAuthService:
        session_factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        return DataSourceApiKeyAuthService(
            bindings=SQLAlchemyDataSourceApiKeyAuthBindingRepository(session_factory),
            validator=ProviderApiKeyAuthCredentialValidator(),
            encryptor=TenantApiKeyAuthCredentialEncryptor(),
        )

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.data_source_api_key_auth_gateways.encrypter.encrypt_token")
    def test_end_to_end_auth_flow(
        self,
        mock_encrypt,
        mock_http,
        db_session_with_containers: Session,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_fc_test_key_123"
        service = self._service(db_session_with_containers)
        command = DataSourceApiKeyAuthBindingCreate(category, _FIRECRAWL_PROVIDER, firecrawl_credentials)

        service.create_binding(self._context(tenant_id_1), command)

        mock_http.assert_called_once()
        call_args = mock_http.call_args
        assert "https://api.firecrawl.dev/v1/crawl" in call_args[0][0]
        assert call_args[1]["headers"]["Authorization"] == "Bearer fc_test_key_123"
        mock_encrypt.assert_called_once_with(tenant_id_1, "fc_test_key_123")

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id_1).all()
        assert len(bindings) == 1
        assert bindings[0].provider == _FIRECRAWL_PROVIDER

    @patch("services.auth.data_source_api_key_auth_gateways.encrypter.encrypt_token")
    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.jina.jina._http_client.post")
    def test_multi_tenant_isolation(
        self,
        mock_jina_http,
        mock_fc_http,
        mock_encrypt,
        db_session_with_containers: Session,
        tenant_id_1,
        tenant_id_2,
        category,
        firecrawl_credentials,
        jina_credentials,
    ):
        mock_fc_http.return_value = self._create_success_response()
        mock_jina_http.return_value = self._create_success_response()
        mock_encrypt.return_value = "encrypted_key"
        service = self._service(db_session_with_containers)

        service.create_binding(
            self._context(tenant_id_1),
            DataSourceApiKeyAuthBindingCreate(category, _FIRECRAWL_PROVIDER, firecrawl_credentials),
        )
        service.create_binding(
            self._context(tenant_id_2),
            DataSourceApiKeyAuthBindingCreate(category, _JINA_PROVIDER, jina_credentials),
        )

        result1 = service.list_bindings(self._context(tenant_id_1))
        result2 = service.list_bindings(self._context(tenant_id_2))
        assert len(result1) == 1
        assert result1[0].provider == _FIRECRAWL_PROVIDER
        assert len(result2) == 1
        assert result2[0].provider == _JINA_PROVIDER

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    @patch("services.auth.data_source_api_key_auth_gateways.encrypter.encrypt_token", return_value="encrypted_key")
    def test_concurrent_creation_safety(
        self,
        mock_encrypt,
        mock_http,
        db_session_with_containers: Session,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.return_value = self._create_success_response()
        service = self._service(db_session_with_containers)
        results = []
        exceptions = []

        def create_auth():
            try:
                command = DataSourceApiKeyAuthBindingCreate(
                    category,
                    _FIRECRAWL_PROVIDER,
                    DataSourceApiKeyAuthCredentials("bearer", "fc_test_key_123", {}),
                )
                service.create_binding(self._context(tenant_id_1), command)
                results.append("success")
            except Exception as exc:
                exceptions.append(exc)

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(create_auth) for _ in range(5)]
            for future in futures:
                future.result()

        assert len(results) == 5
        assert len(exceptions) == 0

    @patch("services.auth.firecrawl.firecrawl.httpx.post")
    def test_network_failure_recovery(
        self,
        mock_http,
        db_session_with_containers: Session,
        tenant_id_1,
        category,
        firecrawl_credentials,
    ):
        mock_http.side_effect = httpx.ConnectError("Network unavailable")
        service = self._service(db_session_with_containers)
        command = DataSourceApiKeyAuthBindingCreate(category, _FIRECRAWL_PROVIDER, firecrawl_credentials)

        with pytest.raises(DataSourceApiKeyAuthProviderUnavailableError):
            service.create_binding(self._context(tenant_id_1), command)

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id_1).all()
        assert len(bindings) == 0

    @staticmethod
    def _create_success_response(status_code=200):
        mock_response = Mock()
        mock_response.status_code = status_code
        mock_response.json.return_value = {"status": "success"}
        mock_response.raise_for_status.return_value = None
        return mock_response
