import json
from unittest.mock import Mock, patch

import pytest

from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_service import ApiKeyAuthService


class TestApiKeyAuthService:
    """API key authentication service security tests"""

    def setup_method(self):
        """Setup test fixtures"""
        self.tenant_id = "test_tenant_123"
        self.category = "search"
        self.provider = "google"
        self.binding_id = "binding_123"
        self.mock_credentials = {"auth_type": "api_key", "config": {"api_key": "test_secret_key_123"}}
        self.mock_args = {"category": self.category, "provider": self.provider, "credentials": self.mock_credentials}

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_provider_auth_list_success(self, mock_session):
        """Test get provider auth list - success scenario"""
        # Mock database query result
        mock_binding = Mock()
        mock_binding.tenant_id = self.tenant_id
        mock_binding.provider = self.provider
        mock_binding.disabled = False

        mock_session.scalars.return_value.all.return_value = [mock_binding]

        result = ApiKeyAuthService.get_provider_auth_list(self.tenant_id)

        assert len(result) == 1
        assert result[0].tenant_id == self.tenant_id
        assert mock_session.scalars.call_count == 1
        select_arg = mock_session.scalars.call_args[0][0]
        assert "data_source_api_key_auth_binding" in str(select_arg).lower()

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_provider_auth_list_empty(self, mock_session):
        """Test get provider auth list - empty result"""
        mock_session.scalars.return_value.all.return_value = []

        result = ApiKeyAuthService.get_provider_auth_list(self.tenant_id)

        assert result == []

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_provider_auth_list_filters_disabled(self, mock_session):
        """Test get provider auth list - filters disabled items"""
        mock_session.scalars.return_value.all.return_value = []

        ApiKeyAuthService.get_provider_auth_list(self.tenant_id)
        select_stmt = mock_session.scalars.call_args[0][0]
        where_clauses = list(getattr(select_stmt, "_where_criteria", []) or [])
        # Ensure both tenant filter and disabled filter exist
        where_strs = [str(c).lower() for c in where_clauses]
        assert any("tenant_id" in s for s in where_strs)
        assert any("disabled" in s for s in where_strs)

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_success(self, mock_encrypter, mock_factory, mock_session):
        """Test create provider auth - success scenario"""
        # Mock successful auth validation
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance

        # Mock encryption
        encrypted_key = "encrypted_test_key_123"
        mock_encrypter.encrypt_token.return_value = encrypted_key

        # Mock database operations
        mock_session.add = Mock()
        mock_session.commit = Mock()

        ApiKeyAuthService.create_provider_auth(self.tenant_id, self.mock_args)

        # Verify factory class calls
        mock_factory.assert_called_once_with(self.provider, self.mock_credentials)
        mock_auth_instance.validate_credentials.assert_called_once()

        # Verify encryption calls
        mock_encrypter.encrypt_token.assert_called_once_with(self.tenant_id, "test_secret_key_123")

        # Verify database operations
        mock_session.add.assert_called_once()
        mock_session.commit.assert_called_once()

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    def test_create_provider_auth_validation_failed(self, mock_factory, mock_session):
        """Test create provider auth - validation failed"""
        # Mock failed auth validation
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = False
        mock_factory.return_value = mock_auth_instance

        ApiKeyAuthService.create_provider_auth(self.tenant_id, self.mock_args)

        # Verify no database operations when validation fails
        mock_session.add.assert_not_called()
        mock_session.commit.assert_not_called()

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_encrypts_api_key(self, mock_encrypter, mock_factory, mock_session):
        """Test create provider auth - ensures API key is encrypted"""
        # Mock successful auth validation
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance

        # Mock encryption
        encrypted_key = "encrypted_test_key_123"
        mock_encrypter.encrypt_token.return_value = encrypted_key

        # Mock database operations
        mock_session.add = Mock()
        mock_session.commit = Mock()

        args_copy = self.mock_args.copy()
        original_key = args_copy["credentials"]["config"]["api_key"]

        ApiKeyAuthService.create_provider_auth(self.tenant_id, args_copy)

        # Verify original key is replaced with encrypted key
        assert args_copy["credentials"]["config"]["api_key"] == encrypted_key
        assert args_copy["credentials"]["config"]["api_key"] != original_key

        # Verify encryption function is called correctly
        mock_encrypter.encrypt_token.assert_called_once_with(self.tenant_id, original_key)

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_auth_credentials_success(self, mock_session):
        """Test get auth credentials - success scenario"""
        # Mock database query result
        mock_binding = Mock()
        mock_binding.credentials = json.dumps(self.mock_credentials)
        mock_session.query.return_value.where.return_value.first.return_value = mock_binding
        mock_session.query.return_value.where.return_value.first.return_value = mock_binding

        result = ApiKeyAuthService.get_auth_credentials(self.tenant_id, self.category, self.provider)

        assert result == self.mock_credentials
        mock_session.query.assert_called_once_with(DataSourceApiKeyAuthBinding)

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_auth_credentials_not_found(self, mock_session):
        """Test get auth credentials - not found"""
        mock_session.query.return_value.where.return_value.first.return_value = None

        result = ApiKeyAuthService.get_auth_credentials(self.tenant_id, self.category, self.provider)

        assert result is None

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_auth_credentials_filters_correctly(self, mock_session):
        """Test get auth credentials - applies correct filters"""
        mock_session.query.return_value.where.return_value.first.return_value = None

        ApiKeyAuthService.get_auth_credentials(self.tenant_id, self.category, self.provider)

        # Verify where conditions are correct
        where_call = mock_session.query.return_value.where.call_args[0]
        assert len(where_call) == 4  # tenant_id, category, provider, disabled

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_auth_credentials_json_parsing(self, mock_session):
        """Test get auth credentials - JSON parsing"""
        # Mock credentials with special characters
        special_credentials = {"auth_type": "api_key", "config": {"api_key": "key_with_中文_and_special_chars_!@#$%"}}

        mock_binding = Mock()
        mock_binding.credentials = json.dumps(special_credentials, ensure_ascii=False)
        mock_session.query.return_value.where.return_value.first.return_value = mock_binding

        result = ApiKeyAuthService.get_auth_credentials(self.tenant_id, self.category, self.provider)

        assert result == special_credentials
        assert result["config"]["api_key"] == "key_with_中文_and_special_chars_!@#$%"

    @patch("services.auth.api_key_auth_service.db.session")
    def test_delete_provider_auth_success(self, mock_session):
        """Test delete provider auth - success scenario"""
        # Mock database query result
        mock_binding = Mock()
        mock_session.query.return_value.where.return_value.first.return_value = mock_binding

        ApiKeyAuthService.delete_provider_auth(self.tenant_id, self.binding_id)

        # Verify delete operations
        mock_session.delete.assert_called_once_with(mock_binding)
        mock_session.commit.assert_called_once()

    @patch("services.auth.api_key_auth_service.db.session")
    def test_delete_provider_auth_not_found(self, mock_session):
        """Test delete provider auth - not found"""
        mock_session.query.return_value.where.return_value.first.return_value = None

        ApiKeyAuthService.delete_provider_auth(self.tenant_id, self.binding_id)

        # Verify no delete operations when not found
        mock_session.delete.assert_not_called()
        mock_session.commit.assert_not_called()

    @patch("services.auth.api_key_auth_service.db.session")
    def test_delete_provider_auth_filters_by_tenant(self, mock_session):
        """Test delete provider auth - filters by tenant"""
        mock_session.query.return_value.where.return_value.first.return_value = None

        ApiKeyAuthService.delete_provider_auth(self.tenant_id, self.binding_id)

        # Verify where conditions include tenant_id and binding_id
        where_call = mock_session.query.return_value.where.call_args[0]
        assert len(where_call) == 2

    def test_validate_api_key_auth_args_success(self):
        """Test API key auth args validation - success scenario"""
        # Should not raise any exception
        ApiKeyAuthService.validate_api_key_auth_args(self.mock_args)

    def test_validate_api_key_auth_args_missing_category(self):
        """Test API key auth args validation - missing category"""
        args = self.mock_args.copy()
        del args["category"]

        with pytest.raises(ValueError, match="category is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_empty_category(self):
        """Test API key auth args validation - empty category"""
        args = self.mock_args.copy()
        args["category"] = ""

        with pytest.raises(ValueError, match="category is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_missing_provider(self):
        """Test API key auth args validation - missing provider"""
        args = self.mock_args.copy()
        del args["provider"]

        with pytest.raises(ValueError, match="provider is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_empty_provider(self):
        """Test API key auth args validation - empty provider"""
        args = self.mock_args.copy()
        args["provider"] = ""

        with pytest.raises(ValueError, match="provider is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_missing_credentials(self):
        """Test API key auth args validation - missing credentials"""
        args = self.mock_args.copy()
        del args["credentials"]

        with pytest.raises(ValueError, match="credentials is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_empty_credentials(self):
        """Test API key auth args validation - empty credentials"""
        args = self.mock_args.copy()
        args["credentials"] = None

        with pytest.raises(ValueError, match="credentials is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_invalid_credentials_type(self):
        """Test API key auth args validation - invalid credentials type"""
        args = self.mock_args.copy()
        args["credentials"] = "not_a_dict"

        with pytest.raises(ValueError, match="credentials must be a dictionary"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_missing_auth_type(self):
        """Test API key auth args validation - missing auth_type"""
        args = self.mock_args.copy()
        del args["credentials"]["auth_type"]

        with pytest.raises(ValueError, match="auth_type is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    def test_validate_api_key_auth_args_empty_auth_type(self):
        """Test API key auth args validation - empty auth_type"""
        args = self.mock_args.copy()
        args["credentials"]["auth_type"] = ""

        with pytest.raises(ValueError, match="auth_type is required"):
            ApiKeyAuthService.validate_api_key_auth_args(args)

    @pytest.mark.parametrize(
        "malicious_input",
        [
            "<script>alert('xss')</script>",
            "'; DROP TABLE users; --",
            "../../../etc/passwd",
            "\\x00\\x00",  # null bytes
            "A" * 10000,  # very long input
        ],
    )
    def test_validate_api_key_auth_args_malicious_input(self, malicious_input):
        """Test API key auth args validation - malicious input"""
        args = self.mock_args.copy()
        args["category"] = malicious_input

        # Verify parameter validator doesn't crash on malicious input
        # Should validate normally rather than raising security-related exceptions
        ApiKeyAuthService.validate_api_key_auth_args(args)

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_database_error_handling(self, mock_encrypter, mock_factory, mock_session):
        """Test create provider auth - database error handling"""
        # Mock successful auth validation
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance

        # Mock encryption
        mock_encrypter.encrypt_token.return_value = "encrypted_key"

        # Mock database error
        mock_session.commit.side_effect = Exception("Database error")

        with pytest.raises(Exception, match="Database error"):
            ApiKeyAuthService.create_provider_auth(self.tenant_id, self.mock_args)

    @patch("services.auth.api_key_auth_service.db.session")
    def test_get_auth_credentials_invalid_json(self, mock_session):
        """Test get auth credentials - invalid JSON"""
        # Mock database returning invalid JSON
        mock_binding = Mock()
        mock_binding.credentials = "invalid json content"
        mock_session.query.return_value.where.return_value.first.return_value = mock_binding

        with pytest.raises(json.JSONDecodeError):
            ApiKeyAuthService.get_auth_credentials(self.tenant_id, self.category, self.provider)

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    def test_create_provider_auth_factory_exception(self, mock_factory, mock_session):
        """Test create provider auth - factory exception"""
        # Mock factory raising exception
        mock_factory.side_effect = Exception("Factory error")

        with pytest.raises(Exception, match="Factory error"):
            ApiKeyAuthService.create_provider_auth(self.tenant_id, self.mock_args)

    @patch("services.auth.api_key_auth_service.db.session")
    @patch("services.auth.api_key_auth_service.ApiKeyAuthFactory")
    @patch("services.auth.api_key_auth_service.encrypter")
    def test_create_provider_auth_encryption_exception(self, mock_encrypter, mock_factory, mock_session):
        """Test create provider auth - encryption exception"""
        # Mock successful auth validation
        mock_auth_instance = Mock()
        mock_auth_instance.validate_credentials.return_value = True
        mock_factory.return_value = mock_auth_instance

        # Mock encryption exception
        mock_encrypter.encrypt_token.side_effect = Exception("Encryption error")

        with pytest.raises(Exception, match="Encryption error"):
            ApiKeyAuthService.create_provider_auth(self.tenant_id, self.mock_args)

    def test_validate_api_key_auth_args_none_input(self):
        """Test API key auth args validation - None input"""
        with pytest.raises(TypeError):
            ApiKeyAuthService.validate_api_key_auth_args(None)

    def test_validate_api_key_auth_args_dict_credentials_with_list_auth_type(self):
        """Test API key auth args validation - dict credentials with list auth_type"""
        args = self.mock_args.copy()
        args["credentials"]["auth_type"] = ["api_key"]

        # Current implementation checks if auth_type exists and is truthy, list ["api_key"] is truthy
        # So this should not raise exception, this test should pass
        ApiKeyAuthService.validate_api_key_auth_args(args)
