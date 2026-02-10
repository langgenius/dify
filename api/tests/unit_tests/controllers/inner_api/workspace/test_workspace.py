"""
Unit tests for inner_api workspace module
"""

import pytest
from pydantic import ValidationError

from controllers.inner_api.workspace.workspace import (
    EnterpriseWorkspace,
    EnterpriseWorkspaceNoOwnerEmail,
    WorkspaceCreatePayload,
    WorkspaceOwnerlessPayload,
)


class TestWorkspaceCreatePayload:
    """Test WorkspaceCreatePayload Pydantic model"""

    def test_valid_payload(self):
        """Test valid payload with all fields passes validation"""
        data = {
            "name": "My Workspace",
            "owner_email": "owner@example.com",
        }
        payload = WorkspaceCreatePayload.model_validate(data)
        assert payload.name == "My Workspace"
        assert payload.owner_email == "owner@example.com"

    def test_missing_name_fails_validation(self):
        """Test that missing name fails validation"""
        data = {
            "owner_email": "owner@example.com",
        }
        with pytest.raises(ValidationError):
            WorkspaceCreatePayload.model_validate(data)

    def test_missing_owner_email_fails_validation(self):
        """Test that missing owner_email fails validation"""
        data = {
            "name": "My Workspace",
        }
        with pytest.raises(ValidationError):
            WorkspaceCreatePayload.model_validate(data)


class TestWorkspaceOwnerlessPayload:
    """Test WorkspaceOwnerlessPayload Pydantic model"""

    def test_valid_payload(self):
        """Test valid payload with name passes validation"""
        data = {"name": "My Workspace"}
        payload = WorkspaceOwnerlessPayload.model_validate(data)
        assert payload.name == "My Workspace"

    def test_missing_name_fails_validation(self):
        """Test that missing name fails validation"""
        data = {}
        with pytest.raises(ValidationError):
            WorkspaceOwnerlessPayload.model_validate(data)


class TestEnterpriseWorkspace:
    """Test EnterpriseWorkspace API endpoint"""

    @pytest.fixture
    def api_instance(self):
        """Create EnterpriseWorkspace API instance"""
        return EnterpriseWorkspace()

    def test_has_post_method(self, api_instance):
        """Test that EnterpriseWorkspace has post method"""
        assert hasattr(api_instance, "post")


class TestEnterpriseWorkspaceNoOwnerEmail:
    """Test EnterpriseWorkspaceNoOwnerEmail API endpoint"""

    @pytest.fixture
    def api_instance(self):
        """Create EnterpriseWorkspaceNoOwnerEmail API instance"""
        return EnterpriseWorkspaceNoOwnerEmail()

    def test_has_post_method(self, api_instance):
        """Test that endpoint has post method"""
        assert hasattr(api_instance, "post")
