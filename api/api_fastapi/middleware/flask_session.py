"""Session middleware that preserves Flask cookie compatibility for API v2."""

from __future__ import annotations

from http.cookies import SimpleCookie
from typing import Any

from flask import Flask
from flask.sessions import SecureCookieSessionInterface
from itsdangerous import BadSignature, URLSafeTimedSerializer
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from werkzeug.http import dump_cookie


class FlaskCompatibleSessionMiddleware:
    """Expose ``request.session`` with Flask's signed cookie format.

    FastAPI and the legacy Flask runtime must share first-time setup state
    during the migration window. Starlette's session middleware uses a
    different serializer, so this middleware delegates signing to Flask's
    ``SecureCookieSessionInterface`` and writes the same ``session`` cookie
    format Flask understands.
    """

    def __init__(self, app: ASGIApp, *, flask_app: Flask) -> None:
        self.app: ASGIApp = app
        self.flask_app: Flask = flask_app
        self.session_interface: SecureCookieSessionInterface = SecureCookieSessionInterface()
        serializer = self.session_interface.get_signing_serializer(flask_app)
        if serializer is None:
            raise RuntimeError("Flask session serializer is unavailable; SECRET_KEY must be configured.")
        self.serializer: URLSafeTimedSerializer = serializer

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        initial_session = self._load_session(scope)
        session: dict[str, Any] = dict(initial_session)
        scope["session"] = session

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                self._save_session(headers, session, initial_session)
            await send(message)

        await self.app(scope, receive, send_wrapper)

    def _load_session(self, scope: Scope) -> dict[str, Any]:
        cookie_value = self._session_cookie(scope)
        if not cookie_value:
            return {}

        max_age = int(self.flask_app.permanent_session_lifetime.total_seconds())
        try:
            data = self.serializer.loads(cookie_value, max_age=max_age)
        except BadSignature:
            return {}
        return dict(data) if isinstance(data, dict) else {}

    def _session_cookie(self, scope: Scope) -> str | None:
        headers = dict(scope.get("headers") or [])
        raw_cookie = headers.get(b"cookie")
        if raw_cookie is None:
            return None

        parsed = SimpleCookie()
        parsed.load(raw_cookie.decode("latin1"))  # latin1: load as-is
        cookie_name = self.session_interface.get_cookie_name(self.flask_app)
        morsel = parsed.get(cookie_name)
        return morsel.value if morsel else None

    def _save_session(
        self,
        headers: MutableHeaders,
        session: dict[str, Any],
        initial_session: dict[str, Any],
    ) -> None:
        if session == initial_session:
            return

        cookie_name = self.session_interface.get_cookie_name(self.flask_app)
        cookie_path = self.session_interface.get_cookie_path(self.flask_app)
        cookie_domain = self.session_interface.get_cookie_domain(self.flask_app)
        cookie_secure = self.session_interface.get_cookie_secure(self.flask_app)
        cookie_httponly = self.session_interface.get_cookie_httponly(self.flask_app)
        cookie_samesite = self.session_interface.get_cookie_samesite(self.flask_app)

        if not session:
            headers.append(
                "set-cookie",
                dump_cookie(
                    cookie_name,
                    "",
                    expires=0,
                    max_age=0,
                    path=cookie_path,
                    domain=cookie_domain,
                    secure=cookie_secure,
                    httponly=cookie_httponly,
                    samesite=cookie_samesite,
                ),
            )
            return

        headers.append(
            "set-cookie",
            dump_cookie(
                cookie_name,
                self.serializer.dumps(dict(session)),
                path=cookie_path,
                domain=cookie_domain,
                secure=cookie_secure,
                httponly=cookie_httponly,
                samesite=cookie_samesite,
            ),
        )
