from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any, Literal
from urllib.parse import quote, quote_plus

import requests

type ResponseData = Mapping[str, Any] | list[Any] | str
type AuthMode = Literal["primary", "bearer", "query"]


class MrscraperAPIError(RuntimeError):
    """A safe, user-facing MrScraper transport or HTTP error."""


def sanitize_error(value: str, token: str) -> str:
    sanitized = value
    secrets = {token, quote(token, safe=""), quote_plus(token)}
    for secret in sorted((item for item in secrets if item), key=len, reverse=True):
        sanitized = sanitized.replace(secret, "[REDACTED]")
    sanitized = re.sub(r"(?i)(token=)[^&\s]+", r"\1[REDACTED]", sanitized)
    sanitized = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s,;]+", r"\1[REDACTED]", sanitized)
    sanitized = re.sub(
        r"(?i)(x-api-token[\"']?\s*[:=]\s*[\"']?)[^\s,;\"']+",
        r"\1[REDACTED]",
        sanitized,
    )
    return sanitized


class MrscraperClient:
    PRIMARY_ORIGIN = "https://api.app.mrscraper.com"
    SERP_ORIGIN = "https://sync.scraper.mrscraper.com"
    RENDERED_ORIGIN = "https://api.mrscraper.com"
    ALLOWED_ORIGINS = frozenset({PRIMARY_ORIGIN, SERP_ORIGIN, RENDERED_ORIGIN})
    DEFAULT_TIMEOUT = (10.0, 620.0)
    ERROR_BODY_LIMIT = 1_000

    def __init__(self, token: str, session: requests.Session | None = None) -> None:
        if not isinstance(token, str) or not token.strip():
            raise MrscraperAPIError("MrScraper API token is missing.")
        self._token = token.strip()
        self._session = session or requests.Session()

    def request(
        self,
        method: str,
        *,
        origin: str,
        path: str,
        auth: AuthMode,
        params: Mapping[str, Any] | None = None,
        json_body: Mapping[str, Any] | None = None,
        force_text: bool = False,
        read_timeout: float | None = None,
    ) -> ResponseData:
        if origin not in self.ALLOWED_ORIGINS:
            raise MrscraperAPIError("MrScraper request origin is not allowed.")
        if not path.startswith("/") or path.startswith("//"):
            raise MrscraperAPIError("MrScraper request path is invalid.")

        url = f"{origin}{path}"
        headers = {"Accept": "application/json"}
        request_params = {key: value for key, value in (params or {}).items() if value is not None}
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        if auth == "primary":
            headers["x-api-token"] = self._token
        elif auth == "bearer":
            headers["Authorization"] = f"Bearer {self._token}"
        elif auth == "query":
            request_params["token"] = self._token
        else:  # pragma: no cover - Literal protects plugin callers
            raise MrscraperAPIError("MrScraper authentication mode is invalid.")

        timeout = (
            self.DEFAULT_TIMEOUT
            if read_timeout is None
            else (self.DEFAULT_TIMEOUT[0], read_timeout)
        )
        try:
            response = self._session.request(
                method=method,
                url=url,
                headers=headers,
                params=request_params or None,
                json=json_body,
                timeout=timeout,
            )
        except requests.RequestException as exc:
            message = sanitize_error(str(exc), self._token)
            raise MrscraperAPIError(f"MrScraper request failed: {message}") from None

        if not 200 <= response.status_code < 300:
            body = sanitize_error(response.text[: self.ERROR_BODY_LIMIT], self._token)
            suffix = f": {body}" if body else ""
            raise MrscraperAPIError(f"MrScraper returned HTTP {response.status_code}{suffix}")

        if force_text:
            return response.text

        try:
            parsed = response.json()
        except (requests.JSONDecodeError, json.JSONDecodeError, ValueError):
            return response.text

        if isinstance(parsed, Mapping | list):
            return parsed
        return {"data": parsed}
