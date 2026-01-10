from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataKlingError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataKlingVideosResult:
    task_id: str | None
    trace_id: str | None
    data: dict[str, Any]

    @property
    def video_url(self) -> str | None:
        value = self.data.get("video_url")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    @property
    def video_id(self) -> str | None:
        value = self.data.get("video_id")
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataKlingClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataKlingError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_video(
        self,
        *,
        action: str,
        model: str | None = None,
        mode: str | None = None,
        prompt: str | None = None,
        start_image_url: str | None = None,
        end_image_url: str | None = None,
        negative_prompt: str | None = None,
        aspect_ratio: str | None = None,
        duration: int | None = None,
        camera_control: str | dict[str, Any] | None = None,
        cfg_scale: float | None = None,
        callback_url: str | None = None,
        video_id: str | None = None,
        mirror: bool | None = None,
        timeout_s: int = 1800,
    ) -> AceDataKlingVideosResult:
        payload: dict[str, Any] = {"action": action}
        if model:
            payload["model"] = model
        if mode:
            payload["mode"] = mode
        if prompt:
            payload["prompt"] = prompt
        if start_image_url:
            payload["start_image_url"] = start_image_url
        if end_image_url:
            payload["end_image_url"] = end_image_url
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        if duration is not None:
            payload["duration"] = duration
        if camera_control is not None:
            payload["camera_control"] = camera_control
        if cfg_scale is not None:
            payload["cfg_scale"] = cfg_scale
        if callback_url:
            payload["callback_url"] = callback_url
        if video_id:
            payload["video_id"] = video_id
        if mirror is not None:
            payload["mirror"] = mirror

        body = self._post_json(path="/kling/videos", payload=payload, timeout_s=timeout_s)
        return AceDataKlingVideosResult(
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=body,
        )

    def _post_json(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": "application/json",
            "content-type": "application/json",
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        except requests.RequestException as e:
            raise AceDataKlingError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataKlingError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataKlingError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataKlingError(
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
            raise AceDataKlingError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body


def parse_camera_control(value: Any) -> str | dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.startswith("{"):
            import json

            loaded = json.loads(text)
            if not isinstance(loaded, dict):
                raise ValueError("`camera_control` must be a JSON object or a plain string.")
            return loaded
        return text
    raise ValueError("`camera_control` must be a JSON object or a string.")
