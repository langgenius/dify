"""Operator-owned OpenAI batch transport and Redis verdict storage for platform moderation."""

import hmac
import json
import logging
from collections.abc import Mapping, Sequence
from itertools import batched
from typing import Protocol

import httpx
from pydantic import BaseModel, StrictBool, ValidationError
from redis import RedisError

from core.helper.ssrf_proxy import MaxRetriesExceededError, ResponseLimitError, buffer_response
from core.tools.errors import ToolSSRFError
from extensions.ext_redis import RedisClientWrapper
from extensions.redis_names import serialize_redis_name
from services.hosted_moderation_service import HostedModerationUnavailableError

logger = logging.getLogger(__name__)

_DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"
_MODEL = "omni-moderation-latest"
_MAX_RESPONSE_BYTES = 256 * 1024
_CACHE_NAMESPACE = "hosted_moderation:v1"
_CACHE_READ_BATCH = 256


class ModerationHTTPClient(Protocol):
    """Send a protected request without redirects and with certificate verification."""

    def post(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        json: Mapping[str, object],
        timeout: httpx.Timeout,
        follow_redirects: bool,
        ssl_verify: bool,
        max_retries: int,
        stream_response: bool,
    ) -> httpx.Response: ...


class _OpenAIFlag(BaseModel):
    flagged: StrictBool


class _OpenAIResponse(BaseModel):
    results: list[_OpenAIFlag]


class OpenAIHostedModerationClient:
    """Classify a batch through an operator-selected OpenAI-compatible endpoint."""

    def __init__(
        self, *, http_client: ModerationHTTPClient, api_key: str, base_url: str | None, organization: str | None
    ) -> None:
        """Bind a nonempty platform key and optional endpoint settings without making requests."""
        if not api_key.strip():
            raise ValueError("A platform OpenAI key is required.")
        self._http_client = http_client
        base = (base_url or _DEFAULT_OPENAI_BASE).rstrip("/")
        api_base = base if base.endswith("/v1") else f"{base}/v1"
        self._endpoint = f"{api_base}/moderations"
        self._headers = {"Authorization": f"Bearer {api_key}", "Accept-Encoding": "identity"}
        if organization:
            self._headers["OpenAI-Organization"] = organization
        binding = json.dumps((self._endpoint, _MODEL, organization), separators=(",", ":")).encode()
        self._cache_key = hmac.digest(api_key.encode(), _CACHE_NAMESPACE.encode() + b"\x00" + binding, "sha256")

    @property
    def cache_key(self) -> bytes:
        """Return a dedicated HMAC key invalidated by changing credentials, endpoint, model, or schema version."""
        return self._cache_key

    def moderate(self, texts: Sequence[str]) -> tuple[bool, ...]:
        """Send a nonempty batch; translate expected transport and response failures without exposing payloads."""
        if not texts:
            raise ValueError("A moderation batch must not be empty.")
        try:
            endpoint = httpx.URL(self._endpoint)
        except (httpx.InvalidURL, ValueError):
            raise HostedModerationUnavailableError("The hosted OpenAI moderation endpoint is invalid.") from None
        if endpoint.scheme != "https" or not endpoint.host or endpoint.userinfo or endpoint.query or endpoint.fragment:
            raise HostedModerationUnavailableError(
                "Hosted OpenAI moderation requires an HTTPS base URL without user info, query, or fragment."
            )

        try:
            response = self._http_client.post(
                str(endpoint),
                headers=self._headers,
                json={"model": _MODEL, "input": list(texts)},
                timeout=httpx.Timeout(15.0, connect=3.0),
                follow_redirects=False,
                ssl_verify=True,
                max_retries=0,
                stream_response=True,
            )
            if not response.is_success:
                response.close()
                raise HostedModerationUnavailableError(f"OpenAI moderation returned HTTP {response.status_code}.")
            buffered = buffer_response(response, max_response_bytes=_MAX_RESPONSE_BYTES)
        except (httpx.RequestError, MaxRetriesExceededError, ResponseLimitError, ToolSSRFError) as error:
            raise HostedModerationUnavailableError(
                f"OpenAI moderation request failed ({type(error).__name__})."
            ) from error

        try:
            parsed = _OpenAIResponse.model_validate_json(buffered.content)
        except ValidationError:
            raise HostedModerationUnavailableError("OpenAI moderation returned a malformed response.") from None
        if len(parsed.results) != len(texts):
            raise HostedModerationUnavailableError("OpenAI moderation returned the wrong number of verdicts.")
        return tuple(result.flagged for result in parsed.results)


class RedisHostedModerationVerdictCache:
    """Store only authenticated content digests and booleans with a fixed expiry."""

    def __init__(self, client: RedisClientWrapper, *, ttl: int, hash_key: bytes) -> None:
        """Bind the platform classifier's HMAC key and positive TTL without Redis I/O."""
        if ttl <= 0 or not hash_key:
            raise ValueError("A positive verdict TTL and a classifier HMAC key are required.")
        self._client = client
        self._ttl = ttl
        self._hash_key = hash_key

    def _keys(self, tenant_id: str, texts: Sequence[str]) -> list[str]:
        """Derive physical keys from exact UTF-8 text within the admitted tenant and classifier scope."""
        tenant_key = hmac.digest(self._hash_key, tenant_id.encode(), "sha256")
        return [
            serialize_redis_name(f"{_CACHE_NAMESPACE}:{hmac.digest(tenant_key, text.encode(), 'sha256').hex()}")
            for text in texts
        ]

    def lookup(self, tenant_id: str, texts: Sequence[str]) -> dict[str, bool]:
        """Read known verdict values in bounded pipelines. Unrecognized values and read failures are misses."""
        verdicts: dict[str, bool] = {}
        try:
            for batch in batched(texts, _CACHE_READ_BATCH, strict=False):
                with self._client.pipeline(transaction=False) as pipe:
                    for key in self._keys(tenant_id, batch):
                        pipe.get(key)
                    values: list[object] = pipe.execute()
                if len(values) == len(batch):
                    verdicts.update(
                        (text, value in (b"1", "1"))
                        for text, value in zip(batch, values, strict=True)
                        if value in (b"1", "1", b"0", "0")
                    )
        except (RedisError, RuntimeError) as error:
            logger.warning("Moderation cache read failed. tenant_id=%s error_type=%s", tenant_id, type(error).__name__)
        return verdicts

    def store(self, tenant_id: str, verdicts: Mapping[str, bool]) -> None:
        """Cache validated verdicts independently; a write failure cannot change the current decision."""
        if not verdicts:
            return
        try:
            with self._client.pipeline(transaction=False) as pipe:
                for key, flagged in zip(self._keys(tenant_id, tuple(verdicts)), verdicts.values(), strict=True):
                    pipe.set(key, b"1" if flagged else b"0", ex=self._ttl)
                pipe.execute()
        except (RedisError, RuntimeError) as error:
            logger.warning("Moderation cache write failed. tenant_id=%s error_type=%s", tenant_id, type(error).__name__)
