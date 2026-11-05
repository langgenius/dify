import json

import pytest
from dify_trace_otel.config import OTelConfig
from pydantic import ValidationError

ENDPOINT = "http://collector.internal:4318/v1/traces"


def test_form_defaults_and_secret_contract() -> None:
    config = OTelConfig(endpoint=ENDPOINT, service_name="  ", headers="{}", resource_attributes="")
    assert config.service_name == "dify"
    assert config.headers == ""
    assert config.parsed_headers() == {}
    assert config.parsed_resource_attributes() == {}
    assert OTelConfig.secret_fields() == {"headers"}
    assert OTelConfig.destination_fields() == {"endpoint"}


def test_legacy_structured_json_and_literal_asterisks_are_preserved() -> None:
    config = OTelConfig.model_validate(
        {
            "endpoint": ENDPOINT,
            "headers": {"Authorization": "Bearer a*b"},
            "resource_attributes": {"environment": "test", "replicas": 2, "active": True, "regions": ["a", "b"]},
        }
    )
    assert config.parsed_headers() == {"Authorization": "Bearer a*b"}
    assert json.loads(config.resource_attributes)["regions"] == ["a", "b"]


@pytest.mark.parametrize("value", [None, "", "  "])
def test_empty_optional_fields_accept_saved_rows(value: object) -> None:
    config = OTelConfig.model_validate({"endpoint": ENDPOINT, "headers": value, "resource_attributes": value})
    assert config.parsed_headers() == config.parsed_resource_attributes() == {}


@pytest.mark.parametrize("value", ["[]", '"secret-canary"', "1", "null", '{"x":NaN}', "bad-secret-canary"])
@pytest.mark.parametrize("field", ["headers", "resource_attributes"])
def test_invalid_json_objects_fail_without_echoing_input(field: str, value: str) -> None:
    with pytest.raises(ValidationError) as caught:
        OTelConfig.model_validate({"endpoint": ENDPOINT, field: value})
    assert "secret-canary" not in str(caught.value)


@pytest.mark.parametrize(
    "headers",
    [
        {"bad header": "secret-canary"},
        {"Authorization": " leading-secret-canary"},
        {"Authorization": "secret-canary\r\nInjected: true"},
        {"Authorization": "中文-secret-canary"},
        {"Authorization": 1},
        {"Content-Type": "secret-canary"},
        {"Host": "secret-canary"},
        {"Content-Length": "123"},
        {"authorization": "a", "Authorization": "b"},
    ],
)
def test_invalid_or_transport_headers_fail_without_echoing_input(headers: dict[str, object]) -> None:
    with pytest.raises(ValidationError) as caught:
        OTelConfig.model_validate({"endpoint": ENDPOINT, "headers": headers})
    assert "secret-canary" not in str(caught.value)


@pytest.mark.parametrize(
    "attributes",
    [
        {"nested": {}},
        {"value": None},
        {"array": [1, "2"]},
        {"array": [True, 1]},
        {"array": [None]},
        {"x": float("inf")},
        {"": "value"},
        {"service.name": "other"},
    ],
)
def test_invalid_resource_attributes_are_rejected(attributes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        OTelConfig.model_validate({"endpoint": ENDPOINT, "resource_attributes": attributes})


@pytest.mark.parametrize(
    "endpoint",
    [
        "ftp://collector/v1/traces",
        "https://user:secret-canary@collector/v1/traces",
        "http://collector:0/v1/traces",
        "http://collector:invalid/v1/traces",
        "http://collector:/v1/traces",
        "https://collector/v1/traces?token=secret-canary",
        "http://collector/#secret-canary",
        "http://collector/\nsecret-canary",
        "http://collector\\secret-canary/v1/traces",
        "",
    ],
)
def test_invalid_endpoint_is_rejected_without_leaking_values(endpoint: str) -> None:
    with pytest.raises(ValidationError) as caught:
        OTelConfig(endpoint=endpoint)
    assert "secret-canary" not in str(caught.value)


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        (" http://collector:4318 ", ENDPOINT.replace("collector.internal", "collector")),
        ("https://collector/", "https://collector/v1/traces"),
        ("https://collector/proxy/custom-traces", "https://collector/proxy/custom-traces"),
    ],
)
def test_endpoint_preserves_custom_routes_and_expands_bare_origins(endpoint: str, expected: str) -> None:
    assert OTelConfig(endpoint=endpoint).endpoint == expected
