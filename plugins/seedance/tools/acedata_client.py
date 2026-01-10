from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataSeedanceError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataSeedanceVideosResult:
    task_id: str | None
    trace_id: str | None
    data: list[dict[str, Any]]

    @property
    def video_urls(self) -> list[str]:
        urls: list[str] = []
        for item in self.data:
            if not isinstance(item, dict):
                continue
            video_url = item.get("video_url")
            if isinstance(video_url, str) and video_url.strip():
                urls.append(video_url.strip())
                continue
            content = item.get("content")
            if isinstance(content, dict):
                nested = content.get("video_url")
                if isinstance(nested, str) and nested.strip():
                    urls.append(nested.strip())
        return urls


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataSeedanceClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataSeedanceError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_video(
        self,
        *,
        model: str | None = None,
        prompt: str | None = None,
        first_frame_url: str | None = None,
        last_frame_url: str | None = None,
        reference_image_urls: list[str] | None = None,
        callback_url: str | None = None,
        return_last_frame: bool | None = None,
        service_tier: str | None = None,
        execution_expires_after: int | None = None,
        timeout_s: int = 1800,
    ) -> AceDataSeedanceVideosResult:
        if not prompt or not prompt.strip():
            raise ValueError("`prompt` is required.")

        content = build_content(
            prompt=prompt,
            first_frame_url=first_frame_url,
            last_frame_url=last_frame_url,
            reference_image_urls=reference_image_urls,
        )

        payload: dict[str, Any] = {"content": content}
        if model:
            payload["model"] = model
        if callback_url:
            payload["callback_url"] = callback_url
        if return_last_frame is not None:
            payload["return_last_frame"] = return_last_frame
        if service_tier:
            payload["service_tier"] = service_tier
        if execution_expires_after is not None:
            payload["execution_expires_after"] = execution_expires_after

        body = self._post(path="/seedance/videos", payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSeedanceError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        raw_data: Any = body.get("data")
        if isinstance(raw_data, list):
            data = [item for item in raw_data if isinstance(item, dict)]
        elif isinstance(raw_data, dict):
            data = [raw_data]
        else:
            data = []

        return AceDataSeedanceVideosResult(
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=data,
        )

    def retrieve_task(self, *, task_id: str, timeout_s: int = 60) -> dict[str, Any]:
        raise NotImplementedError("Seedance Tasks API is not integrated in this plugin.")

    def retrieve_tasks(self, *, task_ids: list[str], timeout_s: int = 60) -> dict[str, Any]:
        raise NotImplementedError("Seedance Tasks API is not integrated in this plugin.")

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
            raise AceDataSeedanceError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataSeedanceError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataSeedanceError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSeedanceError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body


def parse_image_urls(value: Any, *, field_name: str = "image_urls") -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        urls: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                urls.append(item.strip())
        return urls
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            import json

            loaded = json.loads(text)
            if not isinstance(loaded, list):
                raise ValueError(f"`{field_name}` must be a JSON array or a list of strings.")
            return [str(item).strip() for item in loaded if str(item).strip()]
        return [line.strip() for line in text.splitlines() if line.strip()]

    raise ValueError(f"`{field_name}` must be an array of strings or a string (one URL per line).")


def parse_task_ids(value: Any) -> list[str]:
    raise NotImplementedError("Seedance Tasks API is not integrated in this plugin.")


def build_content(
    *,
    prompt: str,
    first_frame_url: str | None = None,
    last_frame_url: str | None = None,
    reference_image_urls: list[str] | None = None,
) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt.strip()}]

    normalized_first = first_frame_url.strip() if isinstance(first_frame_url, str) and first_frame_url.strip() else None
    normalized_last = last_frame_url.strip() if isinstance(last_frame_url, str) and last_frame_url.strip() else None

    if normalized_first:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": normalized_first},
                "role": "first_frame",
            }
        )
    if normalized_last:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": normalized_last},
                "role": "last_frame",
            }
        )

    if reference_image_urls:
        for url in reference_image_urls:
            if isinstance(url, str) and url.strip():
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": url.strip()},
                        "role": "reference_image",
                    }
                )

    return content
