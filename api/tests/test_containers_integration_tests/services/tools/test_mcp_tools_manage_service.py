from unittest.mock import patch

import pytest
from faker import Faker

from core.tools.entities.tool_entities import ToolProviderType
from models import Account, Tenant
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
            from core.tools.entities.api_entities import ToolProviderApiEntity
            from core.tools.entities.common_entities import I18nObject

            mock_encrypter.encrypt_token.return_value = "encrypted_server_url"
            mock_tool_transform_service.mcp_provider_to_user_provider.return_value = ToolProviderApiEntity(
                id="test_id",
                author="test_author",
                name="test_name",
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Test Description", zh_Hans="测试描述"),
                icon={"type": "emoji", "content": "🤖"},
                label=I18nObject(en_US="Test Label", zh_Hans="测试标签"),
                labels=[],
                tools=[],
            )

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
            role=TenantAccountRole.OWNER,
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
            server_identifier=str(fake.uuid4()),
            server_url="encrypted_server_url",
            server_url_hash=str(fake.sha256()),
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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result = service.get_provider(provider_id=mcp_provider.id, tenant_id=tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mcp_provider.id
        assert result.name == mcp_provider.name
        assert result.tenant_id == tenant.id
        assert result.user_id == account.id

        # Verify database state
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

        non_existent_id = str(fake.uuid4())

        # Act & Assert: Verify proper error handling
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider(provider_id=non_existent_id, tenant_id=tenant.id)

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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider(provider_id=mcp_provider1.id, tenant_id=tenant2.id)

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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result = service.get_provider(server_identifier=mcp_provider.server_identifier, tenant_id=tenant.id)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.id == mcp_provider.id
        assert result.server_identifier == mcp_provider.server_identifier
        assert result.tenant_id == tenant.id
        assert result.user_id == account.id

        # Verify database state
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

        non_existent_identifier = str(fake.uuid4())

        # Act & Assert: Verify proper error handling
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider(server_identifier=non_existent_identifier, tenant_id=tenant.id)

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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider(server_identifier=mcp_provider1.server_identifier, tenant_id=tenant2.id)

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
        from core.tools.entities.api_entities import ToolProviderApiEntity
        from core.tools.entities.common_entities import I18nObject

        mock_external_service_dependencies["encrypter"].encrypt_token.return_value = "encrypted_server_url"
        mock_external_service_dependencies[
            "tool_transform_service"
        ].mcp_provider_to_user_provider.return_value = ToolProviderApiEntity(
            id="new_provider_id",
            author=account.name,
            name="Test MCP Provider",
            type=ToolProviderType.MCP,
            description=I18nObject(en_US="Test MCP Provider Description", zh_Hans="测试MCP提供者描述"),
            icon={"type": "emoji", "content": "🤖"},
            label=I18nObject(en_US="Test MCP Provider", zh_Hans="测试MCP提供者"),
            labels=[],
            tools=[],
        )

        # Act: Execute the method under test
        from core.entities.mcp_provider import MCPConfiguration
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result = service.create_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider",
            server_url="https://example.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_123",
            configuration=MCPConfiguration(
                timeout=30.0,
                sse_read_timeout=300.0,
            ),
        )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.name == "Test MCP Provider"
        assert result.type == ToolProviderType.MCP

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
        from core.entities.mcp_provider import MCPConfiguration
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        service.create_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider",
            server_url="https://example1.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_1",
            configuration=MCPConfiguration(
                timeout=30.0,
                sse_read_timeout=300.0,
            ),
        )

        # Act & Assert: Verify proper error handling for duplicate name
        with pytest.raises(ValueError, match="MCP tool Test MCP Provider already exists"):
            service.create_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider",  # Duplicate name
                server_url="https://example2.com/mcp",
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_2",
                configuration=MCPConfiguration(
                    timeout=45.0,
                    sse_read_timeout=400.0,
                ),
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
        from core.entities.mcp_provider import MCPConfiguration
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        service.create_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider 1",
            server_url="https://example.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_1",
            configuration=MCPConfiguration(
                timeout=30.0,
                sse_read_timeout=300.0,
            ),
        )

        # Act & Assert: Verify proper error handling for duplicate server URL
        with pytest.raises(ValueError, match="MCP tool with this server URL already exists"):
            service.create_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider 2",
                server_url="https://example.com/mcp",  # Duplicate URL
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_2",
                configuration=MCPConfiguration(
                    timeout=45.0,
                    sse_read_timeout=400.0,
                ),
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
        from core.entities.mcp_provider import MCPConfiguration
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        service.create_provider(
            tenant_id=tenant.id,
            name="Test MCP Provider 1",
            server_url="https://example1.com/mcp",
            user_id=account.id,
            icon="🤖",
            icon_type="emoji",
            icon_background="#FF6B6B",
            server_identifier="test_identifier_123",
            configuration=MCPConfiguration(
                timeout=30.0,
                sse_read_timeout=300.0,
            ),
        )

        # Act & Assert: Verify proper error handling for duplicate server identifier
        with pytest.raises(ValueError, match="MCP tool test_identifier_123 already exists"):
            service.create_provider(
                tenant_id=tenant.id,
                name="Test MCP Provider 2",
                server_url="https://example2.com/mcp",
                user_id=account.id,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="test_identifier_123",  # Duplicate identifier
                configuration=MCPConfiguration(
                    timeout=45.0,
                    sse_read_timeout=400.0,
                ),
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
        from core.tools.entities.api_entities import ToolProviderApiEntity
        from core.tools.entities.common_entities import I18nObject

        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.side_effect = [
            ToolProviderApiEntity(
                id=provider1.id,
                author=account.name,
                name=provider1.name,
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Alpha Provider Description", zh_Hans="Alpha提供者描述"),
                icon={"type": "emoji", "content": "🅰️"},
                label=I18nObject(en_US=provider1.name, zh_Hans=provider1.name),
                labels=[],
                tools=[],
            ),
            ToolProviderApiEntity(
                id=provider2.id,
                author=account.name,
                name=provider2.name,
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Beta Provider Description", zh_Hans="Beta提供者描述"),
                icon={"type": "emoji", "content": "🅱️"},
                label=I18nObject(en_US=provider2.name, zh_Hans=provider2.name),
                labels=[],
                tools=[],
            ),
            ToolProviderApiEntity(
                id=provider3.id,
                author=account.name,
                name=provider3.name,
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Gamma Provider Description", zh_Hans="Gamma提供者描述"),
                icon={"type": "emoji", "content": "Γ"},
                label=I18nObject(en_US=provider3.name, zh_Hans=provider3.name),
                labels=[],
                tools=[],
            ),
        ]

        # Act: Execute the method under test
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result = service.list_providers(tenant_id=tenant.id, for_list=True)

        # Assert: Verify the expected outcomes
        assert result is not None
        assert len(result) == 3

        # Verify correct ordering by name
        assert result[0].name == "Alpha Provider"
        assert result[1].name == "Beta Provider"
        assert result[2].name == "Gamma Provider"

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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result = service.list_providers(tenant_id=tenant.id, for_list=False)

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
        from core.tools.entities.api_entities import ToolProviderApiEntity
        from core.tools.entities.common_entities import I18nObject

        mock_external_service_dependencies["tool_transform_service"].mcp_provider_to_user_provider.side_effect = [
            ToolProviderApiEntity(
                id=provider1.id,
                author=account1.name,
                name=provider1.name,
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Provider 1 Description", zh_Hans="提供者1描述"),
                icon={"type": "emoji", "content": "1️⃣"},
                label=I18nObject(en_US=provider1.name, zh_Hans=provider1.name),
                labels=[],
                tools=[],
            ),
            ToolProviderApiEntity(
                id=provider2.id,
                author=account2.name,
                name=provider2.name,
                type=ToolProviderType.MCP,
                description=I18nObject(en_US="Provider 2 Description", zh_Hans="提供者2描述"),
                icon={"type": "emoji", "content": "2️⃣"},
                label=I18nObject(en_US=provider2.name, zh_Hans=provider2.name),
                labels=[],
                tools=[],
            ),
        ]

        # Act: Execute the method under test for both tenants
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        result1 = service.list_providers(tenant_id=tenant1.id, for_list=True)
        result2 = service.list_providers(tenant_id=tenant2.id, for_list=True)

        # Assert: Verify tenant isolation
        assert len(result1) == 1
        assert len(result2) == 1
        assert result1[0].id == provider1.id
        assert result2[0].id == provider2.id

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
        # Use a valid base64 encoded string to avoid decryption errors
        import base64

        mcp_provider.server_url = base64.b64encode(b"encrypted_server_url").decode()
        mcp_provider.authed = True  # Provider must be authenticated to list tools
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decryption process at the rsa level to avoid key file issues
        with patch("libs.rsa.decrypt") as mock_decrypt:
            mock_decrypt.return_value = "https://example.com/mcp"

            # Mock MCPClient and its context manager
            mock_tools = [
                type(
                    "MockTool", (), {"model_dump": lambda self: {"name": "test_tool_1", "description": "Test tool 1"}}
                )(),
                type(
                    "MockTool", (), {"model_dump": lambda self: {"name": "test_tool_2", "description": "Test tool 2"}}
                )(),
            ]

            with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
                # Setup mock client
                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.return_value = mock_tools

                # Act: Execute the method under test
                from extensions.ext_database import db

                service = MCPToolManageService(db.session())
                result = service.list_provider_tools(tenant_id=tenant.id, provider_id=mcp_provider.id)

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
        # MCPClientWithAuthRetry is called with different parameters
        mock_mcp_client.assert_called_once()

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
        # Use a valid base64 encoded string to avoid decryption errors
        import base64

        mcp_provider.server_url = base64.b64encode(b"encrypted_server_url").decode()
        mcp_provider.authed = False
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decryption process at the rsa level to avoid key file issues
        with patch("libs.rsa.decrypt") as mock_decrypt:
            mock_decrypt.return_value = "https://example.com/mcp"

            # Mock MCPClient to raise authentication error
            with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
                from core.mcp.error import MCPAuthError

                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.side_effect = MCPAuthError("Authentication required")

                # Act & Assert: Verify proper error handling
                from extensions.ext_database import db

                service = MCPToolManageService(db.session())
                with pytest.raises(ValueError, match="Please auth the tool first"):
                    service.list_provider_tools(tenant_id=tenant.id, provider_id=mcp_provider.id)

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
        # Use a valid base64 encoded string to avoid decryption errors
        import base64

        mcp_provider.server_url = base64.b64encode(b"encrypted_server_url").decode()
        mcp_provider.authed = True  # Provider must be authenticated to test connection errors
        mcp_provider.tools = "[]"

        from extensions.ext_database import db

        db.session.commit()

        # Mock the decryption process at the rsa level to avoid key file issues
        with patch("libs.rsa.decrypt") as mock_decrypt:
            mock_decrypt.return_value = "https://example.com/mcp"

            # Mock MCPClient to raise connection error
            with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
                from core.mcp.error import MCPError

                mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
                mock_client_instance.list_tools.side_effect = MCPError("Connection failed")

                # Act & Assert: Verify proper error handling
                from extensions.ext_database import db

                service = MCPToolManageService(db.session())
                with pytest.raises(ValueError, match="Failed to connect to MCP server: Connection failed"):
                    service.list_provider_tools(tenant_id=tenant.id, provider_id=mcp_provider.id)

        # Verify database state was not changed
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is True  # Provider remains authenticated
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
        service = MCPToolManageService(db.session())
        service.delete_provider(tenant_id=tenant.id, provider_id=mcp_provider.id)

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

        non_existent_id = str(fake.uuid4())

        # Act & Assert: Verify proper error handling
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.delete_provider(tenant_id=tenant.id, provider_id=non_existent_id)

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
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.delete_provider(tenant_id=tenant2.id, provider_id=mcp_provider1.id)

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
        from core.entities.mcp_provider import MCPConfiguration

        service = MCPToolManageService(db.session())
        service.update_provider(
            tenant_id=tenant.id,
            provider_id=mcp_provider.id,
            name="Updated MCP Provider",
            server_url=UNCHANGED_SERVER_URL_PLACEHOLDER,  # Use placeholder for unchanged URL
            icon="🚀",
            icon_type="emoji",
            icon_background="#4ECDC4",
            server_identifier="updated_identifier_123",
            configuration=MCPConfiguration(
                timeout=45.0,
                sse_read_timeout=400.0,
            ),
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

        icon_data = json.loads(mcp_provider.icon or "{}")
        assert icon_data["content"] == "🚀"
        assert icon_data["background"] == "#4ECDC4"

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
        from core.entities.mcp_provider import MCPConfiguration
        from extensions.ext_database import db

        service = MCPToolManageService(db.session())
        with pytest.raises(ValueError, match="MCP tool First Provider already exists"):
            service.update_provider(
                tenant_id=tenant.id,
                provider_id=provider2.id,
                name="First Provider",  # Duplicate name
                server_url=UNCHANGED_SERVER_URL_PLACEHOLDER,
                icon="🚀",
                icon_type="emoji",
                icon_background="#4ECDC4",
                server_identifier="unique_identifier",
                configuration=MCPConfiguration(
                    timeout=45.0,
                    sse_read_timeout=400.0,
                ),
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
            patch("core.tools.mcp_tool.provider.MCPToolProviderController") as mock_controller,
            patch("core.tools.utils.encryption.ProviderConfigEncrypter") as mock_encrypter,
        ):
            # Setup mocks
            mock_controller_instance = mock_controller.from_db.return_value
            mock_controller_instance.get_credentials_schema.return_value = []

            mock_encrypter_instance = mock_encrypter.return_value
            mock_encrypter_instance.encrypt.return_value = {"new_key": "encrypted_value"}

            # Act: Execute the method under test
            from extensions.ext_database import db

            service = MCPToolManageService(db.session())
            service.update_provider_credentials(
                provider_id=mcp_provider.id,
                tenant_id=tenant.id,
                credentials={"new_key": "new_value"},
                authed=True,
            )

        # Assert: Verify the expected outcomes
        db.session.refresh(mcp_provider)
        assert mcp_provider.authed is True
        assert mcp_provider.updated_at is not None

        # Verify credentials were encrypted and merged
        import json

        credentials = json.loads(mcp_provider.encrypted_credentials or "{}")
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
            patch("core.tools.mcp_tool.provider.MCPToolProviderController") as mock_controller,
            patch("core.tools.utils.encryption.ProviderConfigEncrypter") as mock_encrypter,
        ):
            # Setup mocks
            mock_controller_instance = mock_controller.from_db.return_value
            mock_controller_instance.get_credentials_schema.return_value = []

            mock_encrypter_instance = mock_encrypter.return_value
            mock_encrypter_instance.encrypt.return_value = {"new_key": "encrypted_value"}

            # Act: Execute the method under test
            from extensions.ext_database import db

            service = MCPToolManageService(db.session())
            service.update_provider_credentials(
                provider_id=mcp_provider.id,
                tenant_id=tenant.id,
                credentials={"new_key": "new_value"},
                authed=False,
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

        with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
            # Setup mock client
            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.return_value = mock_tools

            # Act: Execute the method under test
            from extensions.ext_database import db

            service = MCPToolManageService(db.session())
            result = service._reconnect_provider(
                server_url="https://example.com/mcp",
                provider=mcp_provider,
            )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.authed is True
        assert result.tools is not None
        assert result.encrypted_credentials == "{}"

        # Verify tools were properly serialized
        import json

        tools_data = json.loads(result.tools)
        assert len(tools_data) == 2
        assert tools_data[0]["name"] == "test_tool_1"
        assert tools_data[1]["name"] == "test_tool_2"

        # Verify mock interactions
        provider_entity = mcp_provider.to_entity()
        mock_mcp_client.assert_called_once()

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
        with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
            from core.mcp.error import MCPAuthError

            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.side_effect = MCPAuthError("Authentication required")

            # Act: Execute the method under test
            from extensions.ext_database import db

            service = MCPToolManageService(db.session())
            result = service._reconnect_provider(
                server_url="https://example.com/mcp",
                provider=mcp_provider,
            )

        # Assert: Verify the expected outcomes
        assert result is not None
        assert result.authed is False
        assert result.tools == "[]"
        assert result.encrypted_credentials == "{}"

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
        with patch("services.tools.mcp_tools_manage_service.MCPClientWithAuthRetry") as mock_mcp_client:
            from core.mcp.error import MCPError

            mock_client_instance = mock_mcp_client.return_value.__enter__.return_value
            mock_client_instance.list_tools.side_effect = MCPError("Connection failed")

            # Act & Assert: Verify proper error handling
            from extensions.ext_database import db

            service = MCPToolManageService(db.session())
            with pytest.raises(ValueError, match="Failed to re-connect MCP server: Connection failed"):
                service._reconnect_provider(
                    server_url="https://example.com/mcp",
                    provider=mcp_provider,
                )
