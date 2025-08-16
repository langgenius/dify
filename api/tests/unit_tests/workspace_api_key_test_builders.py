"""
Test data builders specifically for workspace API key testing.

This module provides builder classes for creating workspace API key test data
with minimal configuration while maintaining consistency across tests.
"""

import json
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import Mock


class WorkspaceApiKeyBuilder:
    """Builder pattern for creating WorkspaceApiKey test data.

    Provides a fluent interface for creating test data with sensible defaults
    and the ability to customize specific fields as needed for workspace API key tests.
    """

    def __init__(self):
        """Initialize builder with default values for workspace API key."""
        self.data = {
            "id": "wsk-test-api-key-id",
            "tenant_id": "test-tenant-id",
            "name": "test-workspace-api-key",
            "token": "encrypted-wsk-token",
            "created_by": "test-user-id",
            "scopes": '["workspace:read"]',
            "expires_at": None,
            "last_used_at": None,
            "created_at": datetime.utcnow(),
        }

    def with_id(self, api_key_id: str) -> "WorkspaceApiKeyBuilder":
        """Set the API key ID."""
        self.data["id"] = api_key_id
        return self

    def with_tenant_id(self, tenant_id: str) -> "WorkspaceApiKeyBuilder":
        """Set the tenant ID."""
        self.data["tenant_id"] = tenant_id
        return self

    def with_name(self, name: str) -> "WorkspaceApiKeyBuilder":
        """Set the API key name."""
        self.data["name"] = name
        return self

    def with_token(self, token: str) -> "WorkspaceApiKeyBuilder":
        """Set the encrypted token."""
        self.data["token"] = token
        return self

    def with_created_by(self, user_id: str) -> "WorkspaceApiKeyBuilder":
        """Set the creator user ID."""
        self.data["created_by"] = user_id
        return self

    def with_workspace_scopes(self, scopes: list[str]) -> "WorkspaceApiKeyBuilder":
        """Set workspace-specific scopes as a list (will be JSON encoded)."""
        # Validate that scopes are workspace-related
        valid_workspace_scopes = [
            "workspace:read",
            "workspace:write",
            "workspace:admin",
            "apps:read",
            "apps:write",
            "apps:admin",
            "members:read",
            "members:write",
            "members:admin",
        ]
        for scope in scopes:
            if scope not in valid_workspace_scopes:
                raise ValueError(f"Invalid workspace scope: {scope}")

        self.data["scopes"] = json.dumps(scopes)
        return self

    def with_scopes_json(self, scopes_json: str) -> "WorkspaceApiKeyBuilder":
        """Set the scopes as a JSON string directly (for testing edge cases)."""
        self.data["scopes"] = scopes_json
        return self

    def with_read_only_access(self) -> "WorkspaceApiKeyBuilder":
        """Set scopes for read-only access."""
        return self.with_workspace_scopes(["workspace:read", "apps:read"])

    def with_full_access(self) -> "WorkspaceApiKeyBuilder":
        """Set scopes for full workspace access."""
        return self.with_workspace_scopes(["workspace:admin", "apps:admin", "members:admin"])

    def with_editor_access(self) -> "WorkspaceApiKeyBuilder":
        """Set scopes for editor-level access."""
        return self.with_workspace_scopes(["workspace:read", "apps:write"])

    def expired(self, days_ago: int = 1) -> "WorkspaceApiKeyBuilder":
        """Set the API key as expired."""
        self.data["expires_at"] = datetime.utcnow() - timedelta(days=days_ago)
        return self

    def expires_in(self, days: int) -> "WorkspaceApiKeyBuilder":
        """Set the API key to expire in the specified number of days."""
        self.data["expires_at"] = datetime.utcnow() + timedelta(days=days)
        return self

    def recently_used(self, hours_ago: int = 1) -> "WorkspaceApiKeyBuilder":
        """Set the API key as recently used."""
        self.data["last_used_at"] = datetime.utcnow() - timedelta(hours=hours_ago)
        return self

    def never_used(self) -> "WorkspaceApiKeyBuilder":
        """Set the API key as never used."""
        self.data["last_used_at"] = None
        return self

    def build(self) -> Mock:
        """Build a mock WorkspaceApiKey object with the configured data.

        Returns:
            Mock object with all the configured properties and methods.
        """
        mock_api_key = Mock()

        # Set all properties
        for key, value in self.data.items():
            setattr(mock_api_key, key, value)

        # Add scopes_list property
        try:
            scopes_list = json.loads(self.data["scopes"])
        except (json.JSONDecodeError, TypeError):
            scopes_list = []

        mock_api_key.scopes_list = scopes_list

        # Add to_dict method
        def to_dict():
            is_expired = False
            if self.data["expires_at"]:
                is_expired = self.data["expires_at"] < datetime.utcnow()

            return {
                "id": self.data["id"],
                "name": self.data["name"],
                "token": self.data["token"][:8] + "..." if self.data["token"] else "",
                "type": "workspace",
                "scopes": scopes_list,
                "created_at": self.data["created_at"],
                "last_used_at": self.data["last_used_at"],
                "expires_at": self.data["expires_at"].isoformat() if self.data["expires_at"] else None,
                "is_expired": is_expired,
                "created_by": self.data["created_by"],
            }

        mock_api_key.to_dict = to_dict

        # Add to_auth_dict method
        def to_auth_dict():
            return {
                "tenant_id": self.data["tenant_id"],
                "token": self.data["token"],
                "name": self.data["name"],
                "scopes": scopes_list,
                "account_id": self.data["created_by"],
            }

        mock_api_key.to_auth_dict = to_auth_dict

        return mock_api_key

    def build_dict(self) -> dict[str, Any]:
        """Build a dictionary representation for workspace API key data.

        Useful for testing serialization or when a plain dict is needed.
        """
        return self.data.copy()


