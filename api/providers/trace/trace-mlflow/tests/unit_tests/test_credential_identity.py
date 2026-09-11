"""Renewed deployment credentials retain their source-bound trace destination."""

import base64
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import pytest
from botocore.client import BaseClient
from botocore.credentials import RefreshableCredentials
from dify_trace_mlflow import deployment_auth
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from sqlalchemy.orm import Session

from configs import dify_config
from core.ops import trace_source
from models.account import Tenant
from models.model import App, AppMode, TraceAppConfig

pytestmark = pytest.mark.parametrize("sqlite3_session", [(Tenant, App, TraceAppConfig)], indirect=True)


@pytest.fixture
def trace_owner(sqlite3_session: Session, monkeypatch: pytest.MonkeyPatch) -> tuple[Tenant, App, TraceAppConfig]:
    monkeypatch.setattr("extensions.ext_database.db", SimpleNamespace(engine=sqlite3_session.bind))
    monkeypatch.setattr(trace_source, "_enterprise_config", lambda: None)
    monkeypatch.setattr(dify_config, "SECRET_KEY", "credential-identity-test-key")
    tenant = Tenant(name="credential owner")
    sqlite3_session.add(tenant)
    sqlite3_session.flush()
    app = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="MLflow tracing app",
        enable_site=True,
        enable_api=True,
        mode=AppMode.CHAT,
        tracing=json.dumps({"enabled": True, "tracing_provider": "mlflow"}),
    )
    sqlite3_session.add(app)
    sqlite3_session.flush()
    config = TraceAppConfig(
        app_id=app.id,
        tracing_provider="mlflow",
        tracing_config={"tracking_uri": "http://mlflow.example", "experiment_id": "1"},
    )
    sqlite3_session.add(config)
    sqlite3_session.commit()
    return tenant, app, config


@pytest.fixture
def assume_role_source(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path, list[dict[str, Any]]]:
    configuration = tmp_path / "aws-config"
    configuration.write_text(
        "[profile trace]\nregion = us-east-1\nrole_arn = arn:aws:iam::123456789012:role/trace\n"
        "role_session_name = dify-tracing\nsource_profile = source\n"
    )
    credentials = tmp_path / "aws-credentials"
    credentials.write_text(
        "[source]\naws_access_key_id = source-key\naws_secret_access_key = source-secret\n"
        "[other]\naws_access_key_id = other-key\naws_secret_access_key = other-secret\n"
    )
    for name, value in {
        "MLFLOW_TRACKING_AWS_SIGV4": "true",
        "AWS_CONFIG_FILE": str(configuration),
        "AWS_SHARED_CREDENTIALS_FILE": str(credentials),
        "AWS_PROFILE": "trace",
        "AWS_EC2_METADATA_DISABLED": "true",
    }.items():
        monkeypatch.setenv(name, value)
    calls: list[dict[str, Any]] = []

    def issue_credentials(_client: BaseClient, operation: str, parameters: dict[str, Any]) -> dict[str, Any]:
        assert operation == "AssumeRole"
        calls.append(parameters)
        return {
            "Credentials": {
                "AccessKeyId": f"renewed-key-{len(calls)}",
                "SecretAccessKey": f"renewed-secret-{len(calls)}",
                "SessionToken": f"renewed-token-{len(calls)}",
                "Expiration": datetime.now(UTC) + timedelta(hours=1),
            }
        }

    monkeypatch.setattr(BaseClient, "_make_api_call", issue_credentials)
    return configuration, credentials, calls


