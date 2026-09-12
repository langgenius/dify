"""Capture MLflow deployment credentials and sign requests without ambient state."""

import base64
import json
import os
from collections.abc import Mapping
from copy import deepcopy
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

import httpx

SERVICE_ACCOUNT_PATH = Path("/var/run/secrets/kubernetes.io/serviceaccount")


def resolve_aws_credentials(*, credential_identity: dict[str, Any] | None = None) -> dict[str, Any] | None:
    enabled = os.environ.get("MLFLOW_TRACKING_AWS_SIGV4", "false").lower()
    if enabled not in {"true", "false", "1", "0"}:
        raise ValueError("Invalid MLflow AWS SigV4 setting")
    if enabled in {"false", "0"}:
        return None
    import boto3
    from botocore.credentials import RefreshableCredentials

    try:
        # The previous signer used a fresh boto3 session, including its profile,
        # role and region resolution. Copy values before crossing the queue.
        session = boto3.Session()
        credentials = session.get_credentials()
        if credentials is None or session.region_name is None:
            raise ValueError("Missing AWS credentials or region")
        frozen = credentials.get_frozen_credentials()
        if (
            credential_identity is not None
            and isinstance(credentials, RefreshableCredentials)
            and credentials.method
            in {"assume-role", "assume-role-with-web-identity", "sso", "custom-process", "container-role", "iam-role"}
        ):
            configuration = session._session.full_config
            profiles = configuration.get("profiles", {})
            selected_profiles = {}
            profile_name = session.profile_name
            while profile_name and profile_name not in selected_profiles:
                profile = deepcopy(profiles.get(profile_name, {}))
                selected_profiles[profile_name] = profile
                profile_name = profile.get("source_profile")
            credential_identity["aws_sigv4"] = {
                "method": credentials.method,
                "region": session.region_name,
                "profiles": selected_profiles,
                "sso_sessions": {
                    name: configuration.get("sso_sessions", {}).get(name, {})
                    for profile in selected_profiles.values()
                    if (name := profile.get("sso_session"))
                },
                "environment": {
                    name: os.environ[name]
                    for name in (
                        "AWS_ACCESS_KEY_ID",
                        "AWS_SECRET_ACCESS_KEY",
                        "AWS_SESSION_TOKEN",
                        "AWS_SECURITY_TOKEN",
                        "AWS_CONFIG_FILE",
                        "AWS_SHARED_CREDENTIALS_FILE",
                        "BOTO_CONFIG",
                        "AWS_ROLE_ARN",
                        "AWS_ROLE_SESSION_NAME",
                        "AWS_WEB_IDENTITY_TOKEN_FILE",
                        "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
                        "AWS_CONTAINER_CREDENTIALS_FULL_URI",
                        "AWS_CONTAINER_AUTHORIZATION_TOKEN",
                        "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
                        "AWS_EC2_METADATA_SERVICE_ENDPOINT",
                        "AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE",
                    )
                    if name in os.environ
                },
            }
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


def _kubernetes_token_principal(token: str) -> dict[str, Any]:
    """Use unverified claims only for fingerprint change detection, never token verification."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        # Projected tokens vary by pod and expiry; their service account is stable.
        principal = {
            key: claims[key]
            for key in (
                "iss",
                "sub",
                "aud",
                "kubernetes.io/serviceaccount/namespace",
                "kubernetes.io/serviceaccount/service-account.name",
                "kubernetes.io/serviceaccount/service-account.uid",
            )
            if key in claims
        }
        if not principal.get("sub"):
            return {"token": token}
        if account := claims.get("kubernetes.io", {}).get("serviceaccount"):
            principal["service_account"] = account
        return principal
    except (ValueError, IndexError, TypeError, AttributeError):
        # Without principal claims, keep the complete credential fingerprint.
        return {"token": token}


def resolve_deployment_auth(
    headers: dict[str, str], *, aws_sigv4: bool = False, credential_identity: dict[str, Any] | None = None
) -> dict[str, str]:
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
            if header == "Authorization" and credential_identity is not None:
                credential_identity["Authorization"] = {
                    "provider": auth_provider,
                    "service_account_path": str(SERVICE_ACCOUNT_PATH),
                    "principal": _kubernetes_token_principal(value),
                }
    if required.keys() <= headers.keys():
        return headers
    try:
        from kubernetes import client
        from kubernetes.config.kube_config import KubeConfigLoader, KubeConfigMerger

        config_file = os.environ.get("KUBECONFIG") or str(Path.home() / ".kube" / "config")
        configuration = client.Configuration()
        # One loader owns both the selected source and its refreshed credentials.
        # Its optional persister is deliberately absent, so refreshes never edit kubeconfig.
        loader = KubeConfigLoader(KubeConfigMerger(config_file).config, config_base_path=None)
        cluster_node = loader._cluster
        user_node = loader._user
        if cluster_node is None:
            raise ValueError("Missing Kubernetes cluster")
        user = deepcopy(user_node.value) if user_node is not None else {}
        source = {
            "provider": auth_provider,
            "config_file": config_file,
            "context": deepcopy(loader.current_context),
            "cluster": deepcopy(cluster_node.value),
            "user": user,
        }
        loader.load_and_set(configuration)
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
                    if credential_identity is not None and user_node is not None:
                        auth_config = (user.get("auth-provider") or {}).get("config", {})
                        refreshed_auth = (user_node.value.get("auth-provider") or {}).get("config", {})
                        if any(
                            headers["Authorization"] == f"Bearer {refreshed_auth[field]}"
                            for field in ("access-token", "id-token")
                            if refreshed_auth.get(field)
                        ):
                            for field in ("access-token", "id-token", "expiry", "expires-on"):
                                auth_config.pop(field, None)
                            credential_identity["Authorization"] = source
                        elif user.get("tokenFile") and not user.get("token"):
                            source["token_file"] = os.path.join(
                                loader._get_base_path(user_node.path), user["tokenFile"]
                            )
                            source["principal"] = _kubernetes_token_principal(
                                headers["Authorization"].removeprefix("Bearer ")
                            )
                            credential_identity["Authorization"] = source
                        elif user.get("exec") and not (user.get("token") or user.get("tokenFile")):
                            credential_identity["Authorization"] = source
        if "X-MLFLOW-WORKSPACE" in required and "X-MLFLOW-WORKSPACE" not in headers:
            active_context = loader.current_context
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
