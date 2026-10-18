"""OSS MLflow verification reads one experiment with isolated Basic credentials."""

import base64
import os
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Never

import httpx
import mlflow
import pytest
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowDataTrace
from dify_trace_mlflow.oss_configuration import (
    MLflowConfigurationError,
    normalize_configuration,
    project_url,
    verify_configuration,
)

from core.helper import ssrf_proxy
from tests.unit_tests.services.tracing.test_databricks_configuration import ExperimentAPI, response


@pytest.fixture(autouse=True)
def isolated_sdk_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    names = (
        "MLFLOW_TRACKING_URI",
        "MLFLOW_TRACKING_USERNAME",
        "MLFLOW_TRACKING_PASSWORD",
        "MLFLOW_TRACKING_TOKEN",
        "MLFLOW_EXPERIMENT_ID",
        "MLFLOW_ENABLE_ASYNC_TRACE_LOGGING",
        "DATABRICKS_HOST",
        "DATABRICKS_TOKEN",
    )
    for name in names:
        monkeypatch.setenv(name, "synthetic-ambient-value")
    forbidden_calls: list[str] = []

    def forbidden(name: str) -> Callable[..., Never]:
        def block(*_args: object, **_kwargs: object) -> Never:
            forbidden_calls.append(name)
            raise AssertionError("Configuration must not initialize an exporter or global SDK")

        return block

    monkeypatch.setattr(MLflowDataTrace, "__init__", forbidden("legacy_constructor"))
    for name in ("set_tracking_uri", "set_experiment", "search_experiments"):
        monkeypatch.setattr(mlflow, name, forbidden(name))
    monkeypatch.setattr(mlflow.config, "enable_async_logging", forbidden("async_logging"))
    yield
    assert forbidden_calls == []
    assert all(os.environ[name] == "synthetic-ambient-value" for name in names)


