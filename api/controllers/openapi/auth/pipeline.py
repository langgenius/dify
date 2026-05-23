"""Pipeline IS the auth scheme.

`Pipeline.guard(scope=…)` is the only attachment point for endpoints —
that is the design lock-in: forgetting an auth layer is structurally
impossible because there is no "sometimes wrap, sometimes don't" choice.
"""

from __future__ import annotations

from functools import wraps

from flask import request

from controllers.openapi.auth.context import Context, Step
from libs.oauth_bearer import Scope, extract_bearer, reset_auth_ctx


class Pipeline:
    def __init__(self, *steps: Step) -> None:
        self._steps = steps

    def run(self, ctx: Context) -> None:
        for step in self._steps:
            step(ctx)

    def guard(self, *, scope: Scope):
        def decorator(view):
            @wraps(view)
            def decorated(*args, **kwargs):
                # Extract transport-level inputs at the boundary so steps
                # stay decoupled from Flask's request object.
                ctx = Context(
                    required_scope=scope,
                    bearer_token=extract_bearer(request),
                    path_params=dict(request.view_args or {}),
                )
                try:
                    self.run(ctx)
                    kwargs.update(
                        app_model=ctx.app,
                        caller=ctx.caller,
                        caller_kind=ctx.caller_kind,
                    )
                    return view(*args, **kwargs)
                finally:
                    if ctx.auth_ctx_reset_token is not None:
                        reset_auth_ctx(ctx.auth_ctx_reset_token)

            return decorated

        return decorator
