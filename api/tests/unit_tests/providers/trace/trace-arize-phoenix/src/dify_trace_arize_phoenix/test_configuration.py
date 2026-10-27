"""Phoenix configuration verifies only a bounded project-list read, with isolated auth."""

import os
from collections import deque
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Never

import httpx
import pytest
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from dify_trace_arize_phoenix.config import PhoenixConfig
from dify_trace_arize_phoenix.configuration import (
    PhoenixConfigurationError,
    normalize_configuration,
    project_url,
    verify_configuration,
)

from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager


def response(body: object, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", "https://phoenix.test/v1/projects"))


@pytest.fixture(autouse=True)
def no_legacy_or_environment_auth(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    names = ("PHOENIX_API_KEY", "PHOENIX_PROJECT_NAME", "PHOENIX_COLLECTOR_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS")
    for name in names:
        monkeypatch.setenv(name, "synthetic-ambient-value")
    called: list[bool] = []

    def forbidden(*_args: object, **_kwargs: object) -> Never:
        called.append(True)
        raise AssertionError("Phoenix configuration must not initialize a tracer or write test spans")

    monkeypatch.setattr(ArizePhoenixDataTrace, "__init__", forbidden)
    monkeypatch.setattr(OpsTraceManager, "check_trace_config_is_effective", forbidden)
    monkeypatch.setattr(OpsTraceManager, "get_trace_config_project_url", forbidden)
    for method in ("post", "put", "patch", "delete"):
        monkeypatch.setattr(ssrf_proxy, method, forbidden)
    yield
    assert called == []
    assert all(os.environ[name] == "synthetic-ambient-value" for name in names)


@pytest.fixture
def api_responses() -> deque[httpx.Response | Exception]:
    return deque()


@pytest.fixture
def api_calls(
    monkeypatch: pytest.MonkeyPatch, api_responses: deque[httpx.Response | Exception]
) -> list[tuple[str, dict[str, object]]]:
    calls: list[tuple[str, dict[str, object]]] = []

    def get(url: str, **options: object) -> httpx.Response:
        calls.append((url, options))
        result = api_responses.popleft() if api_responses else response({"data": [], "next_cursor": None})
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(ssrf_proxy, "get", get)
    return calls


def test_normalization_preserves_prefix_and_does_not_mutate_input(
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    values = {"endpoint": " HTTP://Phoenix.TEST:6006/proxy/s/space/ ", "project": " project name ", "api_key": None}
    untouched = dict(values)
    config = normalize_configuration(values)
    result = verify_configuration(config)
    assert (result.endpoint, result.project) == ("http://phoenix.test:6006/proxy/s/space", "project name")
    assert values == untouched
    assert api_calls == [
        (
            "http://phoenix.test:6006/proxy/s/space/v1/projects",
            {
                "params": {"limit": 1},
                "headers": {"Accept": "application/json", "Accept-Encoding": "identity", "Cookie": ""},
                "auth": None,
                "timeout": 30.0,
                "max_retries": 0,
                "follow_redirects": False,
                "stream_response": True,
            },
        )
    ]


@pytest.mark.parametrize("key", [None, "", "synthetic-key"])
def test_optional_key_does_not_inherit_environment(
    api_calls: list[tuple[str, dict[str, object]]],
    key: str | None,
) -> None:
    result = verify_configuration(PhoenixConfig(endpoint="https://phoenix.test", project="not-created", api_key=key))
    assert result.project == "not-created"
    expected = {"Accept": "application/json", "Accept-Encoding": "identity", "Cookie": ""}
    if key:
        expected["Authorization"] = "Bearer synthetic-key"
    assert api_calls[0][1]["headers"] == expected
    assert len(api_calls) == 1


@pytest.mark.parametrize("project", [None, "", "   "])
def test_empty_project_uses_default(project: str | None, api_calls: list[tuple[str, dict[str, object]]]) -> None:
    config = normalize_configuration({"project": project})
    assert config.project == "default"
    assert project_url(config) == "https://app.phoenix.arize.com/redirects/projects/default"
    assert api_calls == []


def test_project_redirect_encodes_name_for_graphql_loader_without_io(
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    config = PhoenixConfig(endpoint="https://host.test:8443/s/space/", project="A /? & #中文")
    assert (
        project_url(config)
        == "https://host.test:8443/s/space/redirects/projects/A%20%2F%3F%20%26%20%23%E4%B8%AD%E6%96%87"
    )
    assert api_calls == []


@pytest.mark.parametrize(
    "endpoint",
    [
        "ftp://host.test",
        "https:///missing",
        "https://user:secret@host.test",
        "https://host.test?",
        "https://host.test#",
        "https://host.test/path?token=secret",
        "https://host.test/path#fragment",
        "https://host.test:bad",
        "https://host.test:0",
        "https://host.test:65536",
        "https://host.test:",
        "https://[invalid",
        "https://host.test\\@elsewhere",
        "\nhttps://host.test",
        "https://ho\nst.test",
        "https://host.test/a/../b",
        "https://host.test/a/%2e%2e/b",
        "https://host.test/a%2fb",
        "https://host.test/a%5cb",
        "https://host.test/a%252fb",
        "https://host.test//proxy",
        "https://host.test/%00",
        "https://host.test/%zz",
        "https://host.test/v1/traces",
        "https://host.test/s/space/v1/traces/",
        None,
    ],
)
def test_invalid_base_is_rejected_before_io(endpoint: object, api_calls: list[tuple[str, dict[str, object]]]) -> None:
    with pytest.raises(PhoenixConfigurationError) as caught:
        normalize_configuration({"endpoint": endpoint, "api_key": "private-secret"})
    assert caught.value.code == "invalid_endpoint"
    assert "private-secret" not in str(caught.value)
    assert api_calls == []


@pytest.mark.parametrize("project", ["bad\nname", "\tname", ".", "..", 123])
def test_invalid_project_is_rejected_before_io(project: object, api_calls: list[tuple[str, dict[str, object]]]) -> None:
    with pytest.raises(PhoenixConfigurationError) as caught:
        normalize_configuration({"project": project})
    assert caught.value.code == "invalid_project"
    assert api_calls == []


@pytest.mark.parametrize("key", ["   ", "line\nbreak", "invalid token", "******", "ab***cd"])
def test_header_or_mask_key_is_rejected_after_restore(key: str, api_calls: list[tuple[str, dict[str, object]]]) -> None:
    config = normalize_configuration({"api_key": key})
    with pytest.raises(PhoenixConfigurationError) as caught:
        verify_configuration(config)
    assert caught.value.code == "invalid_api_key"
    assert api_calls == []


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (302, "endpoint_unavailable"),
        (404, "endpoint_unavailable"),
        (500, "endpoint_unavailable"),
        (204, "endpoint_unavailable"),
    ],
)
def test_http_failures_are_safe_and_close_response(
    status: int,
    code: str,
    api_responses: deque[httpx.Response | Exception],
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    item = response({"private-vendor-detail": "private-secret"}, status)
    api_responses.append(item)
    with pytest.raises(PhoenixConfigurationError) as caught:
        verify_configuration(PhoenixConfig(api_key="private-secret"))
    assert caught.value.code == code
    assert "private-secret" not in str(caught.value)
    assert item.is_closed
    assert len(api_calls) == 1


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {},
        {"data": []},
        {"data": {}, "next_cursor": None},
        {"data": [], "next_cursor": 3},
        {"data": [None], "next_cursor": None},
        {"data": [{"id": "1"}], "next_cursor": None},
        {"data": [{"id": 1, "name": "x"}], "next_cursor": None},
        {"data": [{"id": "1", "name": ""}], "next_cursor": None},
        {"data": [{"id": "1", "name": "x", "description": {}}], "next_cursor": None},
    ],
)
def test_project_list_shape_is_validated(
    body: object,
    api_responses: deque[httpx.Response | Exception],
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    item = response(body)
    api_responses.append(item)
    with pytest.raises(PhoenixConfigurationError) as caught:
        verify_configuration(PhoenixConfig())
    assert caught.value.code == "malformed_response"
    assert item.is_closed
    assert len(api_calls) == 1


def test_existing_project_page_does_not_require_selected_project_or_follow_cursor(
    api_responses: deque[httpx.Response | Exception],
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    api_responses.append(
        response({"data": [{"id": "Project:1", "name": "other", "description": None}], "next_cursor": "opaque-cursor"})
    )
    assert verify_configuration(PhoenixConfig(project="new-project")).project == "new-project"
    assert len(api_calls) == 1


@pytest.mark.parametrize("kind", ["html", "gzip", "oversized"])
def test_wrong_path_html_compressed_and_oversized_responses_are_not_success(
    kind: str,
    api_responses: deque[httpx.Response | Exception],
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    content = b"x" * (1024 * 1024 + 1) if kind == "oversized" else b"<html>private-login-page</html>"
    item = httpx.Response(
        200, content=content, request=httpx.Request("GET", "https://host.test/not-a-collector/v1/projects")
    )
    if kind == "gzip":
        item.headers["Content-Encoding"] = "gzip"
    api_responses.append(item)
    with pytest.raises(PhoenixConfigurationError) as caught:
        verify_configuration(PhoenixConfig(endpoint="https://host.test/not-a-collector"))
    assert caught.value.code == "malformed_response"
    assert "private-login-page" not in str(caught.value)
    assert item.is_closed
    assert len(api_calls) == 1


def test_transport_error_does_not_leak_url_or_credentials(
    api_responses: deque[httpx.Response | Exception],
    api_calls: list[tuple[str, dict[str, object]]],
) -> None:
    api_responses.append(httpx.ReadTimeout("private-key in vendor response"))
    with pytest.raises(PhoenixConfigurationError) as caught:
        verify_configuration(PhoenixConfig(api_key="private-key"))
    assert caught.value.code == "connection_failed"
    assert "private-key" not in str(caught.value)
    assert caught.value.__suppress_context__
    assert len(api_calls) == 1


def test_concurrent_targets_and_credentials_remain_isolated(monkeypatch: pytest.MonkeyPatch) -> None:
    barrier = Barrier(2)
    requests: list[httpx.Request] = []
    targets = {
        "https://first.test/s/one/v1/projects?limit=1": "first-key",
        "https://second.test/reverse/v1/projects?limit=1": "second-key",
    }

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "GET"
        assert request.headers["Authorization"] == "Bearer " + targets[str(request.url)]
        barrier.wait(timeout=5)
        return httpx.Response(200, json={"data": [], "next_cursor": None})

    with httpx.Client(transport=httpx.MockTransport(handle), trust_env=False) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _ssl_verify_enabled: client)
        configs = [
            PhoenixConfig(endpoint="https://first.test/s/one", api_key="first-key", project="one"),
            PhoenixConfig(endpoint="https://second.test/reverse", api_key="second-key", project="two"),
        ]
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert [item.project for item in pool.map(verify_configuration, configs)] == ["one", "two"]
    assert sorted(str(request.url) for request in requests) == sorted(targets)


def test_real_proxy_client_has_no_ambient_auth_or_cookie_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert str(request.url) == "https://host.test/s/space/v1/projects?limit=1"
        assert request.headers["Cookie"] == ""
        return httpx.Response(
            200, headers={"Set-Cookie": "session=vendor; Path=/"}, json={"data": [], "next_cursor": None}
        )

    with httpx.Client(
        transport=httpx.MockTransport(handle),
        auth=httpx.BasicAuth("ambient", "secret"),
        cookies={"session": "ambient"},
        trust_env=False,
    ) as client:
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _ssl_verify_enabled: client)
        verify_configuration(PhoenixConfig(endpoint="https://host.test/s/space", api_key="explicit-key"))
        verify_configuration(PhoenixConfig(endpoint="https://host.test/s/space", api_key=None))
    assert requests[0].headers["Authorization"] == "Bearer explicit-key"
    assert "Authorization" not in requests[1].headers
    assert len(requests) == 2