@pytest.fixture
def experiment_api(monkeypatch: pytest.MonkeyPatch) -> ExperimentAPI:
    api = ExperimentAPI()
    monkeypatch.setattr(ssrf_proxy, "get", api.get)

    def forbid_post(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("OSS verification must not create an experiment, run, trace, or session")

    monkeypatch.setattr(ssrf_proxy, "post", forbid_post)
    return api


def test_exact_experiment_and_path_prefix_use_only_explicit_basic_auth(experiment_api: ExperimentAPI) -> None:
    values = {
        "tracking_uri": " HTTP://FIRST.Example:5000/team/mlflow/ ",
        "experiment_id": "00012",
        "username": "first-user",
        "password": "first-password",
    }
    config = normalize_configuration(values)
    target = verify_configuration(config)
    assert target.tracking_uri == "http://first.example:5000/team/mlflow"
    assert target.experiment_id == "12"
    assert project_url(config) == "http://first.example:5000/team/mlflow/#/experiments/12/traces"
    method, url, options = experiment_api.calls[0]
    assert method == "GET"
    assert url == "http://first.example:5000/team/mlflow/api/2.0/mlflow/experiments/get"
    assert options["params"] == {"experiment_id": "12"}
    assert options["headers"] == {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Cookie": "",
        "Authorization": "Basic " + base64.b64encode(b"first-user:first-password").decode(),
    }
    assert options["follow_redirects"] is False
    assert options["stream_response"] is True
    assert options["timeout"] == 30.0
    assert options["max_retries"] == 0
    assert values["tracking_uri"].startswith(" HTTP")


def test_anonymous_request_does_not_inherit_previous_or_environment_credentials(experiment_api: ExperimentAPI) -> None:
    verify_configuration(
        MLflowConfig(tracking_uri="https://same.test", experiment_id="12", username="user", password="password")
    )
    verify_configuration(MLflowConfig(tracking_uri="https://same.test", experiment_id="34"))
    assert len(experiment_api.calls) == 2
    assert experiment_api.calls[1][2]["headers"] == {
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Cookie": "",
    }


def test_concurrent_destinations_keep_experiment_and_auth_together(experiment_api: ExperimentAPI) -> None:
    barrier = Barrier(2)
    expected_destinations = {
        "https://first.test/prefix/api/2.0/mlflow/experiments/get": ("first", "12"),
        "https://second.test/prefix/api/2.0/mlflow/experiments/get": ("second", "34"),
    }

    def read(_method: str, url: str, options: dict[str, object]) -> httpx.Response:
        params = options["params"]
        headers = options["headers"]
        assert isinstance(params, dict)
        assert isinstance(headers, dict)
        label, experiment_id = expected_destinations[url]
        assert params["experiment_id"] == experiment_id
        assert headers["Authorization"] == "Basic " + base64.b64encode(f"{label}:{label}-secret".encode()).decode()
        barrier.wait(timeout=5)
        return response(url, {"experiment": {"experiment_id": params["experiment_id"], "lifecycle_stage": "active"}})

    experiment_api.override = read
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [
            pool.submit(
                verify_configuration,
                MLflowConfig(
                    tracking_uri=f"https://{label}.test/prefix",
                    experiment_id=experiment,
                    username=label,
                    password=f"{label}-secret",
                ),
            )
            for label, experiment in (("first", "12"), ("second", "34"))
        ]
        assert [item.result().experiment_id for item in pending] == ["12", "34"]
    assert sorted(url for _method, url, _options in experiment_api.calls) == sorted(expected_destinations)


@pytest.mark.parametrize(
    "uri",
    [
        "",
        "ftp://server.test",
        "https:///missing",
        "https://user:secret@server.test",
        "https://@server.test",
        "https://server.test?",
        "https://server.test#",
        "https://server.test?key=secret",
        "https://server.test/#/experiments/1",
        "https://server.test:bad",
        "https://server.test:0",
        "https://server.test:",
        "https://[invalid",
        "https://server.test\\@other.test",
        "\nhttps://server.test",
        "https://ser\nver.test",
        "https://server.test/./prefix",
        "https://server.test/prefix/../other",
        "https://server.test/%2e%2e/other",
        "https://server.test/prefix%2fother",
        "https://server.test/%252fother",
        "https://server.test/%00",
        "https://server.test/%zz",
        "https://server.test//prefix",
    ],
)
def test_ambiguous_destinations_fail_before_request(experiment_api: ExperimentAPI, uri: str) -> None:
    with pytest.raises(ValueError):
        verify_configuration(normalize_configuration({"tracking_uri": uri, "experiment_id": "12"}))
    assert experiment_api.calls == []


@pytest.mark.parametrize("experiment", ["", "-1", "1.5", "１２", "abc"])
def test_experiment_ids_are_ascii_integer_identifiers(experiment_api: ExperimentAPI, experiment: str) -> None:
    with pytest.raises(ValueError):
        normalize_configuration({"tracking_uri": "https://server.test", "experiment_id": experiment})
    assert experiment_api.calls == []


@pytest.mark.parametrize(
    ("username", "password"),
    [("user", None), (None, "password"), ("user", ""), (" ", "password"), ("user", " "), ("user:name", "password")],
)
def test_partial_or_ambiguous_basic_auth_never_sends_credentials(
    experiment_api: ExperimentAPI, username: str | None, password: str | None
) -> None:
    with pytest.raises(MLflowConfigurationError) as caught:
        verify_configuration(MLflowConfig(tracking_uri="https://server.test", username=username, password=password))
    assert caught.value.code == "incomplete_basic_auth"
    assert experiment_api.calls == []


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (404, "experiment_not_found_or_inaccessible"),
        (302, "endpoint_unavailable"),
        (307, "endpoint_unavailable"),
        (500, "endpoint_unavailable"),
    ],
)
def test_http_failures_do_not_follow_redirect_or_disclose_body(
    experiment_api: ExperimentAPI, status: int, code: str
) -> None:
    result = response("https://server.test", {"message": "private-vendor-body"}, status)
    result.headers["Location"] = "https://other.test/secret"
    experiment_api.override = lambda _method, _url, _options: result
    with pytest.raises(MLflowConfigurationError) as caught:
        verify_configuration(
            MLflowConfig(tracking_uri="https://server.test", username="user", password="private-password")
        )
    assert caught.value.code == code
    assert "private" not in str(caught.value)
    assert result.is_closed
    assert len(experiment_api.calls) == 1


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({}, "malformed_response"),
        ([], "malformed_response"),
        ({"experiment": "invalid"}, "malformed_response"),
        ({"experiment": {"experiment_id": "34", "lifecycle_stage": "active"}}, "experiment_id_mismatch"),
        ({"experiment": {"experiment_id": "12", "lifecycle_stage": "deleted"}}, "experiment_not_active"),
        ({"experiment": {"experiment_id": "12"}}, "experiment_not_active"),
    ],
)
def test_response_must_match_exact_active_experiment(experiment_api: ExperimentAPI, body: object, code: str) -> None:
    experiment_api.override = lambda _method, url, _options: response(url, body)
    with pytest.raises(MLflowConfigurationError) as caught:
        verify_configuration(MLflowConfig(tracking_uri="https://server.test", experiment_id="12"))
    assert caught.value.code == code


