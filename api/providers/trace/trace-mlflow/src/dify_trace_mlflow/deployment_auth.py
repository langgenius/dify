"""Capture MLflow deployment credentials and sign requests without ambient state."""

import os
from collections.abc import Mapping
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

import httpx

SERVICE_ACCOUNT_PATH = Path("/var/run/secrets/kubernetes.io/serviceaccount")


def resolve_aws_credentials() -> dict[str, Any] | None:
    enabled = os.environ.get("MLFLOW_TRACKING_AWS_SIGV4", "false").lower()
    if enabled not in {"true", "false", "1", "0"}:
        raise ValueError("Invalid MLflow AWS SigV4 setting")
    if enabled in {"false", "0"}:
        return None
    import boto3

    try:
        # The previous signer used a fresh boto3 session, including its profile,
        # role and region resolution. Copy values before crossing the queue.
        session = boto3.Session()
        credentials = session.get_credentials()
        if credentials is None or session.region_name is None:
            raise ValueError("Missing AWS credentials or region")
        frozen = credentials.get_frozen_credentials()
        return {
            "access_key": frozen.access_key,
            "secret_key": frozen.secret_key,
            "token": frozen.token,
            "region": session.region_name,
        }
    except Exception:
        raise ValueError("Cannot resolve MLflow AWS authentication") from None


def sign_aws_request(request: httpx.Request, *, credentials: Mapping[str, Any]) -> httpx.Request:
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest
    from botocore.credentials import Credentials

    body = request.read()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    request.headers["X-Amz-Date"] = timestamp
    request.headers["X-Amz-Content-SHA256"] = sha256(body).hexdigest()
    if credentials.get("token"):
        request.headers["X-Amz-Security-Token"] = credentials["token"]
    # Match the previous SDK's execute-api scope and Host/x-amz signed headers.
    signed = AWSRequest(
        method=request.method,
        url=str(request.url),
        data=body,
        headers={key: value for key, value in request.headers.items() if key == "host" or key.startswith("x-amz-")},
    )
    signed.context["timestamp"] = timestamp
    signer = SigV4Auth(
        Credentials(credentials["access_key"], credentials["secret_key"], credentials.get("token")),
        "execute-api",
        credentials["region"],
    )
    # add_auth logs the canonical request, including session credentials, at DEBUG.
    # Use the same signing primitives without logging credential-bearing headers.
    signature = signer.signature(signer.string_to_sign(signed, signer.canonical_request(signed)), signed)
    request.headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={signer.scope(signed)}, "
        f"SignedHeaders={signer.signed_headers(signed.headers)}, Signature={signature}"
    )
    return request


def resolve_deployment_auth(headers: dict[str, str], *, aws_sigv4: bool = False) -> dict[str, str]:
    headers = dict(headers)
    if workspace := os.environ.get("MLFLOW_WORKSPACE", "").strip():
        headers["X-MLFLOW-WORKSPACE"] = workspace
    auth_provider = os.environ.get("MLFLOW_TRACKING_AUTH")
    if aws_sigv4 or auth_provider not in {"kubernetes", "kubernetes-namespaced"}:
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
