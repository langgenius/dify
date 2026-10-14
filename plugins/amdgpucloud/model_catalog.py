"""Credential-scoped remote discovery shared by the plugin and local API adapter.

No model IDs or provider prices are embedded here. Unknown service output limits
remain unknown; they are not replaced by a guessed product maximum.
"""

import copy
import hashlib
import json
import threading
import time
from collections import OrderedDict
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation
from typing import Any

import requests

MODELS_URL = "https://developer.amd.com.cn/radeon/api/v1/models"
CACHE_TTL_SECONDS = 30
MAX_CACHED_CREDENTIALS = 64
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_MODELS = 2048
_cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()
_lock = threading.RLock()


class CatalogError(Exception):
    """Only fixed, non-sensitive messages may be raised by discovery."""


class CatalogAuthorizationError(CatalogError):
    pass


class CatalogConnectionError(CatalogError):
    pass


class CatalogRateLimitError(CatalogError):
    pass


class CatalogUnavailableError(CatalogError):
    pass


class ExplicitBearerAuth(requests.auth.AuthBase):
    def __call__(self, request):
        return request


def _positive_integer(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _price(value: object) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise CatalogUnavailableError("AMDGPUCloud returned invalid catalog pricing")
    try:
        price = Decimal(str(value))
    except InvalidOperation:
        raise CatalogUnavailableError("AMDGPUCloud returned invalid catalog pricing") from None
    if not price.is_finite() or price < 0:
        raise CatalogUnavailableError("AMDGPUCloud returned invalid catalog pricing")
    return price


def _providers(row: Mapping) -> list[Mapping]:
    providers = row.get("providers") or []
    if not isinstance(providers, list) or any(not isinstance(item, Mapping) for item in providers):
        raise CatalogUnavailableError("AMDGPUCloud returned invalid provider metadata")
    return providers


def _capability(row: Mapping, name: str) -> bool:
    values = [item[name] for item in _providers(row) if isinstance(item.get(name), bool)]
    return bool(values) and all(values)


def parse_catalog(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, Mapping) or not isinstance(payload.get("data"), list):
        raise CatalogUnavailableError("AMDGPUCloud returned an invalid model catalog")
    if len(payload["data"]) > MAX_MODELS:
        raise CatalogUnavailableError("AMDGPUCloud model catalog is too large")
    models = []
    seen = set()
    for row in payload["data"]:
        if not isinstance(row, Mapping):
            raise CatalogUnavailableError("AMDGPUCloud returned an invalid model record")
        architecture = row.get("architecture") or {}
        if not isinstance(architecture, Mapping):
            raise CatalogUnavailableError("AMDGPUCloud returned invalid modality metadata")
        outputs = architecture.get("output_modalities", row.get("output", []))
        inputs = architecture.get("input_modalities", [])
        if not isinstance(outputs, list) or "text" not in outputs:
            continue
        providers = _providers(row)
        if (not isinstance(inputs, list) or "text" not in inputs
            or any(item.get("ocr") is True for item in providers)):
            continue
        if row.get("enabled") is False or row.get("deprecated") is True:
            continue
        if row.get("status") in {"offline", "temp_offline", "disabled", "preview"}:
            continue
        model = row.get("id")
        if (not isinstance(model, str) or not model or len(model) > 255
                or any(ord(character) < 32 or ord(character) == 127 for character in model)):
            raise CatalogUnavailableError("AMDGPUCloud returned an invalid model identity")
        if model in seen:
            raise CatalogUnavailableError("AMDGPUCloud returned duplicate model identities")
        seen.add(model)
        parameters = row.get("supported_parameters") or []
        if (not isinstance(parameters, list)
            or any(not isinstance(name, str) for name in parameters)):
            raise CatalogUnavailableError("AMDGPUCloud returned invalid parameter metadata")
        features = []
        if _capability(row, "reasoning"):
            features.append("agent-thought")
        if "image" in inputs:
            features.append("vision")
        if "tools" in parameters and _capability(row, "tools"):
            features.append("tool-call")
            if _capability(row, "streaming"):
                features.append("stream-tool-call")
        properties: dict[str, Any] = {"mode": "chat"}
        context = _positive_integer(row.get("context_length"))
        if context:
            properties["context_size"] = context
        top_provider = row.get("top_provider") or {}
        if not isinstance(top_provider, Mapping):
            raise CatalogUnavailableError("AMDGPUCloud returned invalid provider metadata")
        limits = [row, top_provider, *providers]
        output_limits = [limit for item in limits for field in (
            "max_completion_tokens", "max_output_tokens", "maxOutput"
        ) if (limit := _positive_integer(item.get(field)))]
        maximum = min(output_limits) if output_limits else None
        rules: list[dict[str, Any]] = []
        if "max_tokens" in parameters:
            rule: dict[str, Any] = {
                "name": "max_tokens", "type": "int", "required": False,
                "label": {"en_US": "Max Tokens", "zh_Hans": "最大输出Token"},
                "default": min(4096, maximum) if maximum else 4096, "min": 1,
                "help": {
                    "en_US": "Service output limit is not published; the API enforces its limit."
                    if maximum is None else "Output limit from the remote model catalog.",
                    "zh_Hans": "服务未公开最大输出值；由API执行限制。"
                    if maximum is None else "最大输出值取自远端模型目录。",
                },
            }
            if maximum:
                rule["max"] = maximum
            rules.append(rule)
        for name, label, default in (("temperature", "Temperature", 0.7), ("top_p", "Top P", 1.0)):
            if name in parameters:
                rules.append({"name": name, "type": "float", "required": False,
                              "label": {"en_US": label, "zh_Hans": label}, "default": default})
        if "response_format" in parameters:
            rules.append({
                "name": "response_format", "type": "string", "required": False,
                "label": {"en_US": "Response Format", "zh_Hans": "回复格式"},
                "options": ["text", "json_object"] if row.get("json_output") is True else ["text"],
            })
        label = row.get("name")
        label = label if isinstance(label, str) and label else model
        schema = {
            "model": model, "label": {"en_US": label, "zh_Hans": label}, "model_type": "llm",
            "features": features, "fetch_from": "predefined-model", "model_properties": properties,
            "parameter_rules": rules, "deprecated": False,
        }
        pricing = row.get("pricing") or {}
        if isinstance(pricing, Mapping):
            if "prompt" in pricing and "completion" in pricing:
                schema["pricing"] = {
                    "input": format(_price(pricing["prompt"]) * 1_000_000, "f"),
                    "output": format(_price(pricing["completion"]) * 1_000_000, "f"),
                    "unit": "0.000001", "currency": "USD",
                }
            elif pricing.get("unit") == "USD / 1M tokens" and "input" in pricing:
                schema["pricing"] = {
                    "input": format(_price(pricing["input"]), "f"),
                    "output": (
                        format(_price(pricing["output"]), "f") if "output" in pricing else None
                    ),
                    "unit": "0.000001", "currency": "USD",
                }
        models.append(schema)
    return models


def fetch_catalog(
    api_key: str, *, force_refresh: bool = False, scope: str = ""
) -> list[dict[str, Any]]:
    if (not isinstance(api_key, str) or not api_key.strip()
            or any(ord(character) < 32 or ord(character) == 127 for character in api_key)):
        raise CatalogAuthorizationError("AMDGPUCloud API key is required or invalid")
    api_key = api_key.strip()
    cache_key = hashlib.sha256((scope + "\0" + api_key).encode()).hexdigest()
    with _lock:
        cached = _cache.get(cache_key)
        if cached and not force_refresh and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(cache_key)
            return copy.deepcopy(cached[1])
        # A failed forced/expired refresh must not expose an earlier result as current.
        _cache.pop(cache_key, None)
    response = None
    try:
        response = requests.get(
            MODELS_URL,
            headers={
                "Authorization": f"Bearer {api_key}", "X-Source": "dify",
                "Accept": "application/json",
            },
            auth=ExplicitBearerAuth(), timeout=(10, 30), allow_redirects=False, stream=True,
        )
        if response.status_code in {401, 403}:
            raise CatalogAuthorizationError("AMDGPUCloud rejected the catalog credentials")
        if response.status_code == 429:
            raise CatalogRateLimitError("AMDGPUCloud model discovery was rate limited")
        if 300 <= response.status_code < 400:
            raise CatalogConnectionError("AMDGPUCloud model discovery refused a redirect")
        if response.status_code != 200:
            raise CatalogUnavailableError("AMDGPUCloud model catalog is unavailable")
        content = bytearray()
        for part in response.iter_content(chunk_size=8192):
            if len(content) + len(part) > MAX_RESPONSE_BYTES:
                raise CatalogUnavailableError("AMDGPUCloud model catalog response is too large")
            content.extend(part)
        models = parse_catalog(json.loads(content))
    except requests.RequestException:
        raise CatalogConnectionError("AMDGPUCloud model discovery connection failed") from None
    except (ValueError, UnicodeError):
        raise CatalogUnavailableError("AMDGPUCloud returned an invalid model catalog") from None
    finally:
        if response is not None:
            response.close()
    with _lock:
        _cache[cache_key] = (time.monotonic(), models)
        _cache.move_to_end(cache_key)
        while len(_cache) > MAX_CACHED_CREDENTIALS:
            _cache.popitem(last=False)
    return copy.deepcopy(models)


def clear_catalog_cache() -> None:
    with _lock:
        _cache.clear()