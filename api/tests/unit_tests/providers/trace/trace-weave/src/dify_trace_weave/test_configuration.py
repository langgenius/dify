"""Read-only Weave validation at the real config/schema and HTTP boundaries."""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import cast

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.configuration import (
    WeaveConfigurationError,
    console_url,
    project_url,
    verify_configuration,
)
from weave.trace_server.trace_server_interface import CallsQueryStatsReq

from core.helper import ssrf_proxy


def object_dict(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def response(url: str, body: object, *, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("POST", url))


@dataclass
class ReadAPI:
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)
    override: Callable[[str, dict[str, object]], httpx.Response] | None = None
    project_fields: dict[str, object] = field(default_factory=dict)
    project_exists: bool = True
    viewer_exists: bool = True
    count: object = 0

    def post(self, url: str, **options: object) -> httpx.Response:
        self.calls.append((url, options))
        body = object_dict(options["json"])
        if self.override is not None:
            return self.override(url, body)
        if url.endswith("/graphql"):
            query = body["query"]
            assert isinstance(query, str)
            assert "mutation" not in query
            if "DifyWeaveViewer" in query:
                return response(url, {"data": {"viewer": {"id": "viewer-id", "entity": "default-team"}}})
            variables = object_dict(body["variables"])
            project: dict[str, object] = {
                "id": "project-id",
                "name": variables["project"],
                "entityName": variables["entity"],
                "readOnly": False,
            }
            project.update(self.project_fields)
            return response(
                url,
                {
                    "data": {
                        "viewer": {"id": "viewer-id"} if self.viewer_exists else None,
                        "project": project if self.project_exists else None,
                    }
                },
            )
        assert url.endswith("/calls/query_stats")
        query_request = CallsQueryStatsReq.model_validate(body)
        assert query_request.limit == 1
        return response(url, {"count": self.count})


@pytest.fixture
def read_api(monkeypatch: pytest.MonkeyPatch) -> ReadAPI:
    api = ReadAPI()
    monkeypatch.setattr(ssrf_proxy, "post", api.post)
    return api


@pytest.mark.parametrize(
    ("entity", "project", "expected_entity", "requests"),
    [("team", "demo", "team", 2), (None, "team/demo", "team", 2), (None, "demo", "default-team", 3)],
)
def test_verify_resolves_project_with_request_scoped_authentication(
    read_api: ReadAPI, entity: str | None, project: str, expected_entity: str, requests: int
) -> None:
    result = verify_configuration(WeaveConfig(api_key="synthetic-key", entity=entity, project=project))
    assert result.entity == expected_entity
    assert result.project == "demo"
    assert result.project_url == f"https://wandb.ai/{expected_entity}/demo"
    assert len(read_api.calls) == requests
    for _url, options in read_api.calls:
        assert options["auth"] == ("api", "synthetic-key")
        assert options["max_retries"] == 0
        assert options["follow_redirects"] is False
        assert options["timeout"] == 30.0
    assert object_dict(read_api.calls[-1][1]["json"])["project_id"] == f"{expected_entity}/demo"


@pytest.mark.parametrize(
    ("entity", "project"),
    [
        ("team", ""),
        ("team", ".."),
        ("/", "demo"),
        (None, "/demo"),
        (None, "team/"),
        (None, "team/sub/demo"),
        ("other", "team/demo"),
        ("team", "de\\mo"),
    ],
)
def test_invalid_target_is_rejected_before_network(read_api: ReadAPI, entity: str | None, project: str) -> None:
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity=entity, project=project))
    assert caught.value.code == "invalid_project"
    assert read_api.calls == []


def test_private_endpoints_preserve_paths_and_encode_project_links(read_api: ReadAPI) -> None:
    config = WeaveConfig(
        api_key="synthetic-key",
        entity="team one",
        project="demo & notes#",
        host="http://wandb.internal/wandb/",
        endpoint="https://trace.internal/proxy/",
    )
    result = verify_configuration(config)
    assert result.project_url == "http://wandb.internal/wandb/team%20one/demo%20%26%20notes%23"
    assert [url for url, _options in read_api.calls] == [
        "http://wandb.internal/wandb/graphql",
        "https://trace.internal/proxy/calls/query_stats",
    ]


