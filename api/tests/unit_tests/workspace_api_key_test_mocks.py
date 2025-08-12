"""
Mock factory specifically for workspace API key testing.

This module provides standardized mock objects with minimal configuration
specifically designed for workspace API key tests.
"""

from datetime import datetime
from typing import Any, Optional
from unittest.mock import Mock


class WorkspaceApiKeyMockFactory:
    """Factory for creating workspace API key specific mock objects."""

    @staticmethod
    def create_tenant_account_join(
        tenant_id: str = "test-tenant-id", account_id: str = "test-account-id", role: str = "owner"
    ) -> Mock:
        """Create a mock TenantAccountJoin object for workspace API key tests.

        Args:
            tenant_id: The tenant ID (default: 'test-tenant-id')
            account_id: The account ID (default: 'test-account-id')
            role: The user role (default: 'owner')

        Returns:
            Mock TenantAccountJoin object with minimal required properties.
        """
        mock_join = Mock()
        mock_join.tenant_id = tenant_id
        mock_join.account_id = account_id
        mock_join.role = role
        return mock_join

    @staticmethod
    def create_workspace_api_key_mock(
        api_key_id: str = "test-api-key-id",
        tenant_id: str = "test-tenant-id",
        name: str = "test-api-key",
        token: str = "encrypted-token",
        created_by: str = "test-user-id",
        scopes: list[str] | None = None,
        expires_at: Optional[datetime] = None,
        last_used_at: Optional[datetime] = None,
    ) -> Mock:
        """Create a mock WorkspaceApiKey object.

        Args:
            api_key_id: The API key ID
            tenant_id: The tenant ID
            name: The API key name
            token: The encrypted token
            created_by: The creator user ID
            scopes: List of scopes (default: ['workspace:read'])
            expires_at: Expiration datetime
            last_used_at: Last used datetime

        Returns:
            Mock WorkspaceApiKey object with methods.
        """
        if scopes is None:
            scopes = ["workspace:read"]

        mock_api_key = Mock()
        mock_api_key.id = api_key_id
        mock_api_key.tenant_id = tenant_id
        mock_api_key.name = name
        mock_api_key.token = token
        mock_api_key.created_by = created_by
        mock_api_key.scopes = str(scopes)  # JSON string representation
        mock_api_key.scopes_list = scopes
        mock_api_key.expires_at = expires_at
        mock_api_key.last_used_at = last_used_at
        mock_api_key.created_at = datetime.utcnow()

        # Add to_dict method
        def to_dict():
            is_expired = False
            if expires_at:
                is_expired = expires_at < datetime.utcnow()

            return {
                "id": api_key_id,
                "name": name,
                "token": token[:8] + "..." if token else "",
                "type": "workspace",
                "scopes": scopes,
                "created_at": mock_api_key.created_at,
                "last_used_at": last_used_at,
                "expires_at": expires_at.isoformat() if expires_at else None,
                "is_expired": is_expired,
                "created_by": created_by,
            }

        mock_api_key.to_dict = to_dict

        # Add to_auth_dict method
        def to_auth_dict():
            return {"tenant_id": tenant_id, "token": token, "name": name, "scopes": scopes, "account_id": created_by}

        mock_api_key.to_auth_dict = to_auth_dict

        return mock_api_key

    @staticmethod
    def create_db_session_mock_for_workspace_api_key(
        first_result: Optional[Any] = None,
        all_result: Optional[list[Any]] = None,
    ) -> Mock:
        """Create a mock database session specifically for workspace API key operations.

        Args:
            first_result: Result of filter().first() call
            all_result: Result of filter().all() call

        Returns:
            Mock database session configured for workspace API key queries.
        """
        mock_session = Mock()

        # Create query mock
        mock_query = Mock()
        mock_session.query.return_value = mock_query

        # Create filter mock
        mock_filter = Mock()
        mock_query.filter.return_value = mock_filter

        # Configure results
        mock_filter.first.return_value = first_result
        mock_filter.all.return_value = all_result or []

        # Standard session methods
        mock_session.add = Mock()
        mock_session.commit = Mock()
        mock_session.delete = Mock()
        mock_session.rollback = Mock()

        return mock_session

    @staticmethod
    def create_workspace_api_key_service_mocks() -> dict[str, Mock]:
        """Create a complete set of mocks for workspace API key service testing.

        Returns:
            Dictionary containing all commonly used mock objects.
        """
        return {
            "db_session": WorkspaceApiKeyMockFactory.create_db_session_mock_for_workspace_api_key(),
            "tenant_join": WorkspaceApiKeyMockFactory.create_tenant_account_join(),
            "api_key": WorkspaceApiKeyMockFactory.create_workspace_api_key_mock(),
        }


class WorkspaceApiKeyQueryMockBuilder:
    """Builder for creating workspace API key specific database query mocks."""

    def __init__(self):
        """Initialize the query builder for workspace API key operations."""
        self.mock_session = Mock()
        self.mock_query = Mock()
        self.mock_filter = Mock()

        # Set up the chain
        self.mock_session.query.return_value = self.mock_query
        self.mock_query.filter.return_value = self.mock_filter

        # Default returns
        self.mock_filter.first.return_value = None
        self.mock_filter.all.return_value = []

        # Standard session methods
        self.mock_session.add = Mock()
        self.mock_session.commit = Mock()
        self.mock_session.delete = Mock()
        self.mock_session.rollback = Mock()

    def with_tenant_account_join(self, role: str = "owner") -> "WorkspaceApiKeyQueryMockBuilder":
        """Configure mock to return a tenant account join with specified role."""
        tenant_join = WorkspaceApiKeyMockFactory.create_tenant_account_join(role=role)
        self.mock_filter.first.return_value = tenant_join
        return self

    def with_existing_api_keys(self, count: int = 1) -> "WorkspaceApiKeyQueryMockBuilder":
        """Configure mock to return existing API keys."""
        api_keys = []
        for i in range(count):
            api_key = WorkspaceApiKeyMockFactory.create_workspace_api_key_mock(
                api_key_id=f"key-{i}", name=f"test-key-{i}"
            )
            api_keys.append(api_key)
        self.mock_filter.all.return_value = api_keys
        return self

    def with_no_results(self) -> "WorkspaceApiKeyQueryMockBuilder":
        """Configure mock to return no results."""
        self.mock_filter.first.return_value = None
        self.mock_filter.all.return_value = []
        return self

    def build(self) -> Mock:
        """Build the configured mock session."""
        return self.mock_session
