"""Bearer authentication for the AppDeploy file grant endpoints."""

from collections.abc import Callable
from functools import wraps

from flask import request

from extensions.ext_application_services import application_services
from libs.exception import BaseHTTPException
from services.entities.file_grant_entities import FileGrantClaims, FileGrantScope


class FileGrantInvalidError(BaseHTTPException):
    error_code = "grant_invalid"
    description = "The file grant is missing, malformed, or expired."
    code = 401


class FileGrantScopeDeniedError(BaseHTTPException):
    error_code = "grant_scope_denied"
    description = "The file grant does not carry the required scope."
    code = 403


class GrantedFileNotFoundError(BaseHTTPException):
    error_code = "file_not_found"
    description = "File not found."
    code = 404


def file_grant_required[**P, R](scope: FileGrantScope) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Require a valid file grant carrying ``scope`` and inject its claims."""

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        @wraps(view)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            kwargs["grant"] = _authenticated_claims(scope)
            return view(*args, **kwargs)

        return decorated

    return decorator


def _authenticated_claims(scope: FileGrantScope) -> FileGrantClaims:
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise FileGrantInvalidError()

    claims = application_services().file_grants.decode_grant(token)
    if claims is None:
        raise FileGrantInvalidError()

    if scope not in claims.scopes:
        raise FileGrantScopeDeniedError()

    return claims
