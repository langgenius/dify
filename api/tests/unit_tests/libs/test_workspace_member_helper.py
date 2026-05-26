"""Unit tests for require_workspace_member."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from libs.oauth_bearer import AuthContext, Scope, SubjectType, require_workspace_member


def _ctx(verified: dict[str, bool] | None = None, *, account: bool = True) -> AuthContext:
    return AuthContext(
        subject_type=SubjectType.ACCOUNT if account else SubjectType.EXTERNAL_SSO,
        subject_email="e@example.com",
        subject_issuer=None,
        account_id=uuid.uuid4() if account else None,
        client_id="difyctl",
        scopes=frozenset({Scope.FULL}),
        token_id=uuid.uuid4(),
        source="oauth_account",
        expires_at=None,
        token_hash="h1",
        verified_tenants=dict(verified or {}),
    )


@patch("libs.oauth_bearer.dify_config")
def test_skips_when_enterprise_enabled(mock_cfg):
    mock_cfg.ENTERPRISE_ENABLED = True
    require_workspace_member(_ctx(), "t1")


@patch("libs.oauth_bearer.dify_config")
def test_skips_for_external_sso(mock_cfg):
    mock_cfg.ENTERPRISE_ENABLED = False
    require_workspace_member(_ctx(account=False), "t1")


@patch("libs.oauth_bearer.db")
@patch("libs.oauth_bearer.dify_config")
def test_uses_cached_ok_no_db_access(mock_cfg, mock_db):
    mock_cfg.ENTERPRISE_ENABLED = False
    require_workspace_member(_ctx({"t1": True}), "t1")
    mock_db.session.execute.assert_not_called()


@patch("libs.oauth_bearer.db")
@patch("libs.oauth_bearer.dify_config")
def test_uses_cached_denied(mock_cfg, mock_db):
    mock_cfg.ENTERPRISE_ENABLED = False
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx({"t1": False}), "t1")
    mock_db.session.execute.assert_not_called()


@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
@patch("libs.oauth_bearer.dify_config")
def test_denies_when_no_membership(mock_cfg, mock_db, mock_record):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.return_value.scalar_one_or_none.return_value = None
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx({}), "t1")
    mock_record.assert_called_once_with("h1", "t1", False)


@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
@patch("libs.oauth_bearer.dify_config")
def test_denies_when_account_inactive(mock_cfg, mock_db, mock_record):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value="join-id")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="banned")),
    ]
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        require_workspace_member(_ctx({}), "t1")
    mock_record.assert_called_once_with("h1", "t1", False)


@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
@patch("libs.oauth_bearer.dify_config")
def test_allows_active_member(mock_cfg, mock_db, mock_record):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value="join-id")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="active")),
    ]
    require_workspace_member(_ctx({}), "t1")
    mock_record.assert_called_once_with("h1", "t1", True)
