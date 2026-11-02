"""Opik auth contracts at the read-only HTTP boundary, without SDK streamers."""

from collections.abc import Callable
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from dify_trace_opik.config import OpikConfig
from dify_trace_opik.configuration import OpikConfigurationError, console_url, project_url, verify_configuration

from core.helper import ssrf_proxy


@dataclass
class AccessAPI:
    calls: list[tuple[str, str, dict[str, object]]] = field(default_factory=list)
    default_workspace: object = "resolved-team"
    override: Callable[[str, str, dict[str, object]], httpx.Response] | None = None

    def request(self, method: str, url: str, **options: object) -> httpx.Response:
        self.calls.append((method, url, options))
        if self.override:
            return self.override(method, url, options)
        request = httpx.Request(method, url)
        if method == "POST":
            assert url.endswith("/v1/private/auth"), "configuration must never create projects, spans or traces"
            assert options["json"] == {}
            return httpx.Response(204, request=request)
        assert method == "GET"
        assert url.endswith("/v1/private/auth/workspace")
        return httpx.Response(200, json={"workspace_name": self.default_workspace}, request=request)


@pytest.fixture
def access_api(monkeypatch: pytest.MonkeyPatch) -> AccessAPI:
    api = AccessAPI()
    monkeypatch.setattr(ssrf_proxy, "make_request", api.request)
    return api


def test_named_workspaces_use_isolated_auth_without_default_lookup(access_api: AccessAPI) -> None:
    for host, key, workspace in [
        ("https://first.test/opik/api/", "first-key", "first-team"),
        ("https://second.test/api/", "second-key", "second-team"),
    ]:
        result = verify_configuration(OpikConfig(api_key=key, workspace=workspace, project="not-created", url=host))
        assert (result.url, result.workspace, result.project) == (host, workspace, "not-created")
        method, url, options = access_api.calls[-1]
        assert method == "POST"
        assert url == host + "v1/private/auth"
        assert options["headers"] == {
            "Authorization": key,
            "Comet-Workspace": workspace,
            "Accept": "application/json",
        }
        assert options["json"] == {}
        assert options["max_retries"] == 0
        assert options["follow_redirects"] is False
        assert options["timeout"] == 30.0
    assert len(access_api.calls) == 2


@pytest.mark.parametrize("workspace", [None, "", "default", " default "])
def test_default_workspace_is_resolved_only_during_verification(access_api: AccessAPI, workspace: str | None) -> None:
    result = verify_configuration(OpikConfig(api_key="synthetic-key", workspace=workspace))
    assert result.workspace == "resolved-team"
    assert result.project == "Default Project"
    assert [method for method, _, _ in access_api.calls] == ["POST", "GET"]
    assert access_api.calls[1][2]["headers"] == access_api.calls[0][2]["headers"]


@pytest.mark.parametrize("key", [None, ""])
def test_keyless_self_host_does_not_fall_back_to_environment(
    access_api: AccessAPI, monkeypatch: pytest.MonkeyPatch, key: str | None
) -> None:
    monkeypatch.setenv("OPIK_API_KEY", "unrelated-global-key")
    monkeypatch.setenv("OPIK_WORKSPACE", "unrelated-global-team")
    monkeypatch.setenv("OPIK_URL_OVERRIDE", "https://unrelated.test/api/")
    result = verify_configuration(OpikConfig(api_key=key, workspace="local", url="http://selfhost.test:5173/api/"))
    assert result.url == "http://selfhost.test:5173/api/"
    assert access_api.calls[0][2]["headers"] == {"Comet-Workspace": "local", "Accept": "application/json"}
    assert len(access_api.calls) == 1


