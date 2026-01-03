from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


class AceDataNanoBananaError(RuntimeError):
    pass


@dataclass(frozen=True)
class AceDataNanoBananaApiError(AceDataNanoBananaError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None


@dataclass(frozen=True)
class AceDataNanoBananaResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: list[dict[str, Any]]

    @property
    def image_urls(self) -> list[str]:
        urls: list[str] = []
        for item in self.data:
            image_url = item.get("image_url")
            if isinstance(image_url, str) and image_url.strip():
                urls.append(image_url.strip())
        return urls


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataNanoBananaClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataNanoBananaError("Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate(
        self,
        *,
        prompt: str,
        model: str | None = None,
        aspect_ratio: str | None = None,
        resolution: str | None = None,
        callback_url: str | None = None,
        timeout_s: int = 120,
    ) -> AceDataNanoBananaResult:
        payload: dict[str, Any] = {"action": "generate", "prompt": prompt}
        if model:
            payload["model"] = model
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        if resolution:
            payload["resolution"] = resolution
        if callback_url:
            payload["callback_url"] = callback_url
        return self._post_images(payload=payload, timeout_s=timeout_s)

    def edit(
        self,
        *,
        prompt: str,
        image_urls: list[str],
        model: str | None = None,
        aspect_ratio: str | None = None,
        resolution: str | None = None,
        callback_url: str | None = None,
        timeout_s: int = 120,
    ) -> AceDataNanoBananaResult:
        payload: dict[str, Any] = {"action": "edit", "prompt": prompt, "image_urls": image_urls}
        if model:
            payload["model"] = model
        if aspect_ratio:
            payload["aspect_ratio"] = aspect_ratio
        if resolution:
            payload["resolution"] = resolution
        if callback_url:
            payload["callback_url"] = callback_url
        return self._post_images(payload=payload, timeout_s=timeout_s)

    def _post_images(self, *, payload: dict[str, Any], timeout_s: int) -> AceDataNanoBananaResult:
        url = f"{self._base_url}/nano-banana/images"
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": "application/json",
            "content-type": "application/json",
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        except requests.RequestException as e:
            raise AceDataNanoBananaError(f"Request failed: {e!s}") from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataNanoBananaError(
                f"Invalid JSON response (status={resp.status_code}): {snippet}"
            ) from e

        if not isinstance(body, dict):
            raise AceDataNanoBananaError(f"Invalid response payload: {type(body).__name__}")

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataNanoBananaApiError(
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
            raise AceDataNanoBananaApiError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        data = body.get("data") if isinstance(body.get("data"), list) else []
        return AceDataNanoBananaResult(
            action=str(body.get("action") or payload.get("action") or ""),
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=data,
        )


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
