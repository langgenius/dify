from __future__ import annotations

from collections.abc import Callable
from typing import Any

from controllers.openapi.auth.conditions import Cond
from controllers.openapi.auth.data import AuthData, RequestContext


class When:
    def __init__(self, condition: Cond, *, then: Callable[[Any], None]) -> None:
        self.condition = condition
        self._step = then

    def applies(self, ctx: RequestContext, data: AuthData | None = None) -> bool:
        return self.condition(ctx, data)

    def __call__(self, arg: Any) -> None:
        self._step(arg)
