"""Unit tests for CredentialPermissionService.

Tests the visibility filtering logic, partial-member read path,
and admin bypass behavior.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import select

from models.credential_permission import CredentialType
from services.credential_permission_service import CredentialPermissionService


@pytest.fixture
def tenant_id():
    return str(uuid4())


@pytest.fixture
def user_id():
    return str(uuid4())


@pytest.fixture
def other_user_id():
    return str(uuid4())


@pytest.fixture
def credential_id():
    return str(uuid4())


class TestGetPartialMemberList:
    def test_returns_empty_when_no_permissions(self, credential_id):
        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = []
        result = CredentialPermissionService.get_partial_member_list(
            mock_session, credential_id, CredentialType.TRIGGER_SUBSCRIPTION
        )
        assert result == []

    def test_returns_account_ids(self, credential_id, user_id, other_user_id):
        mock_session = MagicMock()
        mock_session.scalars.return_value.all.return_value = [user_id, other_user_id]
        result = CredentialPermissionService.get_partial_member_list(
            mock_session, credential_id, CredentialType.TRIGGER_SUBSCRIPTION
        )
        assert set(result) == {user_id, other_user_id}


class TestApplyVisibilityFilter:
    """Test the visibility filter logic using mock model columns."""

    def _make_mock_columns(self):
        """Create mock model columns for testing."""
        model_id = MagicMock(name="id_column")
        model_user_id = MagicMock(name="user_id_column")
        model_visibility = MagicMock(name="visibility_column")
        return model_id, model_user_id, model_visibility

    def _make_user(self, user_id: str, is_admin: bool):
        return SimpleNamespace(id=user_id, is_admin_or_owner=is_admin)

    def test_admin_gets_filtered_too(self, user_id):
        """Admin should NOT bypass visibility — personal credentials are private regardless of role."""
        from models.trigger import TriggerSubscription

        query = select(TriggerSubscription)
        result = CredentialPermissionService.apply_visibility_filter(
            query,
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            user=self._make_user(user_id, is_admin=True),
        )
        # No admin bypass: query should have WHERE clause
        compiled = str(result.compile(compile_kwargs={"literal_binds": True}))
        assert "WHERE" in compiled

    def test_non_admin_adds_filter_on_real_model(self, user_id):
        """Non-admin should get a filtered query when using real SQLAlchemy columns."""
        from models.trigger import TriggerSubscription

        query = select(TriggerSubscription)
        result = CredentialPermissionService.apply_visibility_filter(
            query,
            model_id_column=TriggerSubscription.id,
            model_user_id_column=TriggerSubscription.user_id,
            model_visibility_column=TriggerSubscription.visibility,
            credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
            user=self._make_user(user_id, is_admin=False),
        )
        # The compiled SQL should include a WHERE clause referencing user_id and visibility
        compiled = str(result.compile(compile_kwargs={"literal_binds": True}))
        assert "WHERE" in compiled
        assert "visibility" in compiled
        assert "user_id" in compiled
