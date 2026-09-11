"""AWS-authenticated exports sign the bytes sent, using only captured credentials."""

import hashlib
import hmac
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.deployment_auth import resolve_aws_credentials
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError
from core.ops.trace_data import CompletedTrace, TraceSource, TraceSpan


def check_signature(request: httpx.Request, owner: str, region: str) -> None:
    """Verify AWS's canonical request/HMAC against the final transport request."""
    authorization = request.headers["Authorization"]
    fields = dict(field.split("=", 1) for field in authorization.removeprefix("AWS4-HMAC-SHA256 ").split(", "))
    access_key, scope = fields["Credential"].split("/", 1)
    assert access_key == f"{owner}-key"
    assert scope.endswith(f"/{region}/execute-api/aws4_request")
    assert request.headers["X-Amz-Security-Token"] == f"{owner}-token"
    payload_hash = hashlib.sha256(request.content).hexdigest()
    assert request.headers["X-Amz-Content-SHA256"] == payload_hash
    signed_headers = fields["SignedHeaders"]
    assert signed_headers == "host;x-amz-content-sha256;x-amz-date;x-amz-security-token"
    canonical = "\n".join(
        (
            request.method,
            request.url.path,
            "&".join(sorted(request.url.query.decode().split("&"))),
            "".join(f"{name}:{request.headers[name]}\n" for name in signed_headers.split(";")),
            signed_headers,
            payload_hash,
        )
    )
    to_sign = "\n".join(
        ("AWS4-HMAC-SHA256", request.headers["X-Amz-Date"], scope, hashlib.sha256(canonical.encode()).hexdigest())
    )
    signing_key = f"AWS4{owner}-secret".encode()
    for part in scope.split("/"):
        signing_key = hmac.digest(signing_key, part.encode(), "sha256")
    assert fields["Signature"] == hmac.new(signing_key, to_sign.encode(), "sha256").hexdigest()


@pytest.mark.parametrize("flag", ["true", "TRUE", "1", "false", "FALSE", "0"])
def test_sigv4_flag_and_boto_profile_resolution(flag: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    credentials = tmp_path / "credentials"
    credentials.write_text("[test]\naws_access_key_id = profile-key\naws_secret_access_key = profile-secret\n")
    configuration = tmp_path / "config"
    configuration.write_text("[profile test]\nregion = eu-west-1\n")
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(credentials))
    monkeypatch.setenv("AWS_CONFIG_FILE", str(configuration))
    monkeypatch.setenv("AWS_PROFILE", "test")
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", flag)
    if flag.lower() in {"false", "0"}:
        monkeypatch.setattr("boto3.Session", Mock(side_effect=AssertionError("Unneeded AWS credential lookup")))
        assert resolve_aws_credentials() is None
    else:
        assert resolve_aws_credentials() == {
            "access_key": "profile-key",
            "secret_key": "profile-secret",
            "token": None,
            "region": "eu-west-1",
        }
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "environment-key")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "environment-secret")
        monkeypatch.setenv("AWS_DEFAULT_REGION", "us-west-2")
        assert resolve_aws_credentials() == {
            "access_key": "environment-key",
            "secret_key": "environment-secret",
            "token": None,
            "region": "us-west-2",
        }


def test_sigv4_configuration_errors_do_not_disclose_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", " true ")
    with pytest.raises(ValueError, match="^Invalid MLflow AWS SigV4 setting$"):
        resolve_aws_credentials()
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", "true")
    monkeypatch.setattr("boto3.Session", Mock(side_effect=ValueError("private credential path")))
    with pytest.raises(ValueError, match="^Cannot resolve MLflow AWS authentication$"):
        resolve_aws_credentials()


