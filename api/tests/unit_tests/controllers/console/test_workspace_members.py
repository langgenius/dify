from types import SimpleNamespace
from unittest.mock import ANY, patch

import pytest
from flask import Flask, g

from controllers.console.workspace.error import InvalidMemberRoleError
from controllers.console.workspace.members import MemberInviteEmailApi
from models.account import Account, TenantAccountRole


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    flask_app.login_manager = SimpleNamespace(load_user_from_request_context=lambda: None)
    return flask_app


class TestMemberInviteEmailApi:
    @pytest.fixture(autouse=True)
    def _member_config(self, config_overrides) -> None:
        config_overrides(
            RBAC_ENABLED=False,
            CONSOLE_WEB_URL="https://console.example.com",
        )

    @patch("controllers.console.workspace.members.RegisterService.invite_new_member")
    @patch("controllers.console.wraps.db")
    @patch("libs.login.check_csrf_token", return_value=None)
    def test_invite_normalizes_emails(self, mock_csrf, mock_db, mock_invite_member, app: Flask):
        mock_invite_member.return_value = "token-abc"

        tenant = SimpleNamespace(id="tenant-1", name="Test Tenant")

        with app.test_request_context(
            "/workspaces/current/members/invite-email",
            method="POST",
            json={"emails": ["User@Example.com"], "role": TenantAccountRole.EDITOR.value, "language": "en-US"},
        ):
            account = Account(name="tester", email="tester@example.com")
            account._current_tenant = tenant
            g._login_user = account
            g._current_tenant = tenant
            response, status_code = MemberInviteEmailApi().post()

        assert status_code == 201
        assert response["invitation_results"][0]["email"] == "user@example.com"

        assert mock_invite_member.call_count == 1
        call_args = mock_invite_member.call_args
        assert call_args.kwargs["tenant_id"] == "tenant-1"
        assert call_args.kwargs["email"] == "user@example.com"
        assert call_args.kwargs["language"] == "en-US"
        assert call_args.kwargs["role"] == TenantAccountRole.EDITOR.value
        assert call_args.kwargs["inviter_id"] == str(account.id)
        mock_csrf.assert_called_once_with(ANY, account.id)

    @patch("controllers.console.workspace.members.RegisterService.invite_new_member")
    @patch("controllers.console.wraps.db")
    @patch("libs.login.check_csrf_token", return_value=None)
    def test_invite_rbac_enabled_accepts_rbac_role_id(
        self,
        mock_csrf,
        mock_db,
        mock_invite_member,
        app,
        config_overrides,
    ):
        """When RBAC is enabled, any non-empty role string should be accepted."""
        config_overrides(RBAC_ENABLED=True)
        mock_invite_member.return_value = "rbac-token"

        tenant = SimpleNamespace(id="tenant-1", name="Test Tenant")

        with app.test_request_context(
            "/workspaces/current/members/invite-email",
            method="POST",
            json={"emails": ["user@example.com"], "role": "rbac-role-id-abc", "language": "en-US"},
        ):
            account = Account(name="tester", email="tester@example.com")
            account._current_tenant = tenant
            g._login_user = account
            g._current_tenant = tenant
            response, status_code = MemberInviteEmailApi().post()

        assert status_code == 201
        mock_invite_member.assert_called_once()
        call_args = mock_invite_member.call_args
        assert call_args.kwargs["role"] == "rbac-role-id-abc"

    @patch("controllers.console.wraps.db")
    @patch("libs.login.check_csrf_token", return_value=None)
    def test_invite_rbac_disabled_rejects_invalid_role(
        self,
        mock_csrf,
        mock_db,
        app,
    ):
        """When RBAC is disabled, an invalid role string should be rejected."""
        tenant = SimpleNamespace(id="tenant-1", name="Test Tenant")

        with app.test_request_context(
            "/workspaces/current/members/invite-email",
            method="POST",
            json={"emails": ["user@example.com"], "role": "invalid-role", "language": "en-US"},
        ):
            account = Account(name="tester", email="tester@example.com")
            account._current_tenant = tenant
            g._login_user = account
            g._current_tenant = tenant
            with pytest.raises(InvalidMemberRoleError) as exc_info:
                MemberInviteEmailApi().post()

        assert exc_info.value.error_code == "invalid_role"
        assert exc_info.value.data == {"code": "invalid_role", "message": "Invalid role.", "status": 400}

    @patch("controllers.console.wraps.db")
    @patch("libs.login.check_csrf_token", return_value=None)
    def test_invite_rbac_disabled_rejects_owner_role(
        self,
        mock_csrf,
        mock_db,
        app,
    ):
        """When RBAC is disabled, owner role should be rejected for invite."""
        tenant = SimpleNamespace(id="tenant-1", name="Test Tenant")

        with app.test_request_context(
            "/workspaces/current/members/invite-email",
            method="POST",
            json={"emails": ["user@example.com"], "role": "owner", "language": "en-US"},
        ):
            account = Account(name="tester", email="tester@example.com")
            account._current_tenant = tenant
            g._login_user = account
            g._current_tenant = tenant
            with pytest.raises(InvalidMemberRoleError) as exc_info:
                MemberInviteEmailApi().post()

        assert exc_info.value.error_code == "invalid_role"