@pytest.mark.parametrize(
    "url",
    [
        "https://user:password@private.test/api/",
        "https://private.test:invalid/api/",
        "http:///api/",
        "https://private.test/api/?next=/api/",
        "https://private.test/api/#/api/",
        "https://private.test/with space/api/",
        "https://private.test/back\\slash/api/",
    ],
)
def test_invalid_destination_is_rejected_before_sending_credentials(access_api: AccessAPI, url: str) -> None:
    with pytest.raises(OpikConfigurationError) as error:
        verify_configuration(OpikConfig(api_key="private-key", url=url))
    assert error.value.code == "invalid_endpoint"
    assert access_api.calls == []
    assert "private-key" not in str(error.value)


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_failed"),
        (403, "permission_denied"),
        (302, "endpoint_unavailable"),
        (500, "endpoint_unavailable"),
    ],
)
def test_auth_failures_are_sanitized(access_api: AccessAPI, status: int, code: str) -> None:
    access_api.override = lambda method, url, _options: httpx.Response(
        status, text="private-vendor-error", request=httpx.Request(method, url)
    )
    with pytest.raises(OpikConfigurationError) as error:
        verify_configuration(OpikConfig(api_key="private-key", workspace="team"))
    assert error.value.code == code
    assert "private" not in str(error.value)
    assert len(access_api.calls) == 1


def test_auth_html_success_is_not_a_verified_workspace(access_api: AccessAPI) -> None:
    access_api.override = lambda method, url, _options: httpx.Response(
        200, text="<html>Login</html>", request=httpx.Request(method, url)
    )
    with pytest.raises(OpikConfigurationError, match="invalid response"):
        verify_configuration(OpikConfig(workspace="team"))


@pytest.mark.parametrize("workspace", [None, "", " ", 123, []])
def test_default_workspace_response_requires_a_name(access_api: AccessAPI, workspace: object) -> None:
    access_api.default_workspace = workspace
    with pytest.raises(OpikConfigurationError) as error:
        verify_configuration(OpikConfig())
    assert error.value.code == "malformed_response"


def test_connection_error_never_exposes_request_or_key(access_api: AccessAPI) -> None:
    def fail(method: str, url: str, _options: dict[str, object]) -> httpx.Response:
        raise httpx.ReadTimeout("private-key in vendor detail", request=httpx.Request(method, url))

    access_api.override = fail
    with pytest.raises(OpikConfigurationError) as error:
        verify_configuration(OpikConfig(api_key="private-key"))
    assert error.value.code == "connection_failed"
    assert "private-key" not in str(error.value)


def test_project_url_uses_configured_host_and_encodes_names_without_network(access_api: AccessAPI) -> None:
    config = OpikConfig(url="https://private.test:7443/prefix/api/", workspace="team/name", project="A & B/? 中文")
    url = project_url(config)
    assert url is not None
    parsed = urlsplit(url)
    assert parsed.netloc == "private.test:7443"
    assert parsed.path == "/prefix/team%2Fname/redirect/projects"
    assert parse_qs(parsed.query) == {"name": ["A & B/? 中文"]}
    assert access_api.calls == []


@pytest.mark.parametrize("workspace", [None, "", "default"])
def test_historical_default_workspace_get_has_a_pure_console_fallback(
    access_api: AccessAPI, workspace: str | None
) -> None:
    config = OpikConfig(url="http://selfhost.test:5173/prefix/api/", workspace=workspace)
    assert project_url(config) is None
    assert console_url(config) == "http://selfhost.test:5173/prefix/"
    assert access_api.calls == []


@pytest.mark.parametrize(
    ("workspace", "project", "code"),
    [
        ("..", "ok", "invalid_workspace"),
        ("bad\nworkspace", "ok", "invalid_workspace"),
        ("team", "bad\nproject", "invalid_project"),
    ],
)
def test_invalid_names_cannot_escape_the_console_path_or_headers(
    access_api: AccessAPI, workspace: str, project: str, code: str
) -> None:
    with pytest.raises(OpikConfigurationError) as error:
        verify_configuration(OpikConfig(workspace=workspace, project=project))
    assert error.value.code == code
    assert access_api.calls == []
