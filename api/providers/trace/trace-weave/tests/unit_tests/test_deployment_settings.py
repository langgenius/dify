import base64
import json
import ssl
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.weave_trace import WeaveTraceClient

from core.ops.provider_config import resolve_provider_config
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def test_destination_and_entity_keep_environment_and_file_defaults(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config_dir = tmp_path / "global"
    config_dir.mkdir()
    (config_dir / "settings").write_text("[default]\nbase_url=https://global.example\n")
    local_dir = tmp_path / "wandb"
    local_dir.mkdir()
    (local_dir / "settings").write_text("[default]\nbase_url=https://local.example\n")
    monkeypatch.setenv("WANDB_CONFIG_DIR", str(config_dir))
    config = {"api_key": "saved-key", "project": "project"}
    assert WeaveTraceClient(config).http.endpoint == "https://local.example/traces"
    monkeypatch.setenv("WANDB_BASE_URL", "https://account.example/")
    monkeypatch.setenv("WANDB_ENTITY", "env-team")
    client = WeaveTraceClient(config)
    assert client.config.host == "https://account.example"
    assert client.http.endpoint == "https://account.example/traces"
    assert client._project_id() == "env-team/project"
    monkeypatch.setenv("WANDB_PUBLIC_BASE_URL", "https://public.example/")
    assert WeaveTraceClient(config).http.endpoint == "https://public.example/traces"
    monkeypatch.setenv("WF_TRACE_SERVER_URL", "https://ingest.example/")
    assert WeaveTraceClient(config).http.endpoint == "https://ingest.example"
    saved = WeaveTraceClient(
        {
            **config,
            "host": "https://saved-account.example",
            "endpoint": "https://saved-ingest.example",
            "entity": "saved-team",
        }
    )
    assert saved.config.host == "https://saved-account.example"
    assert saved.http.endpoint == "https://saved-ingest.example"
    assert saved._project_id() == "saved-team/project"
    assert WeaveTraceClient({**config, "project": "qualified-team/project"})._project_id() == "qualified-team/project"


def test_authorized_destination_is_used_for_discovery_and_export(monkeypatch: pytest.MonkeyPatch) -> None:
    config = {"api_key": "saved-key", "project": "project"}
    monkeypatch.setenv("WANDB_BASE_URL", "https://first-account.example")
    monkeypatch.setenv("WF_TRACE_SERVER_URL", "https://first-ingest.example")
    first = resolve_provider_config("weave", config)
    monkeypatch.setenv("WANDB_BASE_URL", "https://second-account.example")
    monkeypatch.setenv("WF_TRACE_SERVER_URL", "https://second-ingest.example")
    second = resolve_provider_config("weave", config)
    assert first != second
    monkeypatch.setattr(WeaveConfig, "load_runtime_settings", Mock(side_effect=AssertionError("snapshot reread")))
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"viewer": {"entity": "account-team"}}})

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context: httpx.Client(
            verify=ssl_context, transport=httpx.MockTransport(respond), trust_env=False
        ),
    )
    first_client, second_client = WeaveTraceClient(first), WeaveTraceClient(second)
    assert first_client.verify_credentials()
    second_client.export_trace(make_completed_trace())
    assert [request.url.host for request in requests] == [
        "first-account.example",
        "first-ingest.example",
        "second-account.example",
        "second-ingest.example",
        "second-ingest.example",
        "second-ingest.example",
    ]
    assert first_client.config.host == "https://first-account.example"


@pytest.mark.parametrize("ca_setting", ["SSL_CERT_FILE", "SSL_CERT_DIR"])
def test_weave_snapshots_trace_and_account_tls_separately(
    ca_setting: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    certificate = tmp_path / "01234567.0"
    certificate.write_bytes(b"trace CA")
    account_certificate = tmp_path / "account.pem"
    account_certificate.write_bytes(b"account CA")
    monkeypatch.setenv(ca_setting, str(certificate if ca_setting == "SSL_CERT_FILE" else tmp_path))
    monkeypatch.setenv("REQUESTS_CA_BUNDLE", str(account_certificate))
    config = {"api_key": "key", "project": "project"}
    captured = WeaveConfig.load_runtime_settings(config)
    if ca_setting == "SSL_CERT_FILE":
        assert base64.b64decode(captured["tls"]["certificate"]) == b"trace CA"
    else:
        assert base64.b64decode(json.loads(captured["tls"]["certificate_directory"])[certificate.name]) == b"trace CA"
    assert base64.b64decode(captured["account_tls"]["certificate"]) == b"account CA"
    certificate.unlink()
    account_certificate.unlink()
    trace_tls, account_tls = ssl.create_default_context(), ssl.create_default_context()
    build_context = Mock(side_effect=[account_tls, trace_tls])
    monkeypatch.setattr("dify_trace_weave.weave_trace.create_ssl_context", build_context)
    client = WeaveTraceClient({**config, "_runtime_settings": captured})
    assert client.http.ssl_context is trace_tls
    assert client.account_ssl_context is account_tls
    assert build_context.call_args_list[0].args == (captured["account_tls"],)
    assert build_context.call_args_list[1].args == (captured["tls"],)


@pytest.mark.parametrize(("setting", "verify"), [("true", False), ("TRUE", False), ("false", True), ("1", True)])
def test_weave_keeps_explicit_tls_switch_semantics(setting: str, verify: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEAVE_INSECURE_DISABLE_SSL", setting)
    client = WeaveTraceClient({"api_key": "key", "project": "project"})
    assert client.http.ssl_context is not None
    assert client.http.ssl_context.check_hostname is verify
    if verify:
        assert client.http.ssl_context.verify_mode == ssl.CERT_REQUIRED
    else:
        assert client.http.ssl_context.verify_mode == ssl.CERT_NONE
