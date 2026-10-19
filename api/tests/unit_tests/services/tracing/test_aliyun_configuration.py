"""Pure Aliyun destination rules; these tests do not claim account verification."""

import traceback
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit

import httpx
import pytest
from dify_trace_aliyun.aliyun_trace import AliyunDataTrace
from dify_trace_aliyun.config import AliyunConfig
from dify_trace_aliyun.configuration import (
    AliyunConfigurationError,
    console_url,
    ingestion_url,
    normalize_configuration,
    verify_configuration,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from pydantic import ValidationError

from core.helper import ssrf_proxy


def values(**overrides: object) -> dict[str, object]:
    return {"endpoint": "http://tracing-analysis-dc-qd.aliyuncs.com", "license_key": "synthetic-key", **overrides}


def test_normalization_preserves_opaque_license_prefix_and_application_name() -> None:
    submitted = values(
        endpoint=" HTTPS://Project.CN-QINGDAO.LOG.ALIYUNCS.COM:443/apm/trace/opentelemetry/ ",
        app_name=" 中文 agent_Name 01 ",
        license_key="literal%2F@a+b/c",
    )
    original = dict(submitted)
    result = normalize_configuration(submitted)
    assert result.endpoint == "https://project.cn-qingdao.log.aliyuncs.com:443/apm/trace/opentelemetry"
    assert result.app_name == "中文 agent_Name 01"
    assert result.license_key == "literal%2F@a+b/c"
    assert submitted == original
    assert ingestion_url(result.model_dump()) == (
        "https://project.cn-qingdao.log.aliyuncs.com:443/apm/trace/opentelemetry/"
        "adapt_literal%252F@a%2Bb%2Fc/api/v1/traces"
    )


@pytest.mark.parametrize("key", ["raw%2F", "raw%252F", "a/b?c#d", "left@right_one+two", "密钥"])
def test_ingestion_path_round_trips_the_raw_license_exactly_once(key: str) -> None:
    url = ingestion_url(values(license_key=key))
    path = urlsplit(url).path
    assert path.startswith("/adapt_")
    assert path.endswith("/api/otlp/traces")
    encoded = path.removeprefix("/adapt_").removesuffix("/api/otlp/traces")
    assert "/" not in encoded
    assert unquote(encoded) == key


@pytest.mark.parametrize("name", ["", "  ", "dify_app", "应用 & Space"])
def test_application_names_keep_aliyun_semantics(name: str) -> None:
    assert normalize_configuration(values(app_name=name)).app_name == (name.strip() or "dify_app")


def test_legacy_default_endpoint_and_app_name_remain_available() -> None:
    result = normalize_configuration(values(endpoint=""))
    assert result.endpoint == "https://tracing-analysis-dc-hz.aliyuncs.com"
    assert result.app_name == "dify_app"


@pytest.mark.parametrize(
    ("base", "expected"),
    [
        ("https://log.aliyuncs.com", "https://log.aliyuncs.com/adapt_synthetic-key/api/v1/traces"),
        (
            "https://CN-QINGDAO.LOG.ALIYUNCS.COM.:443/prefix/",
            "https://cn-qingdao.log.aliyuncs.com.:443/prefix/adapt_synthetic-key/api/v1/traces",
        ),
        (
            "https://log.aliyuncs.com.evil.test",
            "https://log.aliyuncs.com.evil.test/adapt_synthetic-key/api/otlp/traces",
        ),
        ("https://evil-log.aliyuncs.com", "https://evil-log.aliyuncs.com/adapt_synthetic-key/api/otlp/traces"),
        (
            "https://collector.test/log.aliyuncs.com",
            "https://collector.test/log.aliyuncs.com/adapt_synthetic-key/api/otlp/traces",
        ),
        ("http://[::1]:4318/reverse/", "http://[::1]:4318/reverse/adapt_synthetic-key/api/otlp/traces"),
    ],
)
def test_ingestion_family_uses_only_the_hostname(base: str, expected: str) -> None:
    assert ingestion_url(values(endpoint=base)) == expected


@pytest.mark.parametrize(
    "endpoint",
    [
        None,
        1,
        "ftp://host.test",
        "https:///missing",
        "https://user:secret@host.test",
        "https://host.test?",
        "https://host.test#",
        "https://host.test/path?key=secret",
        "https://host.test:bad",
        "https://host.test:0",
        "https://host.test:65536",
        "https://host.test:",
        "https://[invalid",
        "\nhttps://host.test",
        "https://ho\nst.test",
        "https://host.test\\@elsewhere",
        "https://host.test/a/../b",
        "https://host.test/a/%2e%2e/b",
        "https://host.test/a%2fb",
        "https://host.test/%252e%252e",
        "https://host.test/%zz",
        "https://host.test/double//path",
        "https://host.test/adapt_DO-NOT-PRINT/api/otlp/traces",
        "https://host.test/reverse/adapt_DO-NOT-PRINT/api/v1/traces/",
        "https://host.test/%61dapt_DO-NOT-PRINT",
        "https://host.test/api/otlp/traces",
        "https://host.test/v1/traces",
    ],
)
def test_new_endpoints_reject_unsafe_or_already_completed_routes(endpoint: object) -> None:
    with pytest.raises(AliyunConfigurationError) as error:
        normalize_configuration(values(endpoint=endpoint))
    assert error.value.code == "invalid_endpoint"
    assert "DO-NOT-PRINT" not in str(error.value)
    assert "host.test" not in str(error.value)


@pytest.mark.parametrize("field", ["endpoint", "license_key"])
def test_required_fields_are_not_invented(field: str) -> None:
    submitted = values()
    del submitted[field]
    with pytest.raises(AliyunConfigurationError):
        normalize_configuration(submitted)


@pytest.mark.parametrize("key", [None, 1, "", " ", " secret", "secret ", "secret\n", "secret\x00", "secret\ud800"])
def test_invalid_license_is_rejected_without_echoing_it(key: object) -> None:
    with pytest.raises(AliyunConfigurationError) as error:
        normalize_configuration(values(license_key=key))
    assert error.value.code == "invalid_license_key"
    assert "secret" not in str(error.value)


@pytest.mark.parametrize("name", [None, 1, "app\nname", "app\x00name"])
def test_application_control_characters_are_rejected(name: object) -> None:
    with pytest.raises(AliyunConfigurationError) as error:
        normalize_configuration(values(app_name=name))
    assert error.value.code == "invalid_app_name"


def test_masks_survive_patch_normalization_but_cannot_be_sent() -> None:
    result = normalize_configuration(values(license_key="***masked"))
    assert result.license_key == "***masked"
    with pytest.raises(AliyunConfigurationError):
        ingestion_url(result.model_dump())


def test_console_link_and_historical_model_do_not_require_new_write_validation() -> None:
    old = AliyunConfig(license_key="synthetic-key", endpoint="https://host.test/adapt_old/api/otlp/traces")
    assert old.endpoint == "https://host.test/adapt_old/api/otlp/traces"
    assert console_url() == "https://arms.console.aliyun.com/#/llm"


def test_historical_model_validation_does_not_format_sensitive_endpoint_inputs() -> None:
    secret = "SYNTHETIC_LICENSE_NOT_IN_ERRORS"
    with pytest.raises(ValidationError) as caught:
        AliyunConfig(license_key=secret, endpoint=f"ftp://host.test/adapt_{secret}/api/otlp/traces")
    rendered = str(caught.value) + repr(caught.value) + "".join(traceback.format_exception(caught.value))
    assert secret not in rendered


@dataclass
class CollectorBoundary:
    status: int = 200
    content: bytes = b'"success"'
    failure: Exception | None = None
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    responses: list[httpx.Response] = field(default_factory=list)


@pytest.fixture
def collector(monkeypatch: pytest.MonkeyPatch) -> CollectorBoundary:
    boundary = CollectorBoundary()

    def send(method: str, url: str, **options: object) -> httpx.Response:
        boundary.calls.append((method, url, dict(options)))
        if boundary.failure is not None:
            raise boundary.failure
        response = httpx.Response(boundary.status, content=boundary.content, request=httpx.Request(method, url))
        boundary.responses.append(response)
        return response

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Resource-only verification must not initialize a legacy exporter")

    monkeypatch.setattr(ssrf_proxy, "make_request", send)
    monkeypatch.setattr(AliyunDataTrace, "__init__", forbidden)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://ambient.test")
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=ambient-credential")
    return boundary


def test_verification_emits_one_resource_and_zero_business_spans(collector: CollectorBoundary) -> None:
    config = normalize_configuration(values(app_name="test_app", license_key="raw%2F@a+b/c"))
    verify_configuration(config)
    assert len(collector.calls) == 1
    method, url, options = collector.calls[0]
    assert method == "POST"
    assert url == "http://tracing-analysis-dc-qd.aliyuncs.com/adapt_raw%252F@a%2Bb%2Fc/api/otlp/traces"
    assert options["headers"] == {"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"}
    assert options["max_retries"] == 0
    assert options["follow_redirects"] is False
    body = options["content"]
    assert isinstance(body, bytes)
    assert body
    payload = ExportTraceServiceRequest.FromString(body)
    assert len(payload.resource_spans) == 1
    resource = payload.resource_spans[0]
    assert len(resource.scope_spans) == 0
    assert len(resource.resource.attributes) == 1
    assert resource.resource.attributes[0].key == "service.name"
    assert resource.resource.attributes[0].value.string_value == "test_app"
    assert collector.responses[0].is_closed


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (200, b""),
        (200, b"{}"),
        (200, b"success"),
        (200, b'"success"\n'),
        (200, b'{"ret":0}'),
        (200, b'"failure"'),
        (200, b"<html>private-response</html>"),
        (201, b'"success"'),
        (204, b""),
        (400, b"private-response"),
        (401, b"private-response"),
        (403, b"private-response"),
        (404, b"private-response"),
        (405, b"private-response"),
        (429, b"private-response"),
        (503, b"private-response"),
    ],
)
def test_only_the_observed_resource_ack_verifies_access(
    collector: CollectorBoundary, status: int, body: bytes, caplog: pytest.LogCaptureFixture
) -> None:
    collector.status = status
    collector.content = body
    with pytest.raises(AliyunConfigurationError) as error:
        verify_configuration(normalize_configuration(values(license_key="SYNTHETIC_PRIVATE_LICENSE@key")))
    assert error.value.code == "verification_failed"
    rendered = str(error.value) + repr(error.value) + "".join(traceback.format_exception(error.value)) + caplog.text
    assert "SYNTHETIC_PRIVATE_LICENSE" not in rendered
    assert "private-response" not in rendered
    assert len(collector.calls) == 1
    assert all(response.is_closed for response in collector.responses)


def test_transport_failure_does_not_escape_with_private_url(collector: CollectorBoundary) -> None:
    collector.failure = httpx.ConnectError("request failed at /adapt_PRIVATE%40KEY/api/otlp/traces")
    with pytest.raises(AliyunConfigurationError) as error:
        verify_configuration(normalize_configuration(values(license_key="PRIVATE@KEY")))
    assert error.value.code == "verification_failed"
    rendered = "".join(traceback.format_exception(error.value))
    assert "PRIVATE@KEY" not in rendered
    assert "PRIVATE%40KEY" not in rendered
    assert len(collector.calls) == 1
