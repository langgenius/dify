"""Unit tests for WorkspaceMembershipCheck (Layer 0)."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.steps import WorkspaceMembershipCheck
from libs.oauth_bearer import SubjectType


def _ctx(*, subject_type, account_id, tenant_id, cached_verified_tenants=None, token_hash=None) -> Context:
    c = Context(required_scope="apps:read")
    c.subject_type = subject_type
    c.account_id = account_id
    c.tenant = SimpleNamespace(id=tenant_id) if tenant_id else None
    c.cached_verified_tenants = cached_verified_tenants
    c.token_hash = token_hash
    return c


@pytest.fixture
def step():
    return WorkspaceMembershipCheck()


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_skips_when_enterprise_enabled(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = True
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        cached_verified_tenants={},
        token_hash="hash-1",
    )
    step(ctx)  # no raise
    mock_db.session.execute.assert_not_called()
    mock_record.assert_not_called()


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_skips_for_external_sso(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    ctx = _ctx(
        subject_type=SubjectType.EXTERNAL_SSO,
        account_id=None,
        tenant_id=str(uuid.uuid4()),
        cached_verified_tenants={},
        token_hash="hash-1",
    )
    step(ctx)  # no raise
    mock_db.session.execute.assert_not_called()
    mock_record.assert_not_called()


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_uses_cached_ok(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id="a1",
        tenant_id="t1",
        cached_verified_tenants={"t1": True},
        token_hash="hash-1",
    )
    step(ctx)
    mock_db.session.execute.assert_not_called()
    mock_record.assert_not_called()


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_uses_cached_denied(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id="a1",
        tenant_id="t1",
        cached_verified_tenants={"t1": False},
        token_hash="hash-1",
    )
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        step(ctx)
    mock_db.session.execute.assert_not_called()
    mock_record.assert_not_called()


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_denies_when_no_membership(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.return_value.scalar_one_or_none.return_value = None
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id="a1",
        tenant_id="t1",
        cached_verified_tenants={},
        token_hash="hash-1",
    )
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        step(ctx)
    mock_record.assert_called_once_with("hash-1", "t1", False)


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_denies_when_account_inactive(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value="join-id")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="banned")),
    ]
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id="a1",
        tenant_id="t1",
        cached_verified_tenants={},
        token_hash="hash-1",
    )
    with pytest.raises(Forbidden, match="workspace_membership_revoked"):
        step(ctx)
    mock_record.assert_called_once_with("hash-1", "t1", False)


@patch("controllers.openapi.auth.steps.dify_config")
@patch("libs.oauth_bearer.record_layer0_verdict")
@patch("libs.oauth_bearer.db")
def test_allows_active_member(mock_db, mock_record, mock_cfg, step):
    mock_cfg.ENTERPRISE_ENABLED = False
    mock_db.session.execute.side_effect = [
        MagicMock(scalar_one_or_none=MagicMock(return_value="join-id")),
        MagicMock(scalar_one_or_none=MagicMock(return_value="active")),
    ]
    ctx = _ctx(
        subject_type=SubjectType.ACCOUNT,
        account_id="a1",
        tenant_id="t1",
        cached_verified_tenants={},
        token_hash="hash-1",
    )
    step(ctx)  # no raise
    mock_record.assert_called_once_with("hash-1", "t1", True)