def test_sigv4_signs_verification_otlp_and_artifacts_with_owned_captured_credentials(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("DEBUG", logger="botocore.auth")
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", "true")
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes-namespaced")
    monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "unused-bearer")
    config = {"tracking_uri": "https://mlflow.example/prefix", "username": "saved", "password": "unused-basic"}
    settings = []
    traces = []
    for owner, region in (("first", "us-east-1"), ("second", "eu-west-1")):
        for key, value in {
            "AWS_ACCESS_KEY_ID": f"{owner}-key",
            "AWS_SECRET_ACCESS_KEY": f"{owner}-secret",
            "AWS_SESSION_TOKEN": f"{owner}-token",
            "AWS_DEFAULT_REGION": region,
            "MLFLOW_WORKSPACE": f"{owner}-workspace",
        }.items():
            monkeypatch.setenv(key, value)
        settings.append(resolve_provider_config("mlflow", config))
        now = datetime.now(UTC)
        root = TraceSpan(span_id="root", span_name="Workflow", span_type="workflow", started_at=now, ended_at=now)
        traces.append(
            CompletedTrace(
                source=TraceSource(tenant_id=str(uuid4()), operation_id=str(uuid4()), app_id=str(uuid4())),
                trace_id=str(uuid4()),
                root_span_id="root",
                spans=(root,),
            )
        )
    assert traces[0].source.tenant_id != traces[1].source.tenant_id
    assert settings[0] != settings[1]
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Snapshot reread")))
    monkeypatch.setattr("boto3.Session", Mock(side_effect=AssertionError("Ambient AWS credential lookup")))
    first, second = (MLflowTraceClient("mlflow", setting) for setting in settings)
    requests: list[httpx.Request] = []
    reject_next = False
    request_barrier: Barrier | None = None

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal reject_next
        requests.append(request)
        if request_barrier is not None:
            request_barrier.wait(timeout=5)
        if reject_next:
            reject_next = False
            return httpx.Response(503)
        return httpx.Response(404 if request.method == "GET" and "/api/3.0/" in request.url.path else 200)

    monkeypatch.setattr(
        "core.ops.provider_export.ssrf_proxy.create_http_client",
        lambda *, ssl_context=None: httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True),
    )
    times = [datetime(2026, 9, 11, tzinfo=UTC) + timedelta(seconds=index) for index in range(20)]
    monkeypatch.setattr("dify_trace_mlflow.deployment_auth.datetime", Mock(now=Mock(side_effect=times)))
    first.verify_credentials()
    second.export_trace(traces[1])
    first._upload_mlflow_artifact("mlflow-artifacts:/trace", b'{"spans":[]}')
    reject_next = True
    with pytest.raises(TraceExportError, match="provider_http_503"):
        second.verify_credentials()
    second.verify_credentials()
    second._upload_mlflow_artifact("https://artifacts.example/trace?signature=own", b"{}")
    for index, request in enumerate(requests[:-1]):
        owner = "first" if index in {0, 4} else "second"
        check_signature(request, owner, "us-east-1" if owner == "first" else "eu-west-1")
        assert request.headers["X-MLFLOW-WORKSPACE"] == f"{owner}-workspace"
    assert requests[0].url.query == b"experiment_id=0"
    assert requests[3].url.path == "/prefix/v1/traces"
    assert requests[3].content
    assert requests[4].method == "PUT"
    assert requests[-3].headers["X-Amz-Date"] != requests[-2].headers["X-Amz-Date"]
    assert not any(
        name.lower().startswith("x-amz-") or name.lower() == "authorization" for name in requests[-1].headers
    )
    assert "X-MLFLOW-WORKSPACE" not in requests[-1].headers

    request_barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        calls = [executor.submit(client.verify_credentials) for client in (first, second)]
        assert all(call.result(timeout=10) for call in calls)
    assert {request.headers["X-MLFLOW-WORKSPACE"] for request in requests[-2:]} == {
        "first-workspace",
        "second-workspace",
    }
    for request in requests[-2:]:
        owner = request.headers["X-MLFLOW-WORKSPACE"].removesuffix("-workspace")
        check_signature(request, owner, "us-east-1" if owner == "first" else "eu-west-1")
    assert "first-token" not in caplog.text
    assert "second-secret" not in caplog.text


def test_disabled_sigv4_snapshot_does_not_adopt_later_aws_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = resolve_provider_config("mlflow", {"tracking_uri": "http://mlflow.example"})
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", "true")
    monkeypatch.setattr("boto3.Session", Mock(side_effect=AssertionError("Snapshot reread")))
    client = MLflowTraceClient("mlflow", settings)
    with pytest.MonkeyPatch.context() as patch:
        send = Mock(return_value=httpx.Response(200))
        patch.setattr("core.ops.provider_export.ssrf_proxy.make_request", send)
        client.verify_credentials()
    assert "auth" not in send.call_args.kwargs
