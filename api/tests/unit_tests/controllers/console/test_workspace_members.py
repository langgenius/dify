from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import ANY, patch

import pytest
from flask import Flask, g

from controllers.console.workspace.members import MemberInviteEmailApi
from models.account import Account, TenantAccountRole


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    flask_app.login_manager = SimpleNamespace(load_user_from_request_context=lambda: None)
    return flask_app


def _build_feature_flags():
    placeholder_quota = SimpleNamespace(limit=0, size=0)
    workspace_members = SimpleNamespace(enabled=False, is_available=lambda count: True)
    return SimpleNamespace(
        billing=SimpleNamespace(enabled=False),
        workspace_members=workspace_members,
        members=placeholder_quota,
        apps=placeholder_quota,
        vector_space=placeholder_quota,
        documents_upload_quota=placeholder_quota,
        annotation_quota_limit=placeholder_quota,
    )


class TestMemberInviteEmailApi:
    @pytest.fixture(autouse=True)
    def _mock_member_invite_lock(self):
        with patch("controllers.console.workspace.members.redis_client.lock", return_value=nullcontext()):
            yield

    @patch("controllers.console.workspace.members.FeatureService.get_features")
    @patch("controllers.console.workspace.members.RegisterService.invite_new_member")
    @patch("controllers.console.wraps.db")
    @patch("libs.login.check_csrf_token", return_value=None)
    def test_invite_normalizes_emails(self, mock_csrf, mock_db, mock_invite_member, mock_get_features, app: Flask):
        mock_get_features.return_value = _build_feature_flags()
        mock_invite_member.return_value = "token-abc"

        tenant = SimpleNamespace(id="tenant-1", name="Test Tenant")
        inviter = SimpleNamespace(email="Owner@Example.com", current_tenant=tenant, status="active")

        with (
            patch("controllers.console.workspace.members.dify_config.CONSOLE_WEB_URL", "https://console.example.com"),
            patch("controllers.console.workspace.members._count_new_member_invites", return_value=1),
            patch("controllers.console.workspace.members.dify_config.ENTERPRISE_ENABLED", False),
            patch("controllers.console.workspace.members.dify_config.BILLING_ENABLED", False),
        ):
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
        assert call_args.kwargs["tenant"] == tenant
        assert call_args.kwargs["email"] == "user@example.com"
        assert call_args.kwargs["language"] == "en-US"
        assert call_args.kwargs["role"] == TenantAccountRole.EDITOR
        assert call_args.kwargs["inviter"] == account
        mock_csrf.assert_called_once_with(ANY, account.id)