class WorkspaceTenantAccountJoinBuilder:
    """Builder for creating TenantAccountJoin test data for workspace API key tests."""

    def __init__(self):
        """Initialize builder with default values."""
        self.data = {
            "tenant_id": "test-workspace-tenant-id",
            "account_id": "test-workspace-account-id",
            "role": "owner",
        }

    def with_tenant_id(self, tenant_id: str) -> "WorkspaceTenantAccountJoinBuilder":
        """Set the tenant ID."""
        self.data["tenant_id"] = tenant_id
        return self

    def with_account_id(self, account_id: str) -> "WorkspaceTenantAccountJoinBuilder":
        """Set the account ID."""
        self.data["account_id"] = account_id
        return self

    def with_role(self, role: str) -> "WorkspaceTenantAccountJoinBuilder":
        """Set the role."""
        valid_roles = ["owner", "admin", "editor", "normal", "dataset_operator"]
        if role not in valid_roles:
            raise ValueError(f"Invalid role: {role}. Must be one of {valid_roles}")
        self.data["role"] = role
        return self

    def as_workspace_owner(self) -> "WorkspaceTenantAccountJoinBuilder":
        """Set role as workspace owner (full permissions)."""
        self.data["role"] = "owner"
        return self

    def as_workspace_admin(self) -> "WorkspaceTenantAccountJoinBuilder":
        """Set role as workspace admin (management permissions)."""
        self.data["role"] = "admin"
        return self

    def as_workspace_editor(self) -> "WorkspaceTenantAccountJoinBuilder":
        """Set role as workspace editor (limited write permissions)."""
        self.data["role"] = "editor"
        return self

    def as_workspace_member(self) -> "WorkspaceTenantAccountJoinBuilder":
        """Set role as normal workspace member (read permissions)."""
        self.data["role"] = "normal"
        return self

    def build(self) -> Mock:
        """Build a mock TenantAccountJoin object."""
        mock_join = Mock()
        for key, value in self.data.items():
            setattr(mock_join, key, value)
        return mock_join


class WorkspaceApiKeyTestScenarioBuilder:
    """Builder for creating complete test scenarios for workspace API key testing."""

    def __init__(self):
        """Initialize scenario builder."""
        self.api_key_builder = WorkspaceApiKeyBuilder()
        self.tenant_join_builder = WorkspaceTenantAccountJoinBuilder()
        self.scenario_name = "default_scenario"

    def named(self, name: str) -> "WorkspaceApiKeyTestScenarioBuilder":
        """Set a name for this test scenario."""
        self.scenario_name = name
        return self

    def with_owner_creating_admin_key(self) -> "WorkspaceApiKeyTestScenarioBuilder":
        """Scenario: Workspace owner creating an admin-level API key."""
        self.tenant_join_builder.as_workspace_owner()
        self.api_key_builder.with_full_access().with_name("admin-api-key")
        return self

    def with_editor_creating_read_key(self) -> "WorkspaceApiKeyTestScenarioBuilder":
        """Scenario: Workspace editor creating a read-only API key."""
        self.tenant_join_builder.as_workspace_editor()
        self.api_key_builder.with_read_only_access().with_name("readonly-api-key")
        return self

    def with_expired_key_scenario(self) -> "WorkspaceApiKeyTestScenarioBuilder":
        """Scenario: Testing with an expired API key."""
        self.api_key_builder.expired(days_ago=7).with_name("expired-api-key")
        return self

    def with_never_used_key_scenario(self) -> "WorkspaceApiKeyTestScenarioBuilder":
        """Scenario: Testing with a never-used API key."""
        self.api_key_builder.never_used().with_name("unused-api-key")
        return self

    def build_scenario(self) -> dict[str, Any]:
        """Build the complete test scenario.

        Returns:
            Dictionary containing all scenario components.
        """
        return {
            "name": self.scenario_name,
            "api_key": self.api_key_builder.build(),
            "tenant_join": self.tenant_join_builder.build(),
            "api_key_data": self.api_key_builder.build_dict(),
        }
