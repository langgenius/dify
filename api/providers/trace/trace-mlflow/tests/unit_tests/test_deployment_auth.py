from pathlib import Path
from unittest.mock import Mock

import pytest
from dify_trace_mlflow import deployment_auth
from kubernetes import client, config


@pytest.mark.parametrize("namespaced", [False, True])
def test_kubernetes_service_account_auth_is_copied_without_changing_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, namespaced: bool
) -> None:
    monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path)
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes-namespaced" if namespaced else "kubernetes")
    monkeypatch.delenv("MLFLOW_WORKSPACE", raising=False)
    monkeypatch.setattr(config, "load_kube_config", Mock(side_effect=AssertionError("Unneeded kubeconfig read")))
    (tmp_path / "token").write_text("first-token\n")
    (tmp_path / "namespace").write_text("workspace\n")
    original = {"X-Custom": "value"}
    captured = deployment_auth.resolve_deployment_auth(original)
    assert captured == {
        **original,
        "Authorization": "Bearer first-token",
        **({"X-MLFLOW-WORKSPACE": "workspace"} if namespaced else {}),
    }
    (tmp_path / "token").write_text("rotated-token")
    assert deployment_auth.resolve_deployment_auth(original) != captured
    assert captured["Authorization"] == "Bearer first-token"
    assert original == {"X-Custom": "value"}
    assert deployment_auth.os.environ.get("MLFLOW_WORKSPACE") is None


def test_kubernetes_auth_preserves_explicit_credentials_and_workspace(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path)
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes-namespaced")
    monkeypatch.setenv("MLFLOW_WORKSPACE", " explicit-workspace ")
    monkeypatch.setattr(config, "load_kube_config", Mock(side_effect=AssertionError("Unneeded kubeconfig read")))
    assert deployment_auth.resolve_deployment_auth({"Authorization": "Basic configured"}) == {
        "Authorization": "Basic configured",
        "X-MLFLOW-WORKSPACE": "explicit-workspace",
    }


def test_kubernetes_auth_uses_owned_kubeconfig_without_changing_global_configuration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path / "missing-service-account")
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes-namespaced")
    monkeypatch.delenv("MLFLOW_WORKSPACE", raising=False)
    config_file = tmp_path / "kubeconfig"
    config_file.write_text(
        "apiVersion: v1\nkind: Config\ncurrent-context: test\n"
        "clusters:\n- name: test\n  cluster:\n    server: https://kubernetes.example\n"
        "contexts:\n- name: test\n  context:\n    cluster: test\n    user: test\n    namespace: kube-workspace\n"
        "users:\n- name: test\n  user:\n    token: kube-token\n"
    )
    original = config_file.read_bytes()
    monkeypatch.setenv("KUBECONFIG", str(config_file))
    monkeypatch.setattr(client.Configuration, "set_default", Mock(side_effect=AssertionError("Global config write")))
    assert deployment_auth.resolve_deployment_auth({}) == {
        "Authorization": "Bearer kube-token",
        "X-MLFLOW-WORKSPACE": "kube-workspace",
    }
    assert config_file.read_bytes() == original
    config_file.unlink()
    with pytest.raises(ValueError, match="Cannot resolve MLflow Kubernetes authentication"):
        deployment_auth.resolve_deployment_auth({})


def test_explicit_workspace_is_preserved_without_an_auth_plugin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MLFLOW_TRACKING_AUTH", raising=False)
    monkeypatch.setenv("MLFLOW_WORKSPACE", "tenant-workspace")
    assert deployment_auth.resolve_deployment_auth({}) == {"X-MLFLOW-WORKSPACE": "tenant-workspace"}


def test_missing_kubernetes_token_can_be_satisfied_by_saved_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(deployment_auth, "SERVICE_ACCOUNT_PATH", tmp_path)
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "kubernetes")
    monkeypatch.delenv("MLFLOW_WORKSPACE", raising=False)
    monkeypatch.setenv("KUBECONFIG", str(tmp_path / "missing-config"))
    assert deployment_auth.resolve_deployment_auth({}) == {"Authorization": ""}
