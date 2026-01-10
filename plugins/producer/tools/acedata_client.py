from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import requests


@dataclass(frozen=True)
class AceDataProducerError(RuntimeError):
    code: str
    message: str
    trace_id: str | None = None
    status_code: int | None = None

    def __str__(self) -> str:
        trace_suffix = f" (trace_id={self.trace_id})" if self.trace_id else ""
        status_suffix = f" (status={self.status_code})" if self.status_code else ""
        return f"{self.code}: {self.message}{trace_suffix}{status_suffix}"


@dataclass(frozen=True)
class AceDataProducerListResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: list[dict[str, Any]]


@dataclass(frozen=True)
class AceDataProducerObjectResult:
    action: str
    task_id: str | None
    trace_id: str | None
    data: dict[str, Any]


def _normalize_token(raw_token: str) -> str:
    token = raw_token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


class AceDataProducerClient:
    def __init__(self, bearer_token: str, base_url: str = "https://api.acedata.cloud") -> None:
        token = _normalize_token(bearer_token)
        if not token:
            raise AceDataProducerError(code="token_empty", message="Empty bearer token.")

        self._token = token
        self._base_url = base_url.rstrip("/")

    def audios(self, *, payload: dict[str, Any], timeout_s: int = 1800) -> AceDataProducerListResult:
        return self._post_list(path="/producer/audios", payload=payload, timeout_s=timeout_s)

    def lyrics(self, *, prompt: str, timeout_s: int = 1800) -> AceDataProducerObjectResult:
        return self._post_object(path="/producer/lyrics", payload={"prompt": prompt}, timeout_s=timeout_s)

    def upload(self, *, audio_url: str, timeout_s: int = 1800) -> AceDataProducerObjectResult:
        return self._post_object(path="/producer/upload", payload={"audio_url": audio_url}, timeout_s=timeout_s)

    def videos(self, *, audio_id: str, timeout_s: int = 1800) -> AceDataProducerObjectResult:
        return self._post_object(path="/producer/videos", payload={"audio_id": audio_id}, timeout_s=timeout_s)

    def wav(self, *, audio_id: str, timeout_s: int = 1800) -> AceDataProducerListResult:
        return self._post_list(path="/producer/wav", payload={"audio_id": audio_id}, timeout_s=timeout_s)

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
            raise AceDataProducerError(code="request_failed", message=str(e)) from e

        try:
            body = resp.json()
        except ValueError as e:
            snippet = (resp.text or "")[:500]
            raise AceDataProducerError(
                code="invalid_json",
                message=f"Invalid JSON response: {snippet}",
                status_code=resp.status_code,
            ) from e

        if not isinstance(body, dict):
            raise AceDataProducerError(
                code="invalid_payload",
                message=f"Invalid response payload: {type(body).__name__}",
                status_code=resp.status_code,
            )

        if resp.status_code >= 400:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataProducerError(
                code=code or "error",
                message=message or str(body),
                trace_id=trace_id,
                status_code=resp.status_code,
            )

        return body

    def _post_list(self, *, path: str, payload: dict[str, Any], timeout_s: int) -> AceDataProducerListResult:
        body = self._post_raw(path=path, payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataProducerError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        data = body.get("data") if isinstance(body.get("data"), list) else []
        return AceDataProducerListResult(
            action=str(body.get("action") or payload.get("action") or ""),
            task_id=body.get("task_id") if isinstance(body.get("task_id"), str) else None,
            trace_id=body.get("trace_id") if isinstance(body.get("trace_id"), str) else None,
            data=[item for item in data if isinstance(item, dict)],
        )

    def _post_object(
        self, *, path: str, payload: dict[str, Any], timeout_s: int
    ) -> AceDataProducerObjectResult:
        body = self._post_raw(path=path, payload=payload, timeout_s=timeout_s)

        if body.get("success") is not True:
            trace_id = body.get("trace_id") if isinstance(body.get("trace_id"), str) else None
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            code = error.get("code") if isinstance(error.get("code"), str) else None
            message = error.get("message") if isinstance(error.get("message"), str) else None
            raise AceDataProducerError(
                code=code or "api_error",
                message=message or str(body),
                trace_id=trace_id,
            )

        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        return AceDataProducerObjectResult(
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
