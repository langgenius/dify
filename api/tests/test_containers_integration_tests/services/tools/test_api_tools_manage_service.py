from unittest.mock import patch

import pytest
from faker import Faker

from models import Account, Tenant
from models.tools import ApiToolProvider
from services.tools.api_tools_manage_service import ApiToolManageService


class TestApiToolManageService:
    """Integration tests for ApiToolManageService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.tools.api_tools_manage_service.ToolLabelManager") as mock_tool_label_manager,
            patch("services.tools.api_tools_manage_service.create_tool_provider_encrypter") as mock_encrypter,
            patch("services.tools.api_tools_manage_service.ApiToolProviderController") as mock_provider_controller,
        ):
            # Setup default mock returns
            mock_tool_label_manager.update_tool_labels.return_value = None
            mock_encrypter.return_value = (mock_encrypter, None)
            mock_encrypter.encrypt.return_value = {"encrypted": "credentials"}
            mock_provider_controller.from_db.return_value = mock_provider_controller
            mock_provider_controller.load_bundled_tools.return_value = None

            yield {
                "tool_label_manager": mock_tool_label_manager,
                "encrypter": mock_encrypter,
                "provider_controller": mock_provider_controller,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant for the account
        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        from models.account import TenantAccountJoin, TenantAccountRole

        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_openapi_schema(self):
        """Helper method to create a test OpenAPI schema."""
        return """
        {
            "openapi": "3.0.0",
            "info": {
                "title": "Test API",
                "version": "1.0.0",
                "description": "Test API for testing purposes"
            },
            "servers": [
                {
                    "url": "https://api.example.com",
                    "description": "Production server"
                }
            ],
            "paths": {
                "/test": {
                    "get": {
                        "operationId": "testOperation",
                        "summary": "Test operation",
                        "responses": {
                            "200": {
                                "description": "Success"
                            }
                        }
                    }
                }
            }
        }
        """

    def test_parser_api_schema_success(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful parsing of API schema.

        This test verifies:
        - Proper schema parsing with valid OpenAPI schema
        - Correct credentials schema generation
        - Proper warning handling
        - Return value structure
        """
        # Arrange: Create test schema
        schema = self._create_test_openapi_schema()

        # Act: Parse the schema
        result = ApiToolManageService.parser_api_schema(schema)

        # Assert: Verify the result structure
        assert result is not None
        assert "schema_type" in result
        assert "parameters_schema" in result
        assert "credentials_schema" in result
        assert "warning" in result

        # Verify credentials schema structure
        credentials_schema = result["credentials_schema"]
        assert len(credentials_schema) == 3

        # Check auth_type field
        auth_type_field = next(field for field in credentials_schema if field["name"] == "auth_type")
        assert auth_type_field["required"] is True
        assert auth_type_field["default"] == "none"
        assert len(auth_type_field["options"]) == 2

        # Check api_key_header field
        api_key_header_field = next(field for field in credentials_schema if field["name"] == "api_key_header")
        assert api_key_header_field["required"] is False
        assert api_key_header_field["default"] == "api_key"

        # Check api_key_value field
        api_key_value_field = next(field for field in credentials_schema if field["name"] == "api_key_value")
        assert api_key_value_field["required"] is False
        assert api_key_value_field["default"] == ""

    def test_parser_api_schema_invalid_schema(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test parsing of invalid API schema.

        This test verifies:
        - Proper error handling for invalid schemas
        - Correct exception type and message
        - Error propagation from underlying parser
        """
        # Arrange: Create invalid schema
        invalid_schema = "invalid json schema"

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.parser_api_schema(invalid_schema)

        assert "invalid schema" in str(exc_info.value)

    def test_parser_api_schema_malformed_json(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test parsing of malformed JSON schema.

        This test verifies:
        - Proper error handling for malformed JSON
        - Correct exception type and message
        - Error propagation from JSON parsing
        """
        # Arrange: Create malformed JSON schema
        malformed_schema = '{"openapi": "3.0.0", "info": {"title": "Test", "version": "1.0.0"}, "paths": {}}'

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.parser_api_schema(malformed_schema)

        assert "invalid schema" in str(exc_info.value)

    def test_convert_schema_to_tool_bundles_success(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful conversion of schema to tool bundles.

        This test verifies:
        - Proper schema conversion with valid OpenAPI schema
        - Correct tool bundles generation
        - Proper schema type detection
        - Return value structure
        """
        # Arrange: Create test schema
        schema = self._create_test_openapi_schema()

        # Act: Convert schema to tool bundles
        tool_bundles, schema_type = ApiToolManageService.convert_schema_to_tool_bundles(schema)

        # Assert: Verify the result structure
        assert tool_bundles is not None
        assert isinstance(tool_bundles, list)
        assert len(tool_bundles) > 0
        assert schema_type is not None
        assert isinstance(schema_type, str)

        # Verify tool bundle structure
        tool_bundle = tool_bundles[0]
        assert hasattr(tool_bundle, "operation_id")
        assert tool_bundle.operation_id == "testOperation"

    def test_convert_schema_to_tool_bundles_with_extra_info(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful conversion of schema to tool bundles with extra info.

        This test verifies:
        - Proper schema conversion with extra info parameter
        - Correct tool bundles generation
        - Extra info handling
        - Return value structure
        """
        # Arrange: Create test schema and extra info
        schema = self._create_test_openapi_schema()
        extra_info = {"description": "Custom description", "version": "2.0.0"}

        # Act: Convert schema to tool bundles with extra info
        tool_bundles, schema_type = ApiToolManageService.convert_schema_to_tool_bundles(schema, extra_info)

        # Assert: Verify the result structure
        assert tool_bundles is not None
        assert isinstance(tool_bundles, list)
        assert len(tool_bundles) > 0
        assert schema_type is not None
        assert isinstance(schema_type, str)

    def test_convert_schema_to_tool_bundles_invalid_schema(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test conversion of invalid schema to tool bundles.

        This test verifies:
        - Proper error handling for invalid schemas
        - Correct exception type and message
        - Error propagation from underlying parser
        """
        # Arrange: Create invalid schema
        invalid_schema = "invalid schema content"

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.convert_schema_to_tool_bundles(invalid_schema)

        assert "invalid schema" in str(exc_info.value)

    def test_create_api_tool_provider_success(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful creation of API tool provider.

        This test verifies:
        - Proper provider creation with valid parameters
        - Correct database state after creation
        - Proper relationship establishment
        - External service integration
        - Return value correctness
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_name = fake.company()
        icon = {"type": "emoji", "value": "🔧"}
        credentials = {"auth_type": "none", "api_key_header": "X-API-Key", "api_key_value": ""}
        schema_type = "openapi"
        schema = self._create_test_openapi_schema()
        privacy_policy = "https://example.com/privacy"
        custom_disclaimer = "Custom disclaimer text"
        labels = ["test", "api"]

        # Act: Create API tool provider
        result = ApiToolManageService.create_api_tool_provider(
            user_id=account.id,
            tenant_id=tenant.id,
            provider_name=provider_name,
            icon=icon,
            credentials=credentials,
            schema_type=schema_type,
            schema=schema,
            privacy_policy=privacy_policy,
            custom_disclaimer=custom_disclaimer,
            labels=labels,
        )

        # Assert: Verify the result
        assert result == {"result": "success"}

        # Verify database state
        from extensions.ext_database import db

        provider = (
            db.session.query(ApiToolProvider)
            .filter(ApiToolProvider.tenant_id == tenant.id, ApiToolProvider.name == provider_name)
            .first()
        )

        assert provider is not None
        assert provider.name == provider_name
        assert provider.tenant_id == tenant.id
        assert provider.user_id == account.id
        assert provider.schema_type_str == schema_type
        assert provider.privacy_policy == privacy_policy
        assert provider.custom_disclaimer == custom_disclaimer

        # Verify mock interactions
        mock_external_service_dependencies["tool_label_manager"].update_tool_labels.assert_called_once()
        mock_external_service_dependencies["encrypter"].assert_called_once()
        mock_external_service_dependencies["provider_controller"].from_db.assert_called_once()
        mock_external_service_dependencies["provider_controller"].load_bundled_tools.assert_called_once()

    def test_create_api_tool_provider_duplicate_name(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creation of API tool provider with duplicate name.

        This test verifies:
        - Proper error handling for duplicate provider names
        - Correct exception type and message
        - Database constraint enforcement
        """
        # Arrange: Create test data and existing provider
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_name = fake.company()
        icon = {"type": "emoji", "value": "🔧"}
        credentials = {"auth_type": "none"}
        schema_type = "openapi"
        schema = self._create_test_openapi_schema()
        privacy_policy = "https://example.com/privacy"
        custom_disclaimer = "Custom disclaimer text"
        labels = ["test"]

        # Create first provider
        ApiToolManageService.create_api_tool_provider(
            user_id=account.id,
            tenant_id=tenant.id,
            provider_name=provider_name,
            icon=icon,
            credentials=credentials,
            schema_type=schema_type,
            schema=schema,
            privacy_policy=privacy_policy,
            custom_disclaimer=custom_disclaimer,
            labels=labels,
        )

        # Act & Assert: Try to create duplicate provider
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.create_api_tool_provider(
                user_id=account.id,
                tenant_id=tenant.id,
                provider_name=provider_name,
                icon=icon,
                credentials=credentials,
                schema_type=schema_type,
                schema=schema,
                privacy_policy=privacy_policy,
                custom_disclaimer=custom_disclaimer,
                labels=labels,
            )

        assert f"provider {provider_name} already exists" in str(exc_info.value)

    def test_create_api_tool_provider_invalid_schema_type(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creation of API tool provider with invalid schema type.

        This test verifies:
        - Proper error handling for invalid schema types
        - Correct exception type and message
        - Schema type validation
        """
        # Arrange: Create test data with invalid schema type
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_name = fake.company()
        icon = {"type": "emoji", "value": "🔧"}
        credentials = {"auth_type": "none"}
        schema_type = "invalid_type"
        schema = self._create_test_openapi_schema()
        privacy_policy = "https://example.com/privacy"
        custom_disclaimer = "Custom disclaimer text"
        labels = ["test"]

        # Act & Assert: Try to create provider with invalid schema type
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.create_api_tool_provider(
                user_id=account.id,
                tenant_id=tenant.id,
                provider_name=provider_name,
                icon=icon,
                credentials=credentials,
                schema_type=schema_type,
                schema=schema,
                privacy_policy=privacy_policy,
                custom_disclaimer=custom_disclaimer,
                labels=labels,
            )

        assert "invalid schema type" in str(exc_info.value)

    def test_create_api_tool_provider_missing_auth_type(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test creation of API tool provider with missing auth type.

        This test verifies:
        - Proper error handling for missing auth type
        - Correct exception type and message
        - Credentials validation
        """
        # Arrange: Create test data with missing auth type
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_name = fake.company()
        icon = {"type": "emoji", "value": "🔧"}
        credentials = {}  # Missing auth_type
        schema_type = "openapi"
        schema = self._create_test_openapi_schema()
        privacy_policy = "https://example.com/privacy"
        custom_disclaimer = "Custom disclaimer text"
        labels = ["test"]

        # Act & Assert: Try to create provider with missing auth type
        with pytest.raises(ValueError) as exc_info:
            ApiToolManageService.create_api_tool_provider(
                user_id=account.id,
                tenant_id=tenant.id,
                provider_name=provider_name,
                icon=icon,
                credentials=credentials,
                schema_type=schema_type,
                schema=schema,
                privacy_policy=privacy_policy,
                custom_disclaimer=custom_disclaimer,
                labels=labels,
            )

        assert "auth_type is required" in str(exc_info.value)

    def test_create_api_tool_provider_with_api_key_auth(
        self, flask_req_ctx_with_containers, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful creation of API tool provider with API key authentication.

        This test verifies:
        - Proper provider creation with API key auth
        - Correct credentials handling
        - Proper authentication type processing
        """
        # Arrange: Create test data with API key auth
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        provider_name = fake.company()
        icon = {"type": "emoji", "value": "🔑"}
        credentials = {"auth_type": "api_key", "api_key_header": "X-API-Key", "api_key_value": fake.uuid4()}
        schema_type = "openapi"
        schema = self._create_test_openapi_schema()
        privacy_policy = "https://example.com/privacy"
        custom_disclaimer = "Custom disclaimer text"
        labels = ["api_key", "secure"]

        # Act: Create API tool provider
        result = ApiToolManageService.create_api_tool_provider(
            user_id=account.id,
            tenant_id=tenant.id,
            provider_name=provider_name,
            icon=icon,
            credentials=credentials,
            schema_type=schema_type,
            schema=schema,
            privacy_policy=privacy_policy,
            custom_disclaimer=custom_disclaimer,
            labels=labels,
        )

        # Assert: Verify the result
        assert result == {"result": "success"}

        # Verify database state
        from extensions.ext_database import db

        provider = (
            db.session.query(ApiToolProvider)
            .filter(ApiToolProvider.tenant_id == tenant.id, ApiToolProvider.name == provider_name)
            .first()
        )

        assert provider is not None
        assert provider.name == provider_name
        assert provider.tenant_id == tenant.id
        assert provider.user_id == account.id
        assert provider.schema_type_str == schema_type

        # Verify mock interactions
        mock_external_service_dependencies["encrypter"].assert_called_once()
        mock_external_service_dependencies["provider_controller"].from_db.assert_called_once()
