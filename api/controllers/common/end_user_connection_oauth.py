"""Complete a Web-initiated grant at the existing registered plugin callback."""

from flask import redirect, request
from werkzeug import Response

from configs import dify_config
from controllers.common.end_user_connections import raise_connection_error
from extensions.ext_application_services import application_services
from services.end_user_connections.errors import ConnectionError


def redirect_end_user_connection_oauth(provider: str) -> Response | None:
    states = request.args.getlist("state")
    if len(states) != 1:
        return None
    try:
        callback_url = application_services().end_user_connection_oauth.callback_url(states[0], provider)
    except ConnectionError as error:
        raise_connection_error(error)
    if callback_url is None:
        return None
    # The Web and Console API may have different hosts. Return to the initiating
    # API's cookie before consuming state or exchanging the authorization code.
    response = redirect(callback_url + "?" + request.query_string.decode("ascii"))
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def complete_end_user_connection_oauth(provider: str, context_id: str) -> Response:
    try:
        service = application_services().end_user_connection_oauth
        attempt = service.consume_attempt(context_id, provider=provider)
        connection = service.complete_oauth(attempt, query_string=request.query_string)
    except ConnectionError as error:
        raise_connection_error(error)
    response = redirect(f"{dify_config.APP_WEB_URL}/oauth-callback?connection_id={connection.id}")
    response.delete_cookie("context_id", httponly=True, samesite="Lax", secure=request.is_secure)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
