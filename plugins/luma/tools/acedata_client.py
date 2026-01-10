from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataLumaError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataLumaClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataLumaError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_video(
        self,
        *,
        action: str,
        prompt: str | None = None,
        aspect_ratio: str | None = None,
        start_image_url: str | None = None,
        end_image_url: str | None = None,
        video_url: str | None = None,
        video_id: str | None = None,
        enhancement: bool | None = None,
        loop: bool | None = None,
        timeout: int | float | None = None,
        callback_url: str | None = None,
        timeout_s: int = 1800,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"action": action}
        if prompt:
            payload["prompt"] = prompt
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        if start_image_url:
            payload["start_image_url"] = start_image_url
        if end_image_url:
            payload["end_image_url"] = end_image_url
        if video_url:
            payload["video_url"] = video_url
        if video_id:
            payload["video_id"] = video_id
        if enhancement is not None:
            payload["enhancement"] = enhancement
        if loop is not None:
            payload["loop"] = loop
        if timeout is not None:
            payload["timeout"] = timeout
        if callback_url:
            payload["callback_url"] = callback_url

        return self._post(path="/luma/videos", payload=payload, timeout_s=timeout_s)

    def _post(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": "application/json",
            "content-type": "application/json",
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        except requests.RequestException as e:
            raise AceDataLumaError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataLumaError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataLumaError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataLumaError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataLumaError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body
