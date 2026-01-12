import hashlib
import hmac
import time
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import abort, request

from core.session.cli_api import CliApiSessionManager

P = ParamSpec("P")
R = TypeVar("R")

SIGNATURE_TTL_SECONDS = 300


def _verify_signature(session_secret: str, timestamp: str, body: bytes, signature: str) -> bool:
    expected = hmac.new(
        session_secret.encode(),
        f"{timestamp}.".encode() + body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)


def cli_api_only(view: Callable[P, R]):
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        session_id = request.headers.get("X-Cli-Api-Session-Id")
        timestamp = request.headers.get("X-Cli-Api-Timestamp")
        signature = request.headers.get("X-Cli-Api-Signature")

        if not session_id or not timestamp or not signature:
            abort(401)

        try:
            ts = int(timestamp)
            if abs(time.time() - ts) > SIGNATURE_TTL_SECONDS:
                abort(401)
        except ValueError:
            abort(401)

        session = CliApiSessionManager().get(session_id)
        if not session:
            abort(401)

        body = request.get_data()
        if not _verify_signature(session.secret, timestamp, body, signature):
            abort(401)

        return view(*args, **kwargs)

    return decorated