@pytest.mark.parametrize(
    "host", ["https://user:secret@host.test", "https://host.test/?secret=x", "https://host.test/#x"]
)
def test_unsafe_host_is_rejected_without_authentication_request(read_api: ReadAPI, host: str) -> None:
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo", host=host))
    assert caught.value.code == "invalid_endpoint"
    assert read_api.calls == []


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (302, "endpoint_unavailable"),
        (404, "endpoint_unavailable"),
        (429, "endpoint_unavailable"),
        (503, "endpoint_unavailable"),
    ],
)
def test_http_errors_are_sanitized_and_never_retried(read_api: ReadAPI, status: int, code: str) -> None:
    read_api.override = lambda url, _body: response(url, {"error": "never-log-secret"}, status=status)
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="never-log-secret", entity="team", project="demo"))
    assert caught.value.code == code
    assert "never-log-secret" not in str(caught.value)
    assert len(read_api.calls) == 1


@pytest.mark.parametrize(
    ("fields", "code"),
    [
        ({"readOnly": True}, "project_read_only"),
        ({"readOnly": None}, "project_permission_unknown"),
        ({"readOnly": "false"}, "malformed_response"),
        ({"id": ""}, "malformed_response"),
        ({"name": "other"}, "invalid_project"),
        ({"entityName": "other"}, "invalid_project"),
    ],
)
def test_project_permission_and_identity_are_checked(read_api: ReadAPI, fields: dict[str, object], code: str) -> None:
    read_api.project_fields = fields
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo"))
    assert caught.value.code == code
    assert len(read_api.calls) == 1


def test_missing_project_is_not_created(read_api: ReadAPI) -> None:
    read_api.project_exists = False
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo"))
    assert caught.value.code == "project_not_found_or_inaccessible"
    assert len(read_api.calls) == 1


def test_anonymous_viewer_cannot_validate_a_public_project(read_api: ReadAPI) -> None:
    read_api.viewer_exists = False
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo"))
    assert caught.value.code == "authentication_failed"


@pytest.mark.parametrize("count", [-1, True, "0", None])
def test_invalid_trace_endpoint_response_is_rejected(read_api: ReadAPI, count: object) -> None:
    read_api.count = count
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo"))
    assert caught.value.code == "malformed_response"
    assert len(read_api.calls) == 2


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"errors": [{"message": "never-log-secret"}]}, "graphql_error"),
        ({"errors": "never-log-secret"}, "malformed_response"),
        ({"data": []}, "malformed_response"),
        ({"data": {}}, "malformed_response"),
    ],
)
def test_graphql_errors_and_invalid_envelopes_are_rejected(
    read_api: ReadAPI, body: dict[str, object], code: str
) -> None:
    read_api.override = lambda url, _body: response(url, body)
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="never-log-secret", entity="team", project="demo"))
    assert caught.value.code == code
    assert "never-log-secret" not in str(caught.value)


def test_connection_failure_has_no_raw_exception_or_secret(read_api: ReadAPI) -> None:
    def fail(_url: str, _body: dict[str, object]) -> httpx.Response:
        raise httpx.ReadTimeout("never-log-secret")

    read_api.override = fail
    with pytest.raises(WeaveConfigurationError) as caught:
        verify_configuration(WeaveConfig(api_key="synthetic-key", entity="team", project="demo"))
    assert caught.value.code == "connection_failed"
    assert "never-log-secret" not in str(caught.value)
    assert caught.value.__cause__ is None


def test_sequential_tenants_use_only_their_supplied_credentials(read_api: ReadAPI) -> None:
    for tenant in ("a", "b"):
        verify_configuration(WeaveConfig(api_key=f"synthetic-{tenant}", entity=f"team-{tenant}", project="demo"))
    assert [options["auth"] for _url, options in read_api.calls] == [
        ("api", "synthetic-a"),
        ("api", "synthetic-a"),
        ("api", "synthetic-b"),
        ("api", "synthetic-b"),
    ]


def test_project_url_and_console_fallback_are_pure(read_api: ReadAPI) -> None:
    assert project_url(WeaveConfig(api_key="synthetic", project="demo")) is None
    assert project_url(WeaveConfig(api_key="synthetic", project="team/demo")) == "https://wandb.ai/team/demo"
    assert console_url(WeaveConfig(api_key="synthetic", project="demo")) == "https://wandb.ai"
    assert console_url(WeaveConfig(api_key="synthetic", project="demo", host="https://private.test/wandb")) == (
        "https://private.test/wandb"
    )
    assert read_api.calls == []
