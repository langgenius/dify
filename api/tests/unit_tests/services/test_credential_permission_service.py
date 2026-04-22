"""Unit tests for CredentialPermissionService.

Tests the visibility filtering logic, partial member list CRUD,
and admin bypass behavior.
"""

from unittest.mock import MagicMock, patch
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
        with patch("services.credential_permission_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = []
            result = CredentialPermissionService.get_partial_member_list(
                credential_id, CredentialType.TRIGGER_SUBSCRIPTION
            )
            assert result == []

    def test_returns_account_ids(self, credential_id, user_id, other_user_id):
        with patch("services.credential_permission_service.db") as mock_db:
            mock_db.session.scalars.return_value.all.return_value = [user_id, other_user_id]
            result = CredentialPermissionService.get_partial_member_list(
                credential_id, CredentialType.TRIGGER_SUBSCRIPTION
            )
            assert set(result) == {user_id, other_user_id}


class TestUpdatePartialMemberList:
    def test_inserts_new_permissions(self, tenant_id, credential_id, user_id, other_user_id):
        with patch("services.credential_permission_service.db") as mock_db:
            user_list = [{"user_id": user_id}, {"user_id": other_user_id}]
            CredentialPermissionService.update_partial_member_list(
                tenant_id=tenant_id,
                credential_id=credential_id,
                credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                user_list=user_list,
            )
            # Verify delete was called first
            mock_db.session.execute.assert_called_once()
            # Verify add_all was called with 2 permissions
            mock_db.session.add_all.assert_called_once()
            added = mock_db.session.add_all.call_args[0][0]
            assert len(added) == 2
            mock_db.session.commit.assert_called_once()

    def test_rollback_on_error(self, tenant_id, credential_id):
        with patch("services.credential_permission_service.db") as mock_db:
            mock_db.session.execute.side_effect = Exception("db error")
            with pytest.raises(Exception, match="db error"):
                CredentialPermissionService.update_partial_member_list(
                    tenant_id=tenant_id,
                    credential_id=credential_id,
                    credential_type=CredentialType.TRIGGER_SUBSCRIPTION,
                    user_list=[{"user_id": str(uuid4())}],
                )
            mock_db.session.rollback.assert_called_once()


class TestClearPartialMemberList:
    def test_clears_and_commits(self, credential_id):
        with patch("services.credential_permission_service.db") as mock_db:
            CredentialPermissionService.clear_partial_member_list(credential_id, CredentialType.BUILTIN_TOOL_PROVIDER)
            mock_db.session.execute.assert_called_once()
            mock_db.session.commit.assert_called_once()


class TestApplyVisibilityFilter:
    """Test the visibility filter logic using mock model columns."""

    def _make_mock_columns(self):
        """Create mock model columns for testing."""
        model_id = MagicMock(name="id_column")
        model_user_id = MagicMock(name="user_id_column")
        model_visibility = MagicMock(name="visibility_column")
        return model_id, model_user_id, model_visibility

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
            user_id=user_id,
            is_admin=True,
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
            user_id=user_id,
            is_admin=False,
        )
        # The compiled SQL should include a WHERE clause referencing user_id and visibility
        compiled = str(result.compile(compile_kwargs={"literal_binds": True}))
        assert "WHERE" in compiled
        assert "visibility" in compiled
        assert "user_id" in compiled
