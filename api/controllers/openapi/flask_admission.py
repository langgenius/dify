"""Flask admission adapters for public OpenAPI device-flow endpoints."""

from collections.abc import Callable
from functools import wraps
from typing import Concatenate

from flask import request
from werkzeug.exceptions import NotFound

from core.logging.context import get_request_id, get_trace_id
from extensions.ext_application_services import application_services
from services.oauth_device_contracts import DeviceRequestContext


def oauth_device_sso_admission[**P, R](
    view: Callable[Concatenate[DeviceRequestContext, P], R],
) -> Callable[P, R]:
    """Require an active Enterprise license and inject stable request metadata."""

    @wraps(view)
    def admitted(*args: P.args, **kwargs: P.kwargs) -> R:
        if not application_services().feature_queries.has_valid_enterprise_license():
            raise NotFound()
        context = DeviceRequestContext(
            request_id=get_request_id(),
            trace_id=get_trace_id() or request.headers.get("X-Trace-Id"),
        )
        return view(context, *args, **kwargs)

    return admitted
