"""WebApp passport admission for handlers consuming stable identity values."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request
from werkzeug.exceptions import Unauthorized

from controllers.web.wraps import decode_jwt_token
from core.logging.context import get_request_id, get_trace_id, set_identity_context
from machinery.context import WebAppRequestContext


def web_app_admission[T, **P, R](
    view: Callable[Concatenate[T, WebAppRequestContext, str, P], R],
) -> Callable[Concatenate[T, P], R]:
    """Authenticate the passport and inject its app scope without exposing ORM objects.

    The shared request admission in app_factory enforces the deployment License
    before resource dispatch. WebApp passports do not require a Console account's
    initialization, and these endpoints are available in every deployment edition.
    """

    @wraps(view)
    def admitted(self: T, /, *args: P.args, **kwargs: P.kwargs) -> R:
        app, end_user = decode_jwt_token()
        if end_user.tenant_id != app.tenant_id or end_user.app_id != app.id:
            raise Unauthorized("Authentication has expired.")
        set_identity_context(
            tenant_id=app.tenant_id,
            user_id=end_user.id,
            user_type=end_user.type or "end_user",
        )
        context = WebAppRequestContext(
            request_id=get_request_id(),
            trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
            tenant_id=app.tenant_id,
            app_id=app.id,
            end_user_id=end_user.id,
        )
        return view(self, context, app.mode, *args, **kwargs)

    return admitted
