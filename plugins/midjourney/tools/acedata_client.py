from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import requests


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


def _parse_optional_bool(value: Any, *, name: str) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
    raise ValueError(f"`{name}` must be a boolean.")


@dataclass(frozen=True)
class AceDataMidjourneyError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


AceDataAccept = Literal["application/json", "application/x-ndjson"]


class AceDataMidjourneyClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataMidjourneyError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def imagine(
        self,
        *,
        payload: dict[str, Any],
        timeout_s: int = 1800,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        return self._post(path="/midjourney/imagine", payload=payload, timeout_s=timeout_s, accept=accept)

    def edits(
        self,
        *,
        payload: dict[str, Any],
        timeout_s: int = 1800,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        return self._post(path="/midjourney/edits", payload=payload, timeout_s=timeout_s, accept=accept)

    def videos(
        self,
        *,
        payload: dict[str, Any],
        timeout_s: int = 1800,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        return self._post(path="/midjourney/videos", payload=payload, timeout_s=timeout_s, accept=accept)

    def describe(
        self,
        *,
        payload: dict[str, Any],
        timeout_s: int = 300,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        return self._post(path="/midjourney/describe", payload=payload, timeout_s=timeout_s, accept=accept)

    def translate(
        self,
        *,
        payload: dict[str, Any],
        timeout_s: int = 300,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        return self._post(path="/midjourney/translate", payload=payload, timeout_s=timeout_s, accept=accept)

    def _post(
        self,
        *,
        path: str,
        payload: dict[str, Any],
        timeout_s: int,
        accept: AceDataAccept = "application/json",
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": accept,
            "content-type": "application/json",
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        except requests.RequestException as e:
            raise AceDataMidjourneyError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataMidjourneyError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataMidjourneyError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataMidjourneyError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        if body.get("success") is False:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataMidjourneyError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body


def build_midjourney_imagine_payload(tool_parameters: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    prompt = tool_parameters.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        payload["prompt"] = prompt.strip()

    action = tool_parameters.get("action")
    if isinstance(action, str) and action.strip():
        payload["action"] = action.strip()

    image_id = tool_parameters.get("image_id")
    if isinstance(image_id, str) and image_id.strip():
        payload["image_id"] = image_id.strip()

    mode = tool_parameters.get("mode")
    if isinstance(mode, str) and mode.strip():
        payload["mode"] = mode.strip()

    timeout = tool_parameters.get("timeout")
    if timeout is not None:
        if isinstance(timeout, (int, float)):
            payload["timeout"] = int(timeout)
        elif isinstance(timeout, str) and timeout.strip().isdigit():
            payload["timeout"] = int(timeout.strip())
        else:
            raise ValueError("`timeout` must be an integer (seconds).")

    translation = _parse_optional_bool(tool_parameters.get("translation"), name="translation")
    if translation is not None:
        payload["translation"] = translation

    split_images = _parse_optional_bool(tool_parameters.get("split_images"), name="split_images")
    if split_images is not None:
        payload["split_images"] = split_images

    callback_url = tool_parameters.get("callback_url")
    if isinstance(callback_url, str) and callback_url.strip():
        payload["callback_url"] = callback_url.strip()

    application_id = tool_parameters.get("application_id")
    if isinstance(application_id, str) and application_id.strip():
        payload["application_id"] = application_id.strip()

    return payload


def build_midjourney_edits_payload(tool_parameters: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    prompt = tool_parameters.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        payload["prompt"] = prompt.strip()

    action = tool_parameters.get("action")
    if isinstance(action, str) and action.strip():
        payload["action"] = action.strip()

    image_url = tool_parameters.get("image_url")
    if isinstance(image_url, str) and image_url.strip():
        payload["image_url"] = image_url.strip()

    mask = tool_parameters.get("mask")
    if isinstance(mask, str) and mask.strip():
        payload["mask"] = mask.strip()

    mode = tool_parameters.get("mode")
    if isinstance(mode, str) and mode.strip():
        payload["mode"] = mode.strip()

    split_images = _parse_optional_bool(tool_parameters.get("split_images"), name="split_images")
    if split_images is not None:
        payload["split_images"] = split_images

    callback_url = tool_parameters.get("callback_url")
    if isinstance(callback_url, str) and callback_url.strip():
        payload["callback_url"] = callback_url.strip()

    application_id = tool_parameters.get("application_id")
    if isinstance(application_id, str) and application_id.strip():
        payload["application_id"] = application_id.strip()

    return payload


def build_midjourney_videos_payload(tool_parameters: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    action = tool_parameters.get("action")
    if isinstance(action, str) and action.strip():
        payload["action"] = action.strip()

    prompt = tool_parameters.get("prompt")
    if isinstance(prompt, str) and prompt.strip():
        payload["prompt"] = prompt.strip()

    image_url = tool_parameters.get("image_url")
    if isinstance(image_url, str) and image_url.strip():
        payload["image_url"] = image_url.strip()

    end_image_url = tool_parameters.get("end_image_url")
    if isinstance(end_image_url, str) and end_image_url.strip():
        payload["end_image_url"] = end_image_url.strip()

    video_id = tool_parameters.get("video_id")
    if isinstance(video_id, str) and video_id.strip():
        payload["video_id"] = video_id.strip()

    video_index = tool_parameters.get("video_index")
    if video_index is not None:
        if isinstance(video_index, (int, float)):
            payload["video_index"] = int(video_index)
        elif isinstance(video_index, str) and video_index.strip().isdigit():
            payload["video_index"] = int(video_index.strip())
        else:
            raise ValueError("`video_index` must be an integer.")

    mode = tool_parameters.get("mode")
    if isinstance(mode, str) and mode.strip():
        payload["mode"] = mode.strip()

    resolution = tool_parameters.get("resolution")
    if isinstance(resolution, str) and resolution.strip():
        payload["resolution"] = resolution.strip()

    loop = _parse_optional_bool(tool_parameters.get("loop"), name="loop")
    if loop is not None:
        payload["loop"] = loop

    callback_url = tool_parameters.get("callback_url")
    if isinstance(callback_url, str) and callback_url.strip():
        payload["callback_url"] = callback_url.strip()

    application_id = tool_parameters.get("application_id")
    if isinstance(application_id, str) and application_id.strip():
        payload["application_id"] = application_id.strip()

    return payload
