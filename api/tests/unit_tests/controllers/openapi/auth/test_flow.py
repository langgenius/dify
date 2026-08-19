import inspect

from controllers.openapi.auth.conditions import Cond
from controllers.openapi.auth.data import AuthData, RequestContext
from controllers.openapi.auth.flow import When
from libs.oauth_bearer import TokenType


def _ctx():
    return RequestContext(token_type=TokenType.OAUTH_ACCOUNT, path_params={})


def _data():
    return AuthData(token_type=TokenType.OAUTH_ACCOUNT, token_hash="x", scopes=frozenset())


def test_applies_returns_true_when_condition_true():
    w = When(Cond(lambda ctx, _: True), then=lambda b: None)
    assert w.applies(_ctx()) is True


def test_applies_returns_false_when_condition_false():
    w = When(Cond(lambda ctx, _: False), then=lambda b: None)
    assert w.applies(_ctx()) is False


def test_applies_with_data():
    w = When(Cond(lambda ctx, data: data is not None), then=lambda b: None)
    assert w.applies(_ctx(), _data()) is True
    assert w.applies(_ctx(), None) is False


def test_call_invokes_step():
    calls = []
    w = When(Cond(lambda ctx, _: True), then=lambda arg: calls.append(arg))
    w("payload")
    assert calls == ["payload"]


def test_then_is_keyword_only():
    sig = inspect.signature(When.__init__)
    assert sig.parameters["then"].kind.name == "KEYWORD_ONLY"