def test_transport_failure_and_oversized_response_are_bounded_and_safe(experiment_api: ExperimentAPI) -> None:
    def fail(_method: str, _url: str, _options: dict[str, object]) -> httpx.Response:
        raise httpx.ConnectError("private-url-and-password")

    experiment_api.override = fail
    with pytest.raises(MLflowConfigurationError, match="MLflow verification request failed"):
        verify_configuration(MLflowConfig(tracking_uri="https://server.test"))
    oversized = response("https://server.test", {"message": "x" * (1024 * 1024)})
    experiment_api.override = lambda _method, _url, _options: oversized
    with pytest.raises(MLflowConfigurationError) as caught:
        verify_configuration(MLflowConfig(tracking_uri="https://server.test"))
    assert caught.value.code == "malformed_response"
    assert oversized.is_closed


def test_project_link_requires_no_auth_or_io_and_preserves_valid_prefix(experiment_api: ExperimentAPI) -> None:
    assert project_url(MLflowConfig(tracking_uri="https://Server.test/team/mlflow/", experiment_id="000")) == (
        "https://server.test/team/mlflow/#/experiments/0/traces"
    )
    assert experiment_api.calls == []


def test_real_http_transport_overrides_ambient_auth_and_cookies(monkeypatch: pytest.MonkeyPatch) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "GET"
        assert request.url.path == "/prefix/api/2.0/mlflow/experiments/get"
        assert request.headers.get("cookie") == ""
        return httpx.Response(
            200,
            headers={"Set-Cookie": "session=synthetic-vendor-session; Path=/"},
            json={"experiment": {"experiment_id": request.url.params["experiment_id"], "lifecycle_stage": "active"}},
        )

    with httpx.Client(
        transport=httpx.MockTransport(handle),
        auth=httpx.BasicAuth("ambient-user", "ambient-password"),
        cookies={"session": "synthetic-ambient-session"},
        trust_env=False,
    ) as client:

        def get_client(_ssl_verify_enabled: bool) -> httpx.Client:
            return client

        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", get_client)
        verify_configuration(
            MLflowConfig(
                tracking_uri="https://server.test/prefix", experiment_id="12", username="owner", password="secret"
            )
        )
        verify_configuration(MLflowConfig(tracking_uri="https://server.test/prefix", experiment_id="34"))
    assert len(requests) == 2
    assert requests[0].headers["authorization"] == "Basic " + base64.b64encode(b"owner:secret").decode()
    assert "authorization" not in requests[1].headers


@pytest.mark.parametrize("compressed", [False, True])
def test_invalid_encoding_or_json_response_is_closed(experiment_api: ExperimentAPI, compressed: bool) -> None:
    result = httpx.Response(200, content=b"private-vendor-text", request=httpx.Request("GET", "https://server.test"))
    if compressed:
        result.headers["Content-Encoding"] = "gzip"
    experiment_api.override = lambda _method, _url, _options: result
    with pytest.raises(MLflowConfigurationError) as caught:
        verify_configuration(MLflowConfig(tracking_uri="https://server.test"))
    assert caught.value.code == "malformed_response"
    assert "private-vendor-text" not in str(caught.value)
    assert result.is_closed
