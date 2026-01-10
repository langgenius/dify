from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataHailuoError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataHailuoVideosResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: list[dict[str, Any]]

    @property
    def video_urls(self) -> list[str]:
        urls: list[str] = []
        for item in self.data:
            video_url = item.get("video_url")
            if isinstance(video_url, str) and video_url.strip():
                urls.append(video_url.strip())
        return urls


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataHailuoClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataHailuoError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_video(
        self,
        *,
        action: str,
        prompt: str | None = None,
        model: str | None = None,
        first_image_url: str | None = None,
        callback_url: str | None = None,
        mirror: bool | None = None,
        timeout_s: int = 1800,
    ) -> AceDataHailuoVideosResult:
        payload: dict[str, Any] = {"action": action}
        if prompt:
            payload["prompt"] = prompt
        if model:
            payload["model"] = model
        if first_image_url:
            payload["first_image_url"] = first_image_url
        if callback_url:
            payload["callback_url"] = callback_url
        if mirror is not None:
            payload["mirror"] = mirror

        body = self._post(path="/hailuo/videos", payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataHailuoError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        raw_data: Any = body.get("data")
        if isinstance(raw_data, list):
            data = [item for item in raw_data if isinstance(item, dict)]
        elif isinstance(raw_data, dict):
            items = raw_data.get("items")
            if isinstance(items, list):
                data = [item for item in items if isinstance(item, dict)]
            else:
                data = [raw_data]
        else:
            data = []

        return AceDataHailuoVideosResult(
            action=str(body.get("action") or payload.get("action") or ""),
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=data,
        )

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
            raise AceDataHailuoError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataHailuoError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataHailuoError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataHailuoError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        if "success" in body and body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataHailuoError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body
