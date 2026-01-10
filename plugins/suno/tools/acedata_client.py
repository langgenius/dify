from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataSunoError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataSunoListResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: list[dict[str, Any]]

    @property
    def audio_urls(self) -> list[str]:
        urls: list[str] = []
        for item in self.data:
            audio_url = item.get("audio_url")
            if isinstance(audio_url, str) and audio_url.strip():
                urls.append(audio_url.strip())
        return urls

    @property
    def image_urls(self) -> list[str]:
        urls: list[str] = []
        for item in self.data:
            image_url = item.get("image_url")
            if isinstance(image_url, str) and image_url.strip():
                urls.append(image_url.strip())
        return urls


@dataclass(frozen=True)
class AceDataSunoObjectResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: dict[str, Any]


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataSunoClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataSunoError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def generate_audios(self, *, payload: dict[str, Any], timeout_s: int = 1800) -> AceDataSunoListResult:
        return self._post_list(path="/suno/audios", payload=payload, timeout_s=timeout_s)

    def generate_lyrics(self, *, prompt: str, timeout_s: int = 600) -> AceDataSunoObjectResult:
        return self._post_object(path="/suno/lyrics", payload={"prompt": prompt}, timeout_s=timeout_s)

    def upload_reference_audio(self, *, audio_url: str, timeout_s: int = 600) -> AceDataSunoObjectResult:
        return self._post_object(path="/suno/upload", payload={"audio_url": audio_url}, timeout_s=timeout_s)

    def get_mp4(self, *, audio_id: str, timeout_s: int = 600) -> AceDataSunoObjectResult:
        return self._post_object(path="/suno/mp4", payload={"audio_id": audio_id}, timeout_s=timeout_s)

    def wav(
        self, *, audio_id: str, callback_url: str | None = None, timeout_s: int = 600
    ) -> AceDataSunoListResult:
        payload: dict[str, Any] = {"audio_id": audio_id}
        if callback_url:
            payload["callback_url"] = callback_url
        return self._post_list(path="/suno/wav", payload=payload, timeout_s=timeout_s)

    def midi(
        self, *, audio_id: str, callback_url: str | None = None, timeout_s: int = 600
    ) -> AceDataSunoListResult:
        payload: dict[str, Any] = {"audio_id": audio_id}
        if callback_url:
            payload["callback_url"] = callback_url
        return self._post_list(path="/suno/midi", payload=payload, timeout_s=timeout_s)

    def timing(self, *, audio_id: str, timeout_s: int = 600) -> AceDataSunoObjectResult:
        return self._post_object(path="/suno/timing", payload={"audio_id": audio_id}, timeout_s=timeout_s)

    def style(self, *, prompt: str, timeout_s: int = 600) -> AceDataSunoObjectResult:
        return self._post_object(path="/suno/style", payload={"prompt": prompt}, timeout_s=timeout_s)

    def vox(
        self, *, audio_id: str, vocal_start: float | None, vocal_end: float | None, timeout_s: int = 600
    ) -> AceDataSunoObjectResult:
        payload: dict[str, Any] = {"audio_id": audio_id}
        if vocal_start is not None:
            payload["vocal_start"] = vocal_start
        if vocal_end is not None:
            payload["vocal_end"] = vocal_end
        return self._post_object(path="/suno/vox", payload=payload, timeout_s=timeout_s)

    def persona(
        self,
        *,
        audio_id: str,
        name: str,
        description: str | None = None,
        vox_audio_id: str | None = None,
        vocal_start: float | None = None,
        vocal_end: float | None = None,
        timeout_s: int = 600,
    ) -> AceDataSunoObjectResult:
        payload: dict[str, Any] = {"audio_id": audio_id, "name": name}
        if description:
            payload["description"] = description
        if vox_audio_id:
            payload["vox_audio_id"] = vox_audio_id
        if vocal_start is not None:
            payload["vocal_start"] = vocal_start
        if vocal_end is not None:
            payload["vocal_end"] = vocal_end
        return self._post_object(path="/suno/persona", payload=payload, timeout_s=timeout_s)

    def _post_raw(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": "application/json",
            "content-type": "application/json",
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=timeout_s)
        except requests.RequestException as e:
            raise AceDataSunoError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataSunoError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataSunoError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSunoError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body

    def _post_list(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> AceDataSunoListResult:
        body = self._post_raw(path=path, payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSunoError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        data = body.get("data") if isinstance(body.get("data"), list) else []
        return AceDataSunoListResult(
            action=str(body.get("action") or payload.get("action") or ""),
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=[item for item in data if isinstance(item, dict)],
        )

    def _post_object(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> AceDataSunoObjectResult:
        body = self._post_raw(path=path, payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataSunoError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        return AceDataSunoObjectResult(
            action=str(body.get("action") or payload.get("action") or ""),
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=data,
        )


def parse_optional_float(value: Any, *, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError as e:
            raise ValueError(f"`{field}` must be a number.") from e
    raise ValueError(f"`{field}` must be a number.")
