from unittest.mock import patch

import pytest
from faker import Faker

from core.tools.entities.tool_entities import ToolProviderType
from models.account import Account, Tenant
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import UNCHANGED_SERVER_URL_PLACEHOLDER, MCPToolManageService


class TestMCPToolManageService:
    """Integration tests for MCPToolManageService using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.tools.mcp_tools_manage_service.encrypter") as mock_encrypter,
            patch("services.tools.mcp_tools_manage_service.ToolTransformService") as mock_tool_transform_service,
        ):
            # Setup default mock returns
            mock_encrypter.encrypt_token.return_value = "encrypted_server_url"
            mock_tool_transform_service.mcp_provider_to_user_provider.return_value = {
                "id": "test_id",
                "name": "test_name",
                "type": ToolProviderType.MCP,
            }

            yield {
                "encrypter": mock_encrypter,
                "tool_transform_service": mock_tool_transform_service,
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
            role=TenantAccountRole.OWNER.value,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_mcp_provider(
        self, db_session_with_containers, mock_external_service_dependencies, tenant_id, user_id
    ):
        """
        Helper method to create a test MCP tool provider for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            tenant_id: Tenant ID for the provider
            user_id: User ID who created the provider

        Returns:
            MCPToolProvider: Created MCP tool provider instance
        """
        fake = Faker()

        # Create MCP tool provider
        mcp_provider = MCPToolProvider(
            tenant_id=tenant_id,
            name=fake.company(),
            server_identifier=fake.uuid4(),
            server_url="encrypted_server_url",
            server_url_hash=fake.sha256(),
            user_id=user_id,
            authed=False,
            tools="[]",
            icon='{"content": "🤖", "background": "#FF6B6B"}',
            timeout=30.0,
            sse_read_timeout=300.0,
        )

        from extensions.ext_database import db

        db.session.add(mcp_provider)
        db.session.commit()

        return mcp_provider

    def test_get_mcp_provider_by_provider_id_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful retrieval of MCP provider by provider ID.

        This test verifies:
        - Proper retrieval of MCP provider by ID
        - Correct tenant isolation
        - Proper error handling for non-existent providers
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Act: Execute the method under test
        result = MCPToolManageService.get_mcp_provider_by_provider_id(mcp_provider.id, tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mcp_provider.id
        assert result.name == mcp_provider.name
        assert result.tenant_id == tenant.id
        assert result.user_id == account.id

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None
        assert result.server_identifier == mcp_provider.server_identifier

    def test_get_mcp_provider_by_provider_id_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when MCP provider is not found by provider ID.

        This test verifies:
        - Proper error handling for non-existent provider IDs
        - Correct exception type and message
        - Tenant isolation enforcement
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        non_existent_id = fake.uuid4()

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.get_mcp_provider_by_provider_id(non_existent_id, tenant.id)

    def test_get_mcp_provider_by_provider_id_tenant_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant isolation when retrieving MCP provider by provider ID.

        This test verifies:
        - Proper tenant isolation enforcement
        - Providers from other tenants are not accessible
        - Security boundaries are maintained
        """
        # Arrange: Create test data for two tenants
        fake = Faker()
        account1, tenant1 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        account2, tenant2 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider in tenant1
        mcp_provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant1.id, account1.id
        )

        # Act & Assert: Verify tenant isolation
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.get_mcp_provider_by_provider_id(mcp_provider1.id, tenant2.id)

    def test_get_mcp_provider_by_server_identifier_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful retrieval of MCP provider by server identifier.

        This test verifies:
        - Proper retrieval of MCP provider by server identifier
        - Correct tenant isolation
        - Proper error handling for non-existent server identifiers
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Act: Execute the method under test
        result = MCPToolManageService.get_mcp_provider_by_server_identifier(mcp_provider.server_identifier, tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mcp_provider.id
        assert result.server_identifier == mcp_provider.server_identifier
        assert result.tenant_id == tenant.id
        assert result.user_id == account.id

        # Verify database state
        from extensions.ext_database import db

        db.session.refresh(result)
        assert result.id is not None
        assert result.name == mcp_provider.name

    def test_get_mcp_provider_by_server_identifier_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when MCP provider is not found by server identifier.

        This test verifies:
        - Proper error handling for non-existent server identifiers
        - Correct exception type and message
        - Tenant isolation enforcement
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        non_existent_identifier = fake.uuid4()

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.get_mcp_provider_by_server_identifier(non_existent_identifier, tenant.id)

    def test_get_mcp_provider_by_server_identifier_tenant_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant isolation when retrieving MCP provider by server identifier.

        This test verifies:
        - Proper tenant isolation enforcement
        - Providers from other tenants are not accessible by server identifier
        - Security boundaries are maintained
        """
        # Arrange: Create test data for two tenants
        fake = Faker()
        account1, tenant1 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        account2, tenant2 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider in tenant1
        mcp_provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant1.id, account1.id
        )

        # Act & Assert: Verify tenant isolation
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.get_mcp_provider_by_server_identifier(mcp_provider1.server_identifier, tenant2.id)

    def test_create_mcp_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful creation of MCP provider.

        This test verifies:
        - Proper MCP provider creation with all required fields
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

        # Setup mocks for provider creation
        mock_external_service_dependencies["encrypter"].encrypt_token.return_value = "encrypted_server_url"
        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.return_value = {
            "id": "new_provider_id",
            "name": "Test MCP Provider",
            "type": ToolProviderType.MCP,
        }

        # Act: Execute the method under test
        result = MCPToolManageService.create_mcp_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider",
            server_url="https://example.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_123",
            timeout=30.0,
            sse_read_timeout=300.0,
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result["name"] == "Test MCP Provider"
        assert result["type"] == ToolProviderType.MCP

        # Verify database state
        from extensions.ext_database import db

        created_provider = (
            db.session.query(MCPToolProvider)
            .filter(MCPToolProvider.tenant_id == tenant.id, MCPToolProvider.name == "Test MCP Provider")
            .first()
        )

        assert created_provider is not None
        assert created_provider.server_identifier == "test_identifier_123"
        assert created_provider.timeout == 30.0
        assert created_provider.sse_read_timeout == 300.0
        assert created_provider.authed is False
        assert created_provider.tools == "[]"

        # Verify mock interactions
        mock_external_service_dependencies["encrypter"].encrypt_token.assert_called_once_with(
            tenant.id, "https://example.com/mcp"
        )
        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.assert_called_once()

    def test_create_mcp_provider_duplicate_name(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when creating MCP provider with duplicate name.

        This test verifies:
        - Proper error handling for duplicate provider names
        - Correct exception type and message
        - Database integrity constraints
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create first provider
        MCPToolManageService.create_mcp_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider",
            server_url="https://example1.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_1",
            timeout=30.0,
            sse_read_timeout=300.0,
        )

        # Act & Assert: Verify proper error handling for duplicate name
        with pytest.raises(ValueError, match="MCP tool Test MCP Provider already exists"):
            MCPToolManageService.create_mcp_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider",  # Duplicate name
                server_url="https://example2.com/mcp",
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_2",
                timeout=45.0,
                sse_read_timeout=400.0,
            )

    def test_create_mcp_provider_duplicate_server_url(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when creating MCP provider with duplicate server URL.

        This test verifies:
        - Proper error handling for duplicate server URLs
        - Correct exception type and message
        - URL hash uniqueness enforcement
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create first provider
        MCPToolManageService.create_mcp_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider 1",
            server_url="https://example.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_1",
            timeout=30.0,
            sse_read_timeout=300.0,
        )

        # Act & Assert: Verify proper error handling for duplicate server URL
        with pytest.raises(ValueError, match="MCP tool https://example.com/mcp already exists"):
            MCPToolManageService.create_mcp_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider 2",
                server_url="https://example.com/mcp",  # Duplicate URL
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_2",
                timeout=45.0,
                sse_read_timeout=400.0,
            )

    def test_create_mcp_provider_duplicate_server_identifier(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when creating MCP provider with duplicate server identifier.

        This test verifies:
        - Proper error handling for duplicate server identifiers
        - Correct exception type and message
        - Server identifier uniqueness enforcement
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create first provider
        MCPToolManageService.create_mcp_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider 1",
            server_url="https://example1.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_123",
            timeout=30.0,
            sse_read_timeout=300.0,
        )

        # Act & Assert: Verify proper error handling for duplicate server identifier
        with pytest.raises(ValueError, match="MCP tool test_identifier_123 already exists"):
            MCPToolManageService.create_mcp_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider 2",
                server_url="https://example2.com/mcp",
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_123",  # Duplicate identifier
                timeout=45.0,
                sse_read_timeout=400.0,
            )

    def test_retrieve_mcp_tools_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful retrieval of MCP tools for a tenant.

        This test verifies:
        - Proper retrieval of all MCP providers for a tenant
        - Correct ordering by name
        - Proper transformation of providers to user entities
        - Empty list handling for tenants with no providers
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create multiple MCP providers
        provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        provider1.name = "Alpha Provider"

        provider2 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        provider2.name = "Beta Provider"

        provider3 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        provider3.name = "Gamma Provider"

        from extensions.ext_database import db

        db.session.commit()

        # Setup mock for transformation service
        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.side_effect = [
            {"id": provider1.id, "name": provider1.name, "type": ToolProviderType.MCP},
            {"id": provider2.id, "name": provider2.name, "type": ToolProviderType.MCP},
            {"id": provider3.id, "name": provider3.name, "type": ToolProviderType.MCP},
        ]

        # Act: Execute the method under test
        result = MCPToolManageService.retrieve_mcp_tools(tenant.id, for_list=True)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3

        # Verify correct ordering by name
        assert result[0]["name"] == "Alpha Provider"
        assert result[1]["name"] == "Beta Provider"
        assert result[2]["name"] == "Gamma Provider"

        # Verify mock interactions
        assert (
            mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.call_count == 3
        )

    def test_retrieve_mcp_tools_empty_list(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test retrieval of MCP tools when tenant has no providers.

        This test verifies:
        - Proper handling of empty provider lists
        - Correct return value for tenants with no MCP tools
        - No transformation service calls for empty lists
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # No MCP providers created for this tenant

        # Act: Execute the method under test
        result = MCPToolManageService.retrieve_mcp_tools(tenant.id, for_list=False)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 0
        assert isinstance(result, list)

        # Verify no transformation service calls for empty list
        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.assert_not_called()

    def test_retrieve_mcp_tools_tenant_isolation(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tenant isolation when retrieving MCP tools.

        This test verifies:
        - Proper tenant isolation enforcement
        - Providers from other tenants are not accessible
        - Security boundaries are maintained
        """
        # Arrange: Create test data for two tenants
        fake = Faker()
        account1, tenant1 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        account2, tenant2 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider in tenant1
        provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant1.id, account1.id
        )

        # Create MCP provider in tenant2
        provider2 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant2.id, account2.id
        )

        # Setup mock for transformation service
        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.side_effect = [
            {"id": provider1.id, "name": provider1.name, "type": ToolProviderType.MCP},
            {"id": provider2.id, "name": provider2.name, "type": ToolProviderType.MCP},
        ]

        # Act: Execute the method under test for both tenants
        result1 = MCPToolManageService.retrieve_mcp_tools(tenant1.id, for_list=True)
        result2 = MCPToolManageService.retrieve_mcp_tools(tenant2.id, for_list=True)

        # Assert: Verify tenant isolation
        assert len(result1) == 1
        assert len(result2) == 1
        assert result1[0]["id"] == provider1.id
        assert result2[0]["id"] == provider2.id

    def test_list_mcp_tool_from_remote_server_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful listing of MCP tools from remote server.

        This test verifies:
        - Proper connection to remote MCP server
        - Correct tool listing and database update
        - Proper authentication state management
        - Return value correctness
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        mcp_provider.server_url = "encrypted_server_url"
        mcp_provider.authed = False
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decrypted_server_url property to avoid encryption issues
        with patch("models.tools.encrypter") as mock_encrypter:
            mock_encrypter.decrypt_token.return_value = "https://example.com/mcp"

            # Mock MCPClient and its context manager
            mock_tools = [
                type(
                    "MockTool", (), {"model_dump": lambda self: {"name": "test_tool_1", "description": "Test tool 1"}}
                )(),
                type(
                    "MockTool", (), {"model_dump": lambda self: {"name": "test_tool_2", "description": "Test tool 2"}}
                )(),
            ]

            with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
                # Setup mock client
                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.return_value = mock_tools

                # Act: Execute the method under test
                result = MCPToolManageService.list_mcp_tool_from_remote_server(tenant.id, mcp_provider.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mcp_provider.id
        assert result.name == mcp_provider.name
        assert result.type == ToolProviderType.MCP
        # Note: server_url is mocked, so we skip that assertion to avoid encryption issues

        # Verify database state was updated
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is True
        assert mcp_provider.tools != "[]"
        assert mcp_provider.updated_at is not None

        # Verify mock interactions
        mock_mcp_client.assert_called_once_with(
            "https://example.com/mcp",
            mcp_provider.id,
            tenant.id,
            authed=False,
            for_list=True,
            headers={},
            timeout=30.0,
            sse_read_timeout=300.0,
        )

    def test_list_mcp_tool_from_remote_server_auth_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when MCP server requires authentication.

        This test verifies:
        - Proper error handling for authentication errors
        - Correct exception type and message
        - Database state remains unchanged
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        mcp_provider.server_url = "encrypted_server_url"
        mcp_provider.authed = False
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decrypted_server_url property to avoid encryption issues
        with patch("models.tools.encrypter") as mock_encrypter:
            mock_encrypter.decrypt_token.return_value = "https://example.com/mcp"

            # Mock MCPClient to raise authentication error
            with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
                from core.mcp.error import MCPAuthError

                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.side_effect = MCPAuthError("Authentication required")

                # Act & Assert: Verify proper error handling
                with pytest.raises(ValueError, match="Please auth the tool first"):
                    MCPToolManageService.list_mcp_tool_from_remote_server(tenant.id, mcp_provider.id)

        # Verify database state was not changed
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is False
        assert mcp_provider.tools == "[]"

    def test_list_mcp_tool_from_remote_server_connection_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling when MCP server connection fails.

        This test verifies:
        - Proper error handling for connection errors
        - Correct exception type and message
        - Database state remains unchanged
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        mcp_provider.server_url = "encrypted_server_url"
        mcp_provider.authed = False
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decrypted_server_url property to avoid encryption issues
        with patch("models.tools.encrypter") as mock_encrypter:
            mock_encrypter.decrypt_token.return_value = "https://example.com/mcp"

            # Mock MCPClient to raise connection error
            with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
                from core.mcp.error import MCPError

                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.side_effect = MCPError("Connection failed")

                # Act & Assert: Verify proper error handling
                with pytest.raises(ValueError, match="Failed to connect to MCP server: Connection failed"):
                    MCPToolManageService.list_mcp_tool_from_remote_server(tenant.id, mcp_provider.id)

        # Verify database state was not changed
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is False
        assert mcp_provider.tools == "[]"

    def test_delete_mcp_tool_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful deletion of MCP tool.

        This test verifies:
        - Proper deletion of MCP provider from database
        - Correct tenant isolation enforcement
        - Database state after deletion
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Verify provider exists
        from extensions.ext_database import db

        assert db.session.query(MCPToolProvider).filter_by(id=mcp_provider.id).first() is not None

        # Act: Execute the method under test
        MCPToolManageService.delete_mcp_tool(tenant.id, mcp_provider.id)

        # Assert: Verify the expected outcomes
        # Provider should be deleted from database
        deleted_provider = db.session.query(MCPToolProvider).filter_by(id=mcp_provider.id).first()
        assert deleted_provider is None

    def test_delete_mcp_tool_not_found(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when deleting non-existent MCP tool.

        This test verifies:
        - Proper error handling for non-existent provider IDs
        - Correct exception type and message
        - Tenant isolation enforcement
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        non_existent_id = fake.uuid4()

        # Act & Assert: Verify proper error handling
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.delete_mcp_tool(tenant.id, non_existent_id)

    def test_delete_mcp_tool_tenant_isolation(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test tenant isolation when deleting MCP tool.

        This test verifies:
        - Proper tenant isolation enforcement
        - Providers from other tenants cannot be deleted
        - Security boundaries are maintained
        """
        # Arrange: Create test data for two tenants
        fake = Faker()
        account1, tenant1 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        account2, tenant2 = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider in tenant1
        mcp_provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant1.id, account1.id
        )

        # Act & Assert: Verify tenant isolation
        with pytest.raises(ValueError, match="MCP tool not found"):
            MCPToolManageService.delete_mcp_tool(tenant2.id, mcp_provider1.id)

        # Verify provider still exists in tenant1
        from extensions.ext_database import db

        assert db.session.query(MCPToolProvider).filter_by(id=mcp_provider1.id).first() is not None

    def test_update_mcp_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful update of MCP provider.

        This test verifies:
        - Proper update of MCP provider fields
        - Correct database state after update
        - Proper handling of unchanged server URL
        - External service integration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        original_name = mcp_provider.name
        original_icon = mcp_provider.icon

        from extensions.ext_database import db

        db.session.commit()

        # Act: Execute the method under test
        MCPToolManageService.update_mcp_provider(
            tenant_id=tenant.id,
            provider_id=mcp_provider.id,
            name="Updated MCP Provider",
            server_url=UNCHANGED_SERVER_URL_PLACEHOLDER,  # Use placeholder for unchanged URL
            icon="🚀",
            icon_type="emoji",
            icon_background="#4ECDC4",
            server_identifier="updated_identifier_123",
            timeout=45.0,
            sse_read_timeout=400.0,
        )

        # Assert: Verify the expected outcomes
        db.session.refresh(mcp_provider)
        assert mcp_provider.name == "Updated MCP Provider"
        assert mcp_provider.server_identifier == "updated_identifier_123"
        assert mcp_provider.timeout == 45.0
        assert mcp_provider.sse_read_timeout == 400.0
        assert mcp_provider.updated_at is not None

        # Verify icon was updated
        import json

        icon_data = json.loads(mcp_provider.icon)
        assert icon_data["content"] == "🚀"
        assert icon_data["background"] == "#4ECDC4"

    def test_update_mcp_provider_with_server_url_change(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful update of MCP provider with server URL change.

        This test verifies:
        - Proper handling of server URL changes
        - Correct reconnection logic
        - Database state updates
        - External service integration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        from extensions.ext_database import db

        db.session.commit()

        # Mock the reconnection method
        with patch.object(MCPToolManageService, "_re_connect_mcp_provider") as mock_reconnect:
            mock_reconnect.return_value = {
                "authed": True,
                "tools": '[{"name": "test_tool"}]',
                "encrypted_credentials": "{}",
            }

            # Act: Execute the method under test
            MCPToolManageService.update_mcp_provider(
                tenant_id=tenant.id,
                provider_id=mcp_provider.id,
                name="Updated MCP Provider",
                server_url="https://new-example.com/mcp",
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="updated_identifier_123",
                timeout=45.0,
                sse_read_timeout=400.0,
            )

        # Assert: Verify the expected outcomes
        db.session.refresh(mcp_provider)
        assert mcp_provider.name == "Updated MCP Provider"
        assert mcp_provider.server_identifier == "updated_identifier_123"
        assert mcp_provider.timeout == 45.0
        assert mcp_provider.sse_read_timeout == 400.0
        assert mcp_provider.updated_at is not None

        # Verify reconnection was called
        mock_reconnect.assert_called_once_with("https://new-example.com/mcp", mcp_provider.id, tenant.id)

    def test_update_mcp_provider_duplicate_name(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test error handling when updating MCP provider with duplicate name.

        This test verifies:
        - Proper error handling for duplicate provider names
        - Correct exception type and message
        - Database integrity constraints
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create two MCP providers
        provider1 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        provider1.name = "First Provider"

        provider2 = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        provider2.name = "Second Provider"

        from extensions.ext_database import db

        db.session.commit()

        # Act & Assert: Verify proper error handling for duplicate name
        with pytest.raises(ValueError, match="MCP tool First Provider already exists"):
            MCPToolManageService.update_mcp_provider(
                tenant_id=tenant.id,
                provider_id=provider2.id,
                name="First Provider",  # Duplicate name
                server_url=UNCHANGED_SERVER_URL_PLACEHOLDER,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="unique_identifier",
                timeout=45.0,
                sse_read_timeout=400.0,
            )

    def test_update_mcp_provider_credentials_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful update of MCP provider credentials.

        This test verifies:
        - Proper encryption of credentials
        - Correct database state after update
        - Authentication state management
        - External service integration
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        mcp_provider.encrypted_credentials = '{"existing_key": "existing_value"}'
        mcp_provider.authed = False
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the provider controller and encryption
        with (
            patch("services.tools.mcp_tools_manage_service.MCPToolProviderController") as mock_controller,
            patch("services.tools.mcp_tools_manage_service.ProviderConfigEncrypter") as mock_encrypter,
        ):
            # Setup mocks
            mock_controller_instance = mock_controller._from_db.return_value
            mock_controller_instance.get_credentials_schema.return_value = []

            mock_encrypter_instance = mock_encrypter.return_value
            mock_encrypter_instance.encrypt.return_value = {"new_key": "encrypted_value"}

            # Act: Execute the method under test
            MCPToolManageService.update_mcp_provider_credentials(
                mcp_provider=mcp_provider, credentials={"new_key": "new_value"}, authed=True
            )

        # Assert: Verify the expected outcomes
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is True
        assert mcp_provider.updated_at is not None

        # Verify credentials were encrypted and merged
        import json

        credentials = json.loads(mcp_provider.encrypted_credentials)
        assert "existing_key" in credentials
        assert "new_key" in credentials

    def test_update_mcp_provider_credentials_not_authed(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test update of MCP provider credentials when not authenticated.

        This test verifies:
        - Proper handling of non-authenticated state
        - Tools list is cleared when not authenticated
        - Credentials are still updated
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )
        mcp_provider.encrypted_credentials = '{"existing_key": "existing_value"}'
        mcp_provider.authed = True
        mcp_provider.tools = '[{"name": "test_tool"}]'

        from extensions.ext_database import db

        db.session.commit()

        # Mock the provider controller and encryption
        with (
            patch("services.tools.mcp_tools_manage_service.MCPToolProviderController") as mock_controller,
            patch("services.tools.mcp_tools_manage_service.ProviderConfigEncrypter") as mock_encrypter,
        ):
            # Setup mocks
            mock_controller_instance = mock_controller._from_db.return_value
            mock_controller_instance.get_credentials_schema.return_value = []

            mock_encrypter_instance = mock_encrypter.return_value
            mock_encrypter_instance.encrypt.return_value = {"new_key": "encrypted_value"}

            # Act: Execute the method under test
            MCPToolManageService.update_mcp_provider_credentials(
                mcp_provider=mcp_provider, credentials={"new_key": "new_value"}, authed=False
            )

        # Assert: Verify the expected outcomes
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is False
        assert mcp_provider.tools == "[]"
        assert mcp_provider.updated_at is not None

    def test_re_connect_mcp_provider_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful reconnection to MCP provider.

        This test verifies:
        - Proper connection to remote MCP server
        - Correct tool listing and return value
        - Proper error handling for authentication errors
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider first
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Mock MCPClient and its context manager
        mock_tools = [
            type("MockTool", (), {"model_dump": lambda self: {"name": "test_tool_1", "description": "Test tool 1"}})(),
            type("MockTool", (), {"model_dump": lambda self: {"name": "test_tool_2", "description": "Test tool 2"}})(),
        ]

        with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
            # Setup mock client
            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.return_value = mock_tools

            # Act: Execute the method under test
            result = MCPToolManageService._re_connect_mcp_provider(
                "https://example.com/mcp", mcp_provider.id, tenant.id
            )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result["authed"] is True
        assert result["tools"] is not None
        assert result["encrypted_credentials"] == "{}"

        # Verify tools were properly serialized
        import json

        tools_data = json.loads(result["tools"])
        assert len(tools_data) == 2
        assert tools_data[0]["name"] == "test_tool_1"
        assert tools_data[1]["name"] == "test_tool_2"

        # Verify mock interactions
        mock_mcp_client.assert_called_once_with(
            "https://example.com/mcp",
            mcp_provider.id,
            tenant.id,
            authed=False,
            for_list=True,
            headers={},
            timeout=30.0,
            sse_read_timeout=300.0,
        )

    def test_re_connect_mcp_provider_auth_error(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test reconnection to MCP provider when authentication fails.

        This test verifies:
        - Proper handling of authentication errors
        - Correct return value for failed authentication
        - Tools list is cleared
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider first
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Mock MCPClient to raise authentication error
        with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
            from core.mcp.error import MCPAuthError

            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.side_effect = MCPAuthError("Authentication required")

            # Act: Execute the method under test
            result = MCPToolManageService._re_connect_mcp_provider(
                "https://example.com/mcp", mcp_provider.id, tenant.id
            )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result["authed"] is False
        assert result["tools"] == "[]"
        assert result["encrypted_credentials"] == "{}"

    def test_re_connect_mcp_provider_connection_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test reconnection to MCP provider when connection fails.

        This test verifies:
        - Proper error handling for connection errors
        - Correct exception type and message
        """
        # Arrange: Create test data
        fake = Faker()
        account, tenant = self._create_test_account_and_tenant(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create MCP provider first
        mcp_provider = self._create_test_mcp_provider(
            db_session_with_containers, mock_external_service_dependencies, tenant.id, account.id
        )

        # Mock MCPClient to raise connection error
        with patch("services.tools.mcp_tools_manage_service.MCPClient") as mock_mcp_client:
            from core.mcp.error import MCPError

            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.side_effect = MCPError("Connection failed")

            # Act & Assert: Verify proper error handling
            with pytest.raises(ValueError, match="Failed to re-connect MCP server: Connection failed"):
                MCPToolManageService._re_connect_mcp_provider("https://example.com/mcp", mcp_provider.id, tenant.id)
