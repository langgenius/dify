from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataSoraError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataSoraVideosResult:
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


class AceDataSoraClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataSoraError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_video(
        self,
        *,
        prompt: str,
        model: str,
        duration: int | None = None,
        size: str | None = None,
        orientation: str | None = None,
        image_urls: list[str] | None = None,
        character_url: str | None = None,
        character_start: float | None = None,
        character_end: float | None = None,
        callback_url: str | None = None,
        timeout_s: int = 1800,
    ) -> AceDataSoraVideosResult:
        payload: dict[str, Any] = {"prompt": prompt, "model": model}
        if duration is not None:
            payload["duration"] = duration
        if size:
            payload["size"] = size
        if orientation:
            payload["orientation"] = orientation
        if image_urls:
            payload["image_urls"] = image_urls
        if character_url:
            payload["character_url"] = character_url
        if character_start is not None:
            payload["character_start"] = character_start
        if character_end is not None:
            payload["character_end"] = character_end
        if callback_url:
            payload["callback_url"] = callback_url

        body = self._post(path="/sora/videos", payload=payload, timeout_s=timeout_s)

        if isinstance(body.get("error"), dict):
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSoraError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        if body.get("success") is False:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            raise AceDataSoraError(code="api_error", message=str(body), trace_id=trace_id)

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

        return AceDataSoraVideosResult(
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=data,
        )

    def retrieve_task(self, *, task_id: str, timeout_s: int = 60) -> dict[str, Any]:
        payload: dict[str, Any] = {"id": task_id, "action": "retrieve"}
        return self._post(path="/sora/tasks", payload=payload, timeout_s=timeout_s)

    def retrieve_tasks(self, *, task_ids: list[str], timeout_s: int = 60) -> dict[str, Any]:
        payload: dict[str, Any] = {"ids": task_ids, "action": "retrieve_batch"}
        return self._post(path="/sora/tasks", payload=payload, timeout_s=timeout_s)

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
            raise AceDataSoraError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataSoraError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataSoraError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSoraError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body


def parse_image_urls(value: Any) -> list[str]:
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
                raise ValueError("`image_urls` must be a JSON array or a list of strings.")
            return [str(item).strip() for item in loaded if str(item).strip()]
        return [line.strip() for line in text.splitlines() if line.strip()]

    raise ValueError("`image_urls` must be an array of strings or a string (one URL per line).")


def parse_task_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        ids: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                ids.append(item.strip())
        return ids
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.startswith("["):
            import json

            loaded = json.loads(text)
            if not isinstance(loaded, list):
                raise ValueError("`task_ids` must be a JSON array or a list of strings.")
            return [str(item).strip() for item in loaded if str(item).strip()]
        return [line.strip() for line in text.splitlines() if line.strip()]

    raise ValueError("`task_ids` must be an array of strings or a string (one ID per line).")

