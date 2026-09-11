"""Capture MLflow deployment workspace and built-in Kubernetes authentication."""

import os
from pathlib import Path

SERVICE_ACCOUNT_PATH = Path("/var/run/secrets/kubernetes.io/serviceaccount")


def resolve_deployment_auth(headers: dict[str, str]) -> dict[str, str]:
    headers = dict(headers)
    if workspace := os.environ.get("MLFLOW_WORKSPACE", "").strip():
        headers["X-MLFLOW-WORKSPACE"] = workspace
    auth_provider = os.environ.get("MLFLOW_TRACKING_AUTH")
    if auth_provider not in {"kubernetes", "kubernetes-namespaced"}:
        return headers
    required = {"Authorization": "token"}
    if auth_provider == "kubernetes-namespaced":
        required["X-MLFLOW-WORKSPACE"] = "namespace"
    for header, filename in required.items():
        if header in headers:
            continue
        try:
            value = (SERVICE_ACCOUNT_PATH / filename).read_text().strip()
        except OSError:
            continue
        if value:
            headers[header] = f"Bearer {value}" if header == "Authorization" else value
    if required.keys() <= headers.keys():
        return headers
    try:
        from kubernetes import client, config

        config_file = os.environ.get("KUBECONFIG") or str(Path.home() / ".kube" / "config")
        configuration = client.Configuration()
        config.load_kube_config(config_file=config_file, client_configuration=configuration, persist_config=False)
        if "Authorization" not in headers:
            with client.ApiClient(configuration=configuration) as api_client:
                token = api_client.default_headers.get("Authorization") or api_client.default_headers.get(
                    "authorization"
                )
                if not isinstance(token, str) or not token.lower().startswith("bearer "):
                    token = configuration.api_key.get("authorization")
                if isinstance(token, str) and token.strip():
                    token = token.strip()
                    headers["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
        if "X-MLFLOW-WORKSPACE" in required and "X-MLFLOW-WORKSPACE" not in headers:
            _, active_context = config.list_kube_config_contexts(config_file=config_file)
            if active_context and (namespace := active_context.get("context", {}).get("namespace", "").strip()):
                headers["X-MLFLOW-WORKSPACE"] = namespace
    except Exception:
        if "X-MLFLOW-WORKSPACE" in required and "X-MLFLOW-WORKSPACE" not in headers:
            raise ValueError("Cannot resolve MLflow Kubernetes authentication") from None
    if "X-MLFLOW-WORKSPACE" in required and "X-MLFLOW-WORKSPACE" not in headers:
        raise ValueError("Cannot resolve MLflow Kubernetes authentication")
    # Decrypted saved Basic credentials can satisfy Kubernetes auth. Otherwise the client rejects this empty marker.
    headers.setdefault("Authorization", "")
    return headers
