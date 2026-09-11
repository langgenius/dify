import base64
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_langsmith.config import LangSmithConfig
from dify_trace_langsmith.langsmith_trace import LangSmithTraceClient
from requests import Request, Session

from core.ops.provider_config import provider_config_identity, resolve_provider_config
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.mark.parametrize(
    ("userinfo", "netrc_text", "credentials"),
    [
        ("", None, None),
        ("url-user:url-password@", None, "url-user:url-password"),
        ("user%40example:p%3Aa%25ss@", None, "user@example:p:a%ss"),
        ("caf%C3%A9:p%C3%A4ss@", None, "café:päss"),
        (
            "url-user:url-password@",
            "machine langsmith.example login netrc-user password netrc-password\n",
            "netrc-user:netrc-password",
        ),
        (
            "",
            "machine langsmith.example account netrc-account password netrc-password\n",
            "netrc-account:netrc-password",
        ),
        ("url-user:url-password@", "machine other.example login other password secret\n", "url-user:url-password"),
        ("url-user:url-password@", "invalid netrc contents", "url-user:url-password"),
    ],
)
def test_requests_authentication_reaches_every_native_request_without_url_credentials(
    userinfo: str,
    netrc_text: str | None,
    credentials: str | None,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if netrc_text is not None:
        (tmp_path / "netrc").write_text(netrc_text)
    monkeypatch.setattr(Session, "send", Mock(side_effect=AssertionError("request preparation sent HTTP")))
    monkeypatch.setattr(
        Session,
        "merge_environment_settings",
        Mock(side_effect=AssertionError("request preparation read transport settings")),
    )
    config = {
        "api_key": "saved-api-key",
        "project": "project",
        "endpoint": f"https://{userinfo}langsmith.example:8443/prefix/api",
    }
    with Session() as session:
        native = session.prepare_request(Request("GET", config["endpoint"], headers={"x-api-key": "saved-api-key"}))
    expected = "Basic " + base64.b64encode(credentials.encode("latin-1")).decode() if credentials else None
    assert native.headers.get("Authorization") == expected
    captured = json.loads(json.dumps(resolve_provider_config("langsmith", config)))
    assert captured["_runtime_settings"]["authorization"] == expected
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers.get("Authorization") == expected
        assert request.headers["x-api-key"] == native.headers["x-api-key"]
        assert not request.url.username
        assert not request.url.password
        return httpx.Response(200, json=[{"id": "project-id", "tenant_id": "workspace-id"}])

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    client = LangSmithTraceClient(captured)
    assert client.config.endpoint == client.http.endpoint == "https://langsmith.example:8443/prefix/api"
    assert client.verify_credentials()
    assert client.get_project_url() == "https://langsmith.example:8443/prefix/o/workspace-id/projects/p/project-id"
    trace = make_completed_trace()
    assert len(client.export_trace(trace).spans) == len(trace.spans)
    assert len(requests) == 2 + len(trace.spans)


@pytest.mark.parametrize("filename", [".netrc", "_netrc"])
def test_requests_default_netrc_file_is_captured(
    filename: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / filename).write_text("machine langsmith.example login user password password\n")
    monkeypatch.delenv("NETRC")
    monkeypatch.setattr("os.path.expanduser", lambda value: str(tmp_path / value.removeprefix("~/")))
    captured = LangSmithConfig.load_runtime_settings(
        {"api_key": "saved-key", "project": "project", "endpoint": "https://langsmith.example"}
    )
    assert captured["authorization"] == "Basic " + base64.b64encode(b"user:password").decode()


def test_captured_authentication_binds_identity_and_isolates_concurrent_tenants(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configs = []
    traces = [make_completed_trace(), make_completed_trace()]
    for owner in ("first", "second"):
        netrc = tmp_path / f"{owner}.netrc"
        netrc.write_text(f"machine langsmith.example login {owner} password {owner}-password\n")
        monkeypatch.setenv("NETRC", str(netrc))
        configs.append(
            json.loads(
                json.dumps(
                    resolve_provider_config(
                        "langsmith",
                        {"api_key": "same-api-key", "project": "project", "endpoint": "https://langsmith.example"},
                    )
                )
            )
        )
        netrc.unlink()
    assert provider_config_identity("langsmith", configs[0]) != provider_config_identity("langsmith", configs[1])
    monkeypatch.setattr(Session, "prepare_request", Mock(side_effect=AssertionError("credentials reread")))
    monkeypatch.setattr(LangSmithConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    entered = Barrier(2)
    seen_auth: set[str] = set()
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        authorization = request.headers["Authorization"]
        if authorization not in seen_auth:
            seen_auth.add(authorization)
            entered.wait(timeout=5)
        requests.append(request)
        return httpx.Response(202, json={})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    with ThreadPoolExecutor(2) as pool:
        jobs = [
            pool.submit(LangSmithTraceClient(config).export_trace, trace)
            for config, trace in zip(configs, traces, strict=True)
        ]
        assert all(job.result(timeout=5).spans for job in jobs)
    for request in requests:
        owner = 0 if request.headers["Authorization"] == configs[0]["_runtime_settings"]["authorization"] else 1
        assert request.headers["Authorization"] == configs[owner]["_runtime_settings"]["authorization"]
        assert request.headers["x-api-key"] == "same-api-key"
        metadata = json.loads(request.content)["post"][0]["extra"]["metadata"]
        assert metadata["dify.tenant_id"] == traces[owner].source.tenant_id


def test_snapshot_without_basic_auth_does_not_inherit_worker_netrc(tmp_path: Path) -> None:
    config = {"api_key": "key", "project": "project", "endpoint": "https://langsmith.example"}
    captured = json.loads(json.dumps(resolve_provider_config("langsmith", config)))
    (tmp_path / "netrc").write_text("machine langsmith.example login worker password worker-password\n")
    changed = resolve_provider_config("langsmith", config)
    assert provider_config_identity("langsmith", captured) != provider_config_identity("langsmith", changed)
    assert "Authorization" not in LangSmithTraceClient(captured).http.headers
