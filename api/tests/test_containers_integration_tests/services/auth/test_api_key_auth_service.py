from __future__ import annotations

import json
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_service import ApiKeyAuthService


class TestApiKeyAuthService:
    @pytest.fixture
    def tenant_id(self) -> str:
        return str(uuid4())

    @pytest.fixture
    def category(self) -> str:
        return "search"

    @pytest.fixture
    def provider(self) -> str:
        return "google"

    @pytest.fixture
    def mock_credentials(self) -> dict:
        return {"auth_type": "api_key", "config": {"api_key": "test_secret_key_123"}}

    @pytest.fixture
    def mock_args(self, category, provider, mock_credentials) -> dict:
        return {"category": category, "provider": provider, "credentials": mock_credentials}

    def _create_binding(self, db_session, *, tenant_id, category, provider, credentials=None, disabled=False):
        binding = DataSourceApiKeyAuthBinding(
            tenant_id=tenant_id,
            category=category,
            provider=provider,
            credentials=json.dumps(credentials, ensure_ascii=False) if credentials else None,
            disabled=disabled,
        )
        db_session.add(binding)
        db_session.commit()
        return binding

    def test_get_provider_auth_list_success(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider
    ):
        self._create_binding(db_session_with_containers, tenant_id=tenant_id, category=category, provider=provider)
        db_session_with_containers.expire_all()

        result = ApiKeyAuthService.get_provider_auth_list(tenant_id)

        assert len(result) >= 1
        tenant_results = [r for r in result if r.tenant_id == tenant_id]
        assert len(tenant_results) == 1
        assert tenant_results[0].provider == provider

    def test_get_provider_auth_list_empty(self, flask_app_with_containers, db_session_with_containers, tenant_id):
        result = ApiKeyAuthService.get_provider_auth_list(tenant_id)

        tenant_results = [r for r in result if r.tenant_id == tenant_id]
        assert tenant_results == []

    def test_get_provider_auth_list_filters_disabled(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider
    ):
        self._create_binding(
            db_session_with_containers, tenant_id=tenant_id, category=category, provider=provider, disabled=True
        )
        db_session_with_containers.expire_all()

        result = ApiKeyAuthService.get_provider_auth_list(tenant_id)

        tenant_results = [r for r in result if r.tenant_id == tenant_id]
        assert tenant_results == []

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_success(
        self, mock_encrypter, mock_factory, flask_app_with_containers, db_session_with_containers, tenant_id, mock_args
    ):
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance
        mock_encrypter.encrypt_token.return_value = "encrypted_test_key_123"

        ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

        mock_factory.assert_called_once()
        mock_auth_instance.validate_credentials.assert_called_once()
        mock_encrypter.encrypt_token.assert_called_once_with(tenant_id, "test_secret_key_123")

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id).all()
        assert len(bindings) == 1

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    def test_create_provider_auth_validation_failed(
        self, mock_factory, flask_app_with_containers, db_session_with_containers, tenant_id, mock_args
    ):
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = False
        mock_factory.return_value = mock_auth_instance

        ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

        db_session_with_containers.expire_all()
        bindings = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(tenant_id=tenant_id).all()
        assert len(bindings) == 0

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_encrypts_api_key(
        self, mock_encrypter, mock_factory, flask_app_with_containers, db_session_with_containers, tenant_id, mock_args
    ):
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance
        mock_encrypter.encrypt_token.return_value = "encrypted_test_key_123"

        original_key = mock_args["credentials"]["config"]["api_key"]

        ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

        assert mock_args["credentials"]["config"]["api_key"] == "encrypted_test_key_123"
        assert mock_args["credentials"]["config"]["api_key"] != original_key
        mock_encrypter.encrypt_token.assert_called_once_with(tenant_id, original_key)

    def test_get_auth_credentials_success(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider, mock_credentials
    ):
        self._create_binding(
            db_session_with_containers,
            tenant_id=tenant_id,
            category=category,
            provider=provider,
            credentials=mock_credentials,
        )
        db_session_with_containers.expire_all()

        result = ApiKeyAuthService.get_auth_credentials(tenant_id, category, provider)

        assert result == mock_credentials

    def test_get_auth_credentials_not_found(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider
    ):
        result = ApiKeyAuthService.get_auth_credentials(tenant_id, category, provider)

        assert result is None

    def test_get_auth_credentials_json_parsing(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider
    ):
        special_credentials = {"auth_type": "api_key", "config": {"api_key": "key_with_中文_and_special_chars_!@#$%"}}
        self._create_binding(
            db_session_with_containers,
            tenant_id=tenant_id,
            category=category,
            provider=provider,
            credentials=special_credentials,
        )
        db_session_with_containers.expire_all()

        result = ApiKeyAuthService.get_auth_credentials(tenant_id, category, provider)

        assert result == special_credentials
        assert result["config"]["api_key"] == "key_with_中文_and_special_chars_!@#$%"

    def test_delete_provider_auth_success(
        self, flask_app_with_containers, db_session_with_containers, tenant_id, category, provider
    ):
        binding = self._create_binding(
            db_session_with_containers, tenant_id=tenant_id, category=category, provider=provider
        )
        binding_id = binding.id
        db_session_with_containers.expire_all()

        ApiKeyAuthService.delete_provider_auth(tenant_id, binding_id)

        db_session_with_containers.expire_all()
        remaining = db_session_with_containers.query(DataSourceApiKeyAuthBinding).filter_by(id=binding_id).first()
        assert remaining is None

    def test_delete_provider_auth_not_found(self, flask_app_with_containers, db_session_with_containers, tenant_id):
        # Should not raise when binding not found
        ApiKeyAuthService.delete_provider_auth(tenant_id, str(uuid4()))

    def test_validate_api_key_auth_args_success(self, mock_args):
        ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_missing_category(self, mock_args):
        del mock_args["category"]
        with pytest.raises(ValueError, match="category is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_empty_category(self, mock_args):
        mock_args["category"] = ""
        with pytest.raises(ValueError, match="category is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_missing_provider(self, mock_args):
        del mock_args["provider"]
        with pytest.raises(ValueError, match="provider is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_empty_provider(self, mock_args):
        mock_args["provider"] = ""
        with pytest.raises(ValueError, match="provider is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_missing_credentials(self, mock_args):
        del mock_args["credentials"]
        with pytest.raises(ValueError, match="credentials is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_empty_credentials(self, mock_args):
        mock_args["credentials"] = None
        with pytest.raises(ValueError, match="credentials is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_invalid_credentials_type(self, mock_args):
        mock_args["credentials"] = "not_a_dict"
        with pytest.raises(ValueError, match="credentials must be a dictionary"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_missing_auth_type(self, mock_args):
        del mock_args["credentials"]["auth_type"]
        with pytest.raises(ValueError, match="auth_type is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    def test_validate_api_key_auth_args_empty_auth_type(self, mock_args):
        mock_args["credentials"]["auth_type"] = ""
        with pytest.raises(ValueError, match="auth_type is required"):
            ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    @pytest.mark.parametrize(
        "malicious_input",
        [
            "<script>alert('xss')</script>",
            "'; DROP TABLE users; --",
            "../../../etc/passwd",
            "\\x00\\x00",
            "A" * 10000,
        ],
    )
    def test_validate_api_key_auth_args_malicious_input(self, malicious_input, mock_args):
        mock_args["category"] = malicious_input
        ApiKeyAuthService.validate_api_key_auth_args(mock_args)

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_database_error_handling(
        self, mock_encrypter, mock_factory, flask_app_with_containers, tenant_id, mock_args
    ):
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance
        mock_encrypter.encrypt_token.return_value = "encrypted_key"

        with patch("services.auth.api_key_auth_service.db.session") as mock_session:
            mock_session.commit.side_effect = Exception("Database error")
            with pytest.raises(Exception, match="Database error"):
                ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    def test_create_provider_auth_factory_exception(self, mock_factory, tenant_id, mock_args):
        mock_factory.side_effect = Exception("Factory error")
        with pytest.raises(Exception, match="Factory error"):
            ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_encryption_exception(self, mock_encrypter, mock_factory, tenant_id, mock_args):
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance
        mock_encrypter.encrypt_token.side_effect = Exception("Encryption error")
        with pytest.raises(Exception, match="Encryption error"):
            ApiKeyAuthService.create_provider_auth(tenant_id, mock_args)

    def test_validate_api_key_auth_args_none_input(self):
        with pytest.raises(TypeError):
            ApiKeyAuthService.validate_api_key_auth_args(None)

    def test_validate_api_key_auth_args_dict_credentials_with_list_auth_type(self, mock_args):
        mock_args["credentials"]["auth_type"] = ["api_key"]
        ApiKeyAuthService.validate_api_key_auth_args(mock_args)
