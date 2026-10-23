import traceback

import pytest
from dify_trace_sdk.config import FormField
from dify_trace_sdk.errors import VerificationError
from dify_trace_sdk.testing import RecordingEgress
from dify_trace_tencent.config import TencentConfig
from dify_trace_tencent.provider import TencentProvider
from pydantic import ValidationError

TOKEN = "synthetic-token"


def _config(**overrides: object) -> TencentConfig:
    return TencentConfig.model_validate(
        {"endpoint": "https://collector.example:4320", "service_name": "dify-agent", "token": TOKEN, **overrides}
    )


def _rendered(error: ValidationError) -> str:
    return str(error) + repr(error) + "".join(traceback.format_exception(error))


def test_form_declares_the_token_as_the_only_secret() -> None:
    assert TencentConfig.secret_fields() == {"token"}
    assert TencentConfig.derived_fields() == set()
    assert TencentConfig.form_fields() == (
        FormField(name="token", secret=True, required=True),
        FormField(name="endpoint", secret=False, required=True),
        FormField(name="service_name", secret=False, required=True),
    )


def test_normalization_keeps_the_token_opaque_and_revalidates_unchanged() -> None:
    config = _config(
        endpoint=" https://COLLECTOR.Example:4320/ ",
        service_name=" dify-agent ",
        token=" opaque token/+== ",
        retired_field="ignored",
    )
    assert config.model_dump() == {
        "token": " opaque token/+== ",
        "endpoint": "https://collector.example:4320",
        "service_name": "dify-agent",
    }
    assert TencentConfig.model_validate(config.model_dump()) == config


@pytest.mark.parametrize("service_name", ["a", "a" * 63, "app-1", "a--b"])
def test_documented_service_name_boundaries_are_accepted(service_name: str) -> None:
    assert _config(service_name=service_name).service_name == service_name


@pytest.mark.parametrize(
    ("service_name", "stored"), [("dify_app", "dify_app"), ("Dify App ", "Dify App"), ("  ", "dify_app")]
)
def test_stored_service_names_from_before_verification_stay_usable(service_name: str, stored: str) -> None:
    assert _config(service_name=service_name).service_name == stored


@pytest.mark.parametrize(
    "service_name",
    ["", "   ", "dify_app", "Dify", "1app", "-app", "app-", "a" * 64, "应用", "a.b", "a/b", "a b", "a\nb"],
)
def test_verification_rejects_service_names_outside_the_documented_pattern(service_name: str) -> None:
    egress = RecordingEgress([], grpc_target=None)
    with pytest.raises(VerificationError) as raised:
        TencentProvider(egress).verify(_config(service_name=service_name))
    assert raised.value.code == "invalid_service_name"
    assert egress.grpc_endpoints == []


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        ("https://COLLECTOR.Example:4320/", "https://collector.example:4320"),
        ("http://collector.example:4319", "http://collector.example:4319"),
        ("https://collector.example/", "https://collector.example"),
        ("http://collector.example", "http://collector.example"),
        ("https://collector.example:443", "https://collector.example:443"),
        ("http://127.0.0.1:1/", "http://127.0.0.1:1"),
        ("https://[2001:DB8::1]:65535/", "https://[2001:db8::1]:65535"),
        ("https://BÜCHER.example:4320/", "https://xn--bcher-kva.example:4320"),
    ],
)
def test_origins_are_normalized_without_changing_an_explicit_port(endpoint: str, expected: str) -> None:
    assert _config(endpoint=endpoint).endpoint == expected


@pytest.mark.parametrize(
    "endpoint",
    [
        "",
        "   ",
        "collector.example:4320",
        "ftp://collector.example:4320",
        "https://",
        "https:///",
        "https://user:synthetic-secret@collector.example:4320",
        "https://@collector.example:4320",
        "https://collector.example:4320/v1/traces",
        "https://collector.example:4320//",
        "https://collector.example:4320?token=synthetic-secret",
        "https://collector.example:4320?",
        "https://collector.example:4320#project",
        "https://collector.example:4320#",
        "https://collector.example\\@other.example:4320",
        "https://col lector.example:4320",
        "https://collector.example:\n4320",
        "https://collector.example:\t4320",
        "https://collector\x00.example:4320",
        "https://collector.example:0",
        "https://collector.example:65536",
        "https://collector.example:-1",
        "https://collector.example:invalid",
        "https://collector.example:",
        "https://[2001:db8::1",
        "https://[not-an-ipv6-address]:4320",
    ],
)
def test_invalid_endpoints_are_rejected_without_echo(endpoint: str) -> None:
    with pytest.raises(ValidationError) as caught:
        _config(endpoint=endpoint)
    rendered = _rendered(caught.value)
    assert "Tencent APM requires an HTTP(S) collector origin" in rendered
    assert "synthetic-secret" not in rendered
    assert TOKEN not in rendered


@pytest.mark.parametrize(
    "token", ["", " ", "\t\n", "synthetic\ntoken", "synthetic\x00token", "synthetic\x7ftoken", "synthetic-tökén"]
)
def test_tokens_grpc_metadata_cannot_carry_are_rejected_without_echo(token: str) -> None:
    with pytest.raises(ValidationError) as caught:
        _config(token=token)
    rendered = _rendered(caught.value)
    assert "Tencent APM requires a nonempty token" in rendered
    assert "synthetic" not in rendered


def test_masked_tokens_pass_validation() -> None:
    assert _config(token="***").token == "***"


@pytest.mark.parametrize("field", ["endpoint", "service_name", "token"])
@pytest.mark.parametrize("value", [None, 42])
def test_non_string_values_are_rejected(field: str, value: object) -> None:
    with pytest.raises(ValidationError):
        _config(**{field: value})


@pytest.mark.parametrize("field", ["endpoint", "service_name", "token"])
def test_required_fields_have_no_defaults(field: str) -> None:
    stored = {"endpoint": "https://collector.example:4320", "service_name": "dify-agent", "token": TOKEN}
    del stored[field]
    with pytest.raises(ValidationError):
        TencentConfig.model_validate(stored)
