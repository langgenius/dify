"""Official experiment schemas at a request-scoped, read-only HTTP boundary."""

from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
import pytest
from dify_trace_mlflow.config import DatabricksConfig
from dify_trace_mlflow.configuration import DatabricksConfigurationError, project_url, verify_configuration
from google.protobuf.json_format import MessageToDict
from mlflow.protos.service_pb2 import Experiment, GetExperiment

from core.helper import ssrf_proxy


def response(url: str, body: object, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", url))


@dataclass
class ExperimentAPI:
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    override: Callable[[str, str, dict[str, object]], httpx.Response] | None = None

    def get(self, url: str, **options: object) -> httpx.Response:
        self.calls.append(("GET", url, options))
        if self.override:
            return self.override("GET", url, options)
        assert url.endswith("/api/2.0/mlflow/experiments/get")
        params = options["params"]
        assert isinstance(params, dict)
        requested = GetExperiment(experiment_id=params["experiment_id"])
        return response(
            url,
            MessageToDict(
                GetExperiment.Response(
                    experiment=Experiment(experiment_id=requested.experiment_id, lifecycle_stage="active")
                ),
                preserving_proto_field_name=True,
            ),
        )

    def post(self, url: str, **options: object) -> httpx.Response:
        self.calls.append(("POST", url, options))
        assert url.endswith("/oidc/v1/token"), "configuration must never create experiments, runs or traces"
        if self.override:
            return self.override("POST", url, options)
        return response(url, {"access_token": "synthetic-oauth-token", "token_type": "Bearer", "expires_in": 3600})


@pytest.fixture
def experiment_api(monkeypatch: pytest.MonkeyPatch) -> ExperimentAPI:
    api = ExperimentAPI()
    monkeypatch.setattr(ssrf_proxy, "get", api.get)
    monkeypatch.setattr(ssrf_proxy, "post", api.post)
    return api


def test_pat_requests_are_isolated_and_read_only(experiment_api: ExperimentAPI) -> None:
    for host, token, experiment_id in [
        ("https://first.test/", "first-pat", "000123"),
        ("https://second.test", "second-pat", "456"),
    ]:
        config = DatabricksConfig(host=host, experiment_id=experiment_id, personal_access_token=token)
        result = verify_configuration(config)
        assert result.host == host.rstrip("/")
        assert result.experiment_id == experiment_id.lstrip("0")
        method, url, options = experiment_api.calls[-1]
        assert method == "GET"
        assert url == host.rstrip("/") + "/api/2.0/mlflow/experiments/get"
        assert options["headers"] == {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        assert options["max_retries"] == 0
        assert options["timeout"] == 30.0
        assert options["follow_redirects"] is False
    assert len(experiment_api.calls) == 2


def test_oauth_precedence_matches_exporter_without_reusing_pat(experiment_api: ExperimentAPI) -> None:
    config = DatabricksConfig(
        host="https://workspace.test",
        experiment_id="12",
        personal_access_token="unused-pat",
        client_id="synthetic-client",
        client_secret="synthetic-secret",
    )
    assert verify_configuration(config).experiment_id == "12"
    method, url, options = experiment_api.calls[0]
    assert method == "POST"
    assert url == "https://workspace.test/oidc/v1/token"
    assert options["auth"] == ("synthetic-client", "synthetic-secret")
    assert options["data"] == {"grant_type": "client_credentials", "scope": "all-apis"}
    assert "headers" not in options
    assert options["follow_redirects"] is False
    assert experiment_api.calls[1][2]["headers"] == {
        "Authorization": "Bearer synthetic-oauth-token",
        "Accept": "application/json",
    }


def test_incomplete_oauth_uses_explicit_pat_as_existing_exporter_does(experiment_api: ExperimentAPI) -> None:
    verify_configuration(
        DatabricksConfig(
            host="https://workspace.test", experiment_id="12", client_id="unused-client", personal_access_token="pat"
        )
    )
    assert len(experiment_api.calls) == 1
    assert experiment_api.calls[0][0] == "GET"
    assert experiment_api.calls[0][2]["headers"] == {"Authorization": "Bearer pat", "Accept": "application/json"}


def test_non_ascii_experiment_ids_are_not_sent(experiment_api: ExperimentAPI) -> None:
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(
            DatabricksConfig(host="https://workspace.test", experiment_id="１２", personal_access_token="pat")
        )
    assert caught.value.code == "invalid_experiment_id"
    assert experiment_api.calls == []


@pytest.mark.parametrize(
    "credentials",
    [
        {},
        {"client_id": "client"},
        {"client_secret": "secret"},
        {"personal_access_token": " "},
    ],
)
def test_missing_credentials_fail_before_vendor_io(experiment_api: ExperimentAPI, credentials: dict[str, str]) -> None:
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(DatabricksConfig(host="https://workspace.test", experiment_id="12", **credentials))
    assert caught.value.code == "authentication_failed"
    assert experiment_api.calls == []


@pytest.mark.parametrize(
    "host",
    [
        "http://workspace.test",
        "https://user:secret@workspace.test",
        "https://workspace.test/path",
        "https://workspace.test?o=1",
        "https://workspace.test/#/experiments/12",
        "https://workspace.test\\@evil.test",
        "https://workspace.test:\n443",
        "https://workspace.test:bad",
        "https://[invalid",
    ],
)
def test_invalid_workspace_origins_do_not_send_credentials(experiment_api: ExperimentAPI, host: str) -> None:
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(DatabricksConfig(host=host, experiment_id="12", personal_access_token="synthetic-key"))
    assert caught.value.code == "invalid_workspace_url"
    assert experiment_api.calls == []


def test_project_url_is_pure_and_supports_explicit_https_port(experiment_api: ExperimentAPI) -> None:
    config = DatabricksConfig(host=" https://Workspace.Example:443/ ", experiment_id="00012")
    assert project_url(config) == "https://Workspace.Example:443/ml/experiments/12/traces"
    assert experiment_api.calls == []


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (404, "experiment_not_found_or_inaccessible"),
        (302, "endpoint_unavailable"),
        (500, "endpoint_unavailable"),
    ],
)
def test_http_failures_are_safe_and_responses_are_closed(experiment_api: ExperimentAPI, status: int, code: str) -> None:
    result = response("https://workspace.test", {"message": "private-key-vendor-response"}, status)
    experiment_api.override = lambda _method, _url, _options: result
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(
            DatabricksConfig(host="https://workspace.test", experiment_id="12", personal_access_token="synthetic-key")
        )
    assert caught.value.code == code
    assert "private-key" not in str(caught.value)
    assert "synthetic-key" not in str(caught.value)
    assert result.is_closed


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({}, "malformed_response"),
        ([], "malformed_response"),
        ({"experiment": "invalid"}, "malformed_response"),
        ({"experiment": {"experiment_id": "other", "lifecycle_stage": "active"}}, "experiment_id_mismatch"),
        ({"experiment": {"experiment_id": "12", "lifecycle_stage": "deleted"}}, "experiment_not_active"),
        ({"experiment": {"experiment_id": "12"}}, "experiment_not_active"),
    ],
)
def test_response_must_identify_selected_active_experiment(
    experiment_api: ExperimentAPI, body: object, code: str
) -> None:
    experiment_api.override = lambda _method, url, _options: response(url, body)
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(
            DatabricksConfig(host="https://workspace.test", experiment_id="12", personal_access_token="synthetic-key")
        )
    assert caught.value.code == code


@pytest.mark.parametrize("body", [{}, {"access_token": ""}, {"access_token": "token", "token_type": "other"}])
def test_invalid_oauth_response_never_reaches_experiment_api(experiment_api: ExperimentAPI, body: object) -> None:
    experiment_api.override = lambda _method, url, _options: response(url, body)
    with pytest.raises(DatabricksConfigurationError, match="authentication failed"):
        verify_configuration(
            DatabricksConfig(
                host="https://workspace.test", experiment_id="12", client_id="client", client_secret="secret"
            )
        )
    assert len(experiment_api.calls) == 1


def test_transport_errors_do_not_disclose_request_details(experiment_api: ExperimentAPI) -> None:
    def fail(_method: str, _url: str, _options: dict[str, object]) -> httpx.Response:
        raise httpx.ConnectError("private-key-vendor-response")

    experiment_api.override = fail
    with pytest.raises(DatabricksConfigurationError) as caught:
        verify_configuration(
            DatabricksConfig(host="https://workspace.test", experiment_id="12", personal_access_token="synthetic-key")
        )
    assert caught.value.code == "connection_failed"
    assert "private-key" not in str(caught.value)