def test_assume_role_renewal_passes_real_destination_revalidation(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    assume_role_source: tuple[Path, Path, list[dict[str, Any]]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant, app, config = trace_owner
    _, _, calls = assume_role_source
    environment = dict(os.environ)
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    resolved = trace_source.load_trace_provider_config(captured)
    assert len(calls) == 2
    assert resolved["_runtime_settings"]["aws_sigv4"]["token"] == "renewed-token-2"
    assert trace_source.get_trace_provider_settings(tenant.id, app.id)[0] == captured
    assert config.tracing_config == {"tracking_uri": "http://mlflow.example", "experiment_id": "1"}
    assert dict(os.environ) == environment
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Credential reread")))
    client = MLflowTraceClient("mlflow", resolved)
    assert client._aws_sigv4 is not None
    assert client._aws_sigv4["token"] == "renewed-token-2"


@pytest.mark.parametrize("change", ["role", "region", "source_profile", "source_key"])
def test_assume_role_source_changes_fail_before_decryption(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    assume_role_source: tuple[Path, Path, list[dict[str, Any]]],
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    tenant, app, _ = trace_owner
    configuration, credentials, _ = assume_role_source
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    if change == "source_key":
        credentials.write_text(credentials.read_text().replace("source-key", "replaced-key"))
    else:
        old, new = {
            "role": ("role/trace", "role/other"),
            "region": ("us-east-1", "eu-west-1"),
            "source_profile": ("source_profile = source", "source_profile = other"),
        }[change]
        configuration.write_text(configuration.read_text().replace(old, new))
    decrypt = Mock(side_effect=AssertionError("Decrypted changed source"))
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(captured)
    decrypt.assert_not_called()


@pytest.mark.parametrize("method", ["env", "unidentified-provider"])
def test_unidentified_and_environment_refreshable_credentials_remain_strict(
    trace_owner: tuple[Tenant, App, TraceAppConfig], monkeypatch: pytest.MonkeyPatch, method: str
) -> None:
    tenant, app, _ = trace_owner
    monkeypatch.setenv("MLFLOW_TRACKING_AWS_SIGV4", "true")
    issued = iter(("first", "second"))

    def session() -> SimpleNamespace:
        owner = next(issued)
        credentials = RefreshableCredentials(
            access_key=f"{owner}-key",
            secret_key=f"{owner}-secret",
            token=f"{owner}-token",
            expiry_time=datetime.now(UTC) + timedelta(hours=1),
            refresh_using=Mock(side_effect=AssertionError("Unexpected refresh")),
            method=method,
        )
        return SimpleNamespace(get_credentials=lambda: credentials, region_name="us-east-1")

    monkeypatch.setattr("boto3.Session", session)
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(captured)


def write_kubeconfig(path: Path, user: dict[str, Any], *, namespace: str = "workspace") -> None:
    path.write_text(
        json.dumps(
            {
                "apiVersion": "v1",
                "kind": "Config",
                "current-context": "trace",
                "clusters": [{"name": "trace", "cluster": {"server": "https://kubernetes.example"}}],
                "contexts": [
                    {"name": "trace", "context": {"cluster": "trace", "user": "trace", "namespace": namespace}}
                ],
                "users": [{"name": "trace", "user": user}],
            }
        )
    )


@pytest.fixture
def kubeconfig(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "kubeconfig"
    monkeypatch.setenv("KUBECONFIG", str(path))
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes-namespaced")
    monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path / "missing-service-account")
    return path


def service_account_token(*, subject: str = "system:serviceaccount:workspace:tracer", expiry: int = 1) -> str:
    claims = {
        "iss": "https://kubernetes.example",
        "sub": subject,
        "aud": ["mlflow"],
        "exp": expiry,
        "iat": expiry - 1,
        "kubernetes.io": {"serviceaccount": {"name": "tracer", "uid": "account-uid"}, "pod": {"uid": str(expiry)}},
    }
    encoded = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature-{expiry}"


@pytest.mark.parametrize("source", ["service_account", "token_file"])
def test_projected_token_renewal_keeps_source_and_service_account_identity(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    kubeconfig: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    source: str,
) -> None:
    tenant, app, _ = trace_owner
    token_file = tmp_path / "token"
    if source == "service_account":
        monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path)
        (tmp_path / "namespace").write_text("workspace")
    else:
        write_kubeconfig(kubeconfig, {"tokenFile": "token"})
    token_file.write_text(service_account_token(expiry=1))
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    renewed = service_account_token(expiry=2)
    token_file.write_text(renewed)
    resolved = trace_source.load_trace_provider_config(captured)
    assert resolved["_runtime_settings"]["headers"]["Authorization"] == f"Bearer {renewed}"
    token_file.write_text(service_account_token(subject="system:serviceaccount:workspace:other", expiry=3))
    decrypt = Mock(side_effect=AssertionError("Decrypted changed service account"))
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(captured)
    decrypt.assert_not_called()


def test_exec_renewal_uses_one_owned_loader_without_persisting_kubeconfig(
    trace_owner: tuple[Tenant, App, TraceAppConfig], kubeconfig: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, app, _ = trace_owner
    counter = tmp_path / "issued-count"
    command = tmp_path / "issue-token.py"
    command.write_text(
        "import json, pathlib, sys\n"
        "counter = pathlib.Path(sys.argv[1])\n"
        "value = int(counter.read_text()) + 1 if counter.exists() else 1\n"
        "counter.write_text(str(value))\n"
        "print(json.dumps({'apiVersion': 'client.authentication.k8s.io/v1beta1', 'kind': 'ExecCredential', "
        "'status': {'token': f'issued-token-{value}', 'expirationTimestamp': '2099-01-01T00:00:00Z'}}))\n"
    )
    user = {
        "exec": {
            "apiVersion": "client.authentication.k8s.io/v1beta1",
            "command": sys.executable,
            "args": [str(command), str(counter)],
        }
    }
    write_kubeconfig(kubeconfig, user)
    original = kubeconfig.read_bytes()
    environment = dict(os.environ)
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    resolved = trace_source.load_trace_provider_config(captured)
    assert counter.read_text() == "2"
    assert resolved["_runtime_settings"]["headers"]["Authorization"] == "Bearer issued-token-2"
    assert kubeconfig.read_bytes() == original
    assert dict(os.environ) == environment
    write_kubeconfig(kubeconfig, user, namespace="other-workspace")
    decrypt = Mock(side_effect=AssertionError("Decrypted changed namespace"))
    monkeypatch.setattr(trace_source, "decrypt_provider_config", decrypt)
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(captured)
    decrypt.assert_not_called()


@pytest.mark.parametrize("source", ["inline", "environment", "malformed_file"])
def test_static_and_unidentified_tokens_remain_fully_fingerprinted(
    trace_owner: tuple[Tenant, App, TraceAppConfig],
    kubeconfig: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    source: str,
) -> None:
    tenant, app, _ = trace_owner
    write_kubeconfig(kubeconfig, {"token": "first-token"})
    if source == "environment":
        monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "first-token")
    elif source == "malformed_file":
        write_kubeconfig(kubeconfig, {"tokenFile": "token"})
        (tmp_path / "token").write_text("first-token")
    captured = trace_source.get_trace_provider_settings(tenant.id, app.id)[0]
    if source == "environment":
        monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "changed-token")
    elif source == "malformed_file":
        (tmp_path / "token").write_text("changed-token")
    else:
        write_kubeconfig(kubeconfig, {"token": "changed-token"})
    with pytest.raises(ValueError, match="configuration_changed"):
        trace_source.load_trace_provider_config(captured)
