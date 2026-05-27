from controllers.openapi.auth.context import Context


def test_context_starts_unpopulated():
    ctx = Context(required_scope="apps:run")
    assert ctx.bearer_token is None
    assert ctx.path_params == {}
    assert ctx.subject_type is None
    assert ctx.subject_email is None
    assert ctx.account_id is None
    assert ctx.scopes == frozenset()
    assert ctx.app is None
    assert ctx.tenant is None
    assert ctx.caller is None
    assert ctx.caller_kind is None


def test_context_fields_are_mutable():
    ctx = Context(required_scope="apps:run")
    ctx.scopes = frozenset({"full"})
    assert "full" in ctx.scopes
