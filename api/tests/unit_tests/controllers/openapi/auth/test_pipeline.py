import pytest
from flask import Flask

from controllers.openapi.auth.context import Context
from controllers.openapi.auth.pipeline import Pipeline


def test_run_invokes_each_step_in_order():
    calls = []

    class S:
        def __init__(self, tag):
            self.tag = tag

        def __call__(self, ctx):
            calls.append(self.tag)

    Pipeline(S("a"), S("b"), S("c")).run(Context(required_scope="x"))
    assert calls == ["a", "b", "c"]


def test_run_short_circuits_on_raise():
    calls = []

    class Boom:
        def __call__(self, ctx):
            raise RuntimeError("boom")

    class Tail:
        def __call__(self, ctx):
            calls.append("ran")

    with pytest.raises(RuntimeError):
        Pipeline(Boom(), Tail()).run(Context(required_scope="x"))
    assert calls == []


def test_guard_decorator_runs_pipeline_and_unpacks_handler_kwargs():
    seen = {}

    class FakeStep:
        def __call__(self, ctx):
            ctx.app = "APP"
            ctx.caller = "CALLER"
            ctx.caller_kind = "account"

    pipeline = Pipeline(FakeStep())

    @pipeline.guard(scope="apps:run")
    def handler(app_model, caller, caller_kind):
        seen["app_model"] = app_model
        seen["caller"] = caller
        seen["caller_kind"] = caller_kind
        return "ok"

    app = Flask(__name__)
    with app.test_request_context("/x", method="POST"):
        assert handler() == "ok"
    assert seen == {"app_model": "APP", "caller": "CALLER", "caller_kind": "account"}
