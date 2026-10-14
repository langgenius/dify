import copy
import json
from unittest.mock import Mock

import pytest
import requests
from dify_plugin.entities.model import AIModelEntity

from model_catalog import (
    CatalogAuthorizationError,
    CatalogConnectionError,
    CatalogRateLimitError,
    CatalogUnavailableError,
    clear_catalog_cache,
    fetch_catalog,
    parse_catalog,
)


def remote_model(model="remote-model", *, vision=False, **values):
    return {
        "id": model,
        "name": model,
        "architecture": {"input_modalities": ["text", "image"] if vision else ["text"],
                         "output_modalities": ["text"]},
        "context_length": 262144,
        "supported_parameters": ["max_tokens", "temperature", "top_p", "tools", "response_format"],
        "providers": [{"reasoning": True, "vision": vision, "tools": True,
                       "streaming": True, "parallelToolCalls": False, "ocr": False}],
        "pricing": {"prompt": "3.5e-8", "completion": "7e-8"},
        "json_output": True,
        "structured_outputs": False,
        **values,
    }


@pytest.fixture(autouse=True)
def empty_cache():
    clear_catalog_cache()
    yield
    clear_catalog_cache()


def response(payload, status=200):
    result = Mock(spec=requests.Response)
    result.status_code = status
    result.iter_content.return_value = [json.dumps(payload).encode()]
    return result


def test_remote_catalog_drives_ids_vision_context_price_and_parameters():
    payload = {"data": [remote_model("a"), remote_model("brand-new-image", vision=True)]}
    before = copy.deepcopy(payload)
    schemas = parse_catalog(payload)
    assert [schema["model"] for schema in schemas] == ["a", "brand-new-image"]
    assert "vision" not in schemas[0]["features"]
    assert "vision" in schemas[1]["features"]
    assert schemas[1]["model_properties"]["context_size"] == 262144
    assert schemas[0]["pricing"] == {
        "input": "0.035000000", "output": "0.07000000", "unit": "0.000001", "currency": "USD"
    }
    assert "multi-tool-call" not in schemas[0]["features"]
    rules = {rule["name"]: rule for rule in schemas[0]["parameter_rules"]}
    assert "max" not in rules["max_tokens"]
    assert "use_template" not in rules["max_tokens"]
    assert rules["response_format"]["options"] == ["text", "json_object"]
    for schema in schemas:
        AIModelEntity.model_validate(schema)
    assert payload == before


def test_non_chat_offline_and_ocr_are_not_language_models():
    ocr = remote_model("ocr", architecture={"input_modalities": ["text"],
                                           "output_modalities": ["ocr"]})
    assert parse_catalog({"data": [ocr, remote_model("offline", enabled=False),
                                    remote_model("preview", status="preview")]}) == []
    assert parse_catalog({"data": []}) == []


def test_published_maximum_is_used_without_guessing():
    schema = parse_catalog({"data": [remote_model(max_output_tokens=12345)]})[0]
    assert schema["parameter_rules"][0]["max"] == 12345
    assert schema["parameter_rules"][0]["default"] == 4096


def test_catalog_has_no_fallback_ids_or_prices(monkeypatch):
    first = response({"data": [remote_model("new-a")]})
    second = response({"data": [remote_model("new-b", vision=True)]})
    get = Mock(side_effect=[first, second])
    monkeypatch.setattr(requests, "get", get)
    assert fetch_catalog("rc-fixture")[0]["model"] == "new-a"
    assert fetch_catalog("rc-fixture", force_refresh=True)[0]["model"] == "new-b"
    assert get.call_count == 2
    assert first.close.called and second.close.called


def test_cache_is_credential_and_tenant_scoped_and_returns_copies(monkeypatch):
    get = Mock(side_effect=[response({"data": [remote_model("a")]}),
                           response({"data": [remote_model("b")]}),
                           response({"data": [remote_model("c")]})])
    monkeypatch.setattr(requests, "get", get)
    first = fetch_catalog("rc-a", scope="tenant-a")
    first[0]["model"] = "mutated"
    assert fetch_catalog("rc-a", scope="tenant-a")[0]["model"] == "a"
    assert fetch_catalog("rc-a", scope="tenant-b")[0]["model"] == "b"
    assert fetch_catalog("rc-b", scope="tenant-a")[0]["model"] == "c"
    assert get.call_count == 3


@pytest.mark.parametrize("status,kind", [
    (401, CatalogAuthorizationError), (403, CatalogAuthorizationError),
    (429, CatalogRateLimitError), (302, CatalogConnectionError), (503, CatalogUnavailableError),
])
def test_discovery_status_errors_are_sanitized_and_responses_closed(monkeypatch, status, kind):
    reply = response({"error": "rc-private-value-do-not-print"}, status)
    monkeypatch.setattr(requests, "get", Mock(return_value=reply))
    with pytest.raises(kind) as error:
        fetch_catalog("rc-fixture")
    assert "rc-private" not in str(error.value)
    assert reply.close.called


def test_discovery_uses_only_fixed_url_bearer_source_timeout_and_no_redirect(monkeypatch):
    get = Mock(return_value=response({"data": []}))
    monkeypatch.setattr(requests, "get", get)
    fetch_catalog("  rc-fixture  ")
    assert get.call_args.args == ("https://developer.amd.com.cn/radeon/api/v1/models",)
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer rc-fixture"
    assert get.call_args.kwargs["headers"]["X-Source"] == "dify"
    assert get.call_args.kwargs["allow_redirects"] is False
    assert get.call_args.kwargs["timeout"] == (10, 30)
    assert get.call_args.kwargs["auth"] is not None


@pytest.mark.parametrize("payload", [
    None, {}, {"data": {}}, {"data": [remote_model(), remote_model()]},
    {"data": [remote_model(pricing={"prompt": "NaN", "completion": "0"})]},
    {"data": [remote_model(architecture="invalid")]},
    {"data": [remote_model(providers="invalid")]},
    {"data": [remote_model(top_provider="invalid")]},
])
def test_bad_catalog_is_not_a_successful_static_fallback(payload):
    with pytest.raises(CatalogUnavailableError):
        parse_catalog(payload)


def test_oversized_catalog_is_bounded_before_json_decode(monkeypatch):
    reply = response({"data": []})
    reply.iter_content.return_value = [b"x" * (2 * 1024 * 1024 + 1)]
    monkeypatch.setattr(requests, "get", Mock(return_value=reply))
    with pytest.raises(CatalogUnavailableError, match="too large"):
        fetch_catalog("rc-fixture")
    assert reply.close.called


def test_failed_force_refresh_never_returns_stale_catalog(monkeypatch):
    get = Mock(side_effect=[response({"data": [remote_model("old")]}),
                           response({}, 503), response({"data": [remote_model("new")]})])
    monkeypatch.setattr(requests, "get", get)
    assert fetch_catalog("rc-fixture")[0]["model"] == "old"
    with pytest.raises(CatalogUnavailableError):
        fetch_catalog("rc-fixture", force_refresh=True)
    assert fetch_catalog("rc-fixture")[0]["model"] == "new"