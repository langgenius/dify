from unittest.mock import MagicMock, patch

from controllers.openapi.auth.conditions import (
    EDITION_CE,
    EDITION_EE,
    EDITION_SAAS,
    LOADED_APP_IS_PRIVATE,
    PATH_HAS_APP_ID,
    TOKEN_IS_OAUTH_ACCOUNT,
    TOKEN_IS_OAUTH_EXTERNAL_SSO,
    WEBAPP_AUTH_ENABLED,
    Cond,
    config_cond,
    data_cond,
    request_cond,
)
from controllers.openapi.auth.data import AuthData, Edition, RequestContext
from libs.oauth_bearer import TokenType
from services.enterprise.enterprise_service import WebAppAccessMode


def _ctx(token_type=TokenType.OAUTH_ACCOUNT, path_params=None):
    return RequestContext(
        token_type=token_type,
        path_params=path_params or {},
    )


def _data(**kwargs):
    defaults: dict = {"token_type": TokenType.OAUTH_ACCOUNT, "token_hash": "x", "scopes": frozenset()}
    defaults.update(kwargs)
    return AuthData(**defaults)


def test_and_both_true():
    a = Cond(lambda ctx, _: True)
    b = Cond(lambda ctx, _: True)
    assert (a & b)(_ctx()) is True


def test_and_one_false():
    a = Cond(lambda ctx, _: True)
    b = Cond(lambda ctx, _: False)
    assert (a & b)(_ctx()) is False


def test_or_one_true():
    a = Cond(lambda ctx, _: False)
    b = Cond(lambda ctx, _: True)
    assert (a | b)(_ctx()) is True


def test_or_both_false():
    a = Cond(lambda ctx, _: False)
    b = Cond(lambda ctx, _: False)
    assert (a | b)(_ctx()) is False


def test_invert():
    a = Cond(lambda ctx, _: True)
    assert (~a)(_ctx()) is False


def test_chain_and_or():
    always_true = Cond(lambda ctx, _: True)
    always_false = Cond(lambda ctx, _: False)
    assert ((always_true | always_false) & always_true)(_ctx()) is True


def test_request_cond_ignores_data():
    c = request_cond(lambda ctx: ctx.token_type == TokenType.OAUTH_ACCOUNT)
    assert c(_ctx(TokenType.OAUTH_ACCOUNT)) is True
    assert c(_ctx(TokenType.OAUTH_EXTERNAL_SSO)) is False


def test_data_cond_returns_false_when_data_none():
    c = data_cond(lambda data: True)
    assert c(_ctx(), None) is False


def test_data_cond_evaluates_when_data_present():
    c = data_cond(lambda data: data.token_hash == "secret")
    assert c(_ctx(), _data(token_hash="secret")) is True
    assert c(_ctx(), _data(token_hash="other")) is False


def test_config_cond_ignores_ctx_and_data():
    c = config_cond(lambda: True)
    assert c(_ctx()) is True
    c2 = config_cond(lambda: False)
    assert c2(_ctx(), _data()) is False


def test_token_is_oauth_account():
    assert TOKEN_IS_OAUTH_ACCOUNT(_ctx(TokenType.OAUTH_ACCOUNT)) is True
    assert TOKEN_IS_OAUTH_ACCOUNT(_ctx(TokenType.OAUTH_EXTERNAL_SSO)) is False


def test_token_is_oauth_external_sso():
    assert TOKEN_IS_OAUTH_EXTERNAL_SSO(_ctx(TokenType.OAUTH_EXTERNAL_SSO)) is True


def test_path_has_app_id_true():
    assert PATH_HAS_APP_ID(_ctx(path_params={"app_id": "abc"})) is True


def test_path_has_app_id_false():
    assert PATH_HAS_APP_ID(_ctx(path_params={})) is False


def test_edition_ce():
    with patch("controllers.openapi.auth.conditions.current_edition", return_value=Edition.CE):
        assert EDITION_CE(_ctx()) is True
        assert EDITION_EE(_ctx()) is False
        assert EDITION_SAAS(_ctx()) is False


def test_edition_ee():
    with patch("controllers.openapi.auth.conditions.current_edition", return_value=Edition.EE):
        assert EDITION_EE(_ctx()) is True
        assert EDITION_CE(_ctx()) is False


def test_edition_saas():
    with patch("controllers.openapi.auth.conditions.current_edition", return_value=Edition.SAAS):
        assert EDITION_SAAS(_ctx()) is True


def test_webapp_auth_enabled():
    mock_features = MagicMock()
    mock_features.webapp_auth.enabled = True
    with patch("controllers.openapi.auth.conditions.FeatureService.get_system_features", return_value=mock_features):
        assert WEBAPP_AUTH_ENABLED(_ctx()) is True


def test_loaded_app_is_private():
    data_private = _data(app_access_mode=WebAppAccessMode.PRIVATE)
    data_public = _data(app_access_mode=WebAppAccessMode.PUBLIC)
    data_none = _data(app_access_mode=None)
    assert LOADED_APP_IS_PRIVATE(_ctx(), data_private) is True
    assert LOADED_APP_IS_PRIVATE(_ctx(), data_public) is False
    assert LOADED_APP_IS_PRIVATE(_ctx(), data_none) is False
    assert LOADED_APP_IS_PRIVATE(_ctx(), None) is False
