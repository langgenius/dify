import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from controllers.openapi.auth.data import (
    AuthData,
    Edition,
    ExternalIdentity,
    RequestContext,
    current_edition,
)
from libs.oauth_bearer import Scope, TokenType


def test_current_edition_saas():
    with patch("controllers.openapi.auth.data.dify_config") as cfg:
        cfg.EDITION = "CLOUD"
        cfg.ENTERPRISE_ENABLED = True
        assert current_edition() == Edition.SAAS


def test_current_edition_ee():
    with patch("controllers.openapi.auth.data.dify_config") as cfg:
        cfg.EDITION = "SELF_HOSTED"
        cfg.ENTERPRISE_ENABLED = True
        assert current_edition() == Edition.EE


def test_current_edition_ce():
    with patch("controllers.openapi.auth.data.dify_config") as cfg:
        cfg.EDITION = "SELF_HOSTED"
        cfg.ENTERPRISE_ENABLED = False
        assert current_edition() == Edition.CE


def test_external_identity_frozen():
    ei = ExternalIdentity(email="a@b.com", issuer="idp")
    with pytest.raises(ValidationError):
        ei.email = "other@b.com"  # type: ignore[misc]


def test_external_identity_issuer_optional():
    ei = ExternalIdentity(email="a@b.com")
    assert ei.issuer is None


def test_request_context_frozen():
    ctx = RequestContext(
        token_type=TokenType.OAUTH_ACCOUNT,
        path_params={"app_id": "123"},
    )
    with pytest.raises(ValidationError):
        ctx.token_type = TokenType.OAUTH_EXTERNAL_SSO  # type: ignore[misc]


def test_request_context_scope_optional():
    ctx = RequestContext(token_type=TokenType.OAUTH_ACCOUNT, path_params={})
    assert ctx.scope is None


def test_auth_data_is_mutable():
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="abc",
        scopes=frozenset({Scope.FULL}),
    )
    data.token_type = TokenType.OAUTH_EXTERNAL_SSO
    assert data.token_type == TokenType.OAUTH_EXTERNAL_SSO


def test_auth_data_path_params_defaults_empty():
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="abc",
        scopes=frozenset(),
    )
    assert data.path_params == {}


def test_auth_data_account_id_optional():
    data = AuthData(
        token_type=TokenType.OAUTH_EXTERNAL_SSO,
        token_hash="abc",
        scopes=frozenset({Scope.APPS_RUN}),
        external_identity=ExternalIdentity(email="u@sso.com"),
    )
    assert data.account_id is None


def test_auth_data_external_identity_none_for_account():
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.uuid4(),
        token_hash="abc",
        scopes=frozenset({Scope.FULL}),
    )
    assert data.external_identity is None


def test_auth_data_tenants_default_empty():
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="abc",
        scopes=frozenset(),
    )
    assert data.tenants == {}


def test_auth_data_token_id_optional():
    data = AuthData(
        token_type=TokenType.OAUTH_ACCOUNT,
        token_hash="abc",
        scopes=frozenset(),
    )
    assert data.token_id is None
