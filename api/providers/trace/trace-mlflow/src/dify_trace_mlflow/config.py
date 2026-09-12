import base64
import configparser
import math
import os
from pathlib import Path
from typing import Any, override
from urllib.parse import urlsplit

from opentelemetry.sdk.trace import SpanLimits
from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_integer_id, validate_url_with_path
from dify_trace_mlflow.deployment_auth import resolve_aws_credentials, resolve_deployment_auth
from dify_trace_mlflow.otlp_export import capture_otlp_settings
from dify_trace_mlflow.request_auth import capture_netrc_auth, capture_request_auth_provider
from dify_trace_mlflow.request_headers import capture_request_headers


def _load_sampling_ratio() -> float:
    ratio = float(os.environ.get("MLFLOW_TRACE_SAMPLING_RATIO", "1"))
    # The pinned SDK ignores out-of-range and NaN ratios, restoring default sampling.
    return ratio if 0 <= ratio <= 1 else 1.0


def _load_span_attribute_limits() -> dict[str, int | None]:
    count_configured = "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT" in os.environ or "OTEL_ATTRIBUTE_COUNT_LIMIT" in os.environ
    length_configured = (
        "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT" in os.environ or "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT" in os.environ
    )
    if not count_configured and not length_configured:
        return {}
    limits = SpanLimits()
    return {
        "max_attributes": limits.max_span_attributes if count_configured else None,
        "max_value_length": limits.max_span_attribute_length if length_configured else None,
    }


def _load_event_limits() -> dict[str, int | None]:
    count_configured = "OTEL_SPAN_EVENT_COUNT_LIMIT" in os.environ
    attributes_configured = (
        "OTEL_EVENT_ATTRIBUTE_COUNT_LIMIT" in os.environ or "OTEL_ATTRIBUTE_COUNT_LIMIT" in os.environ
    )
    length_configured = "OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT" in os.environ
    if not count_configured and not attributes_configured and not length_configured:
        return {}
    limits = SpanLimits()
    return {
        "max_events": limits.max_events if count_configured else None,
        "max_attributes": limits.max_event_attributes if attributes_configured else None,
        "max_value_length": limits.max_attribute_length if length_configured else None,
    }


class MLflowConfig(BaseTracingConfig):
    """
    Model class for MLflow tracing config.
    """

    tracking_uri: str = "http://localhost:5000"
    experiment_id: str = "0"  # Default experiment id in MLflow is 0
    username: str | None = None
    password: str | None = None

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("password",)

    @classmethod
    @override
    def runtime_settings_for_identity(cls, runtime_settings: dict[str, Any]) -> dict[str, Any]:
        settings = dict(runtime_settings)
        credential_identity = settings.pop("credential_identity", {})
        if "aws_sigv4" in credential_identity:
            settings["aws_sigv4"] = credential_identity["aws_sigv4"]
        if "Authorization" in credential_identity:
            settings["headers"] = {
                **settings.get("headers", {}),
                "Authorization": credential_identity["Authorization"],
            }
        return settings

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        config = cls.model_validate(provider_config)
        # Saved passwords may still be encrypted here; merge their decrypted values in the client.
        username = os.environ.get("MLFLOW_TRACKING_USERNAME")
        password = os.environ.get("MLFLOW_TRACKING_PASSWORD")
        if not (username and password):
            credentials = configparser.ConfigParser()
            credentials.read(Path.home() / ".mlflow" / "credentials")
            if credentials.has_section("mlflow"):
                username = username or credentials.get("mlflow", "mlflow_tracking_username", fallback=None)
                password = password or credentials.get("mlflow", "mlflow_tracking_password", fallback=None)
        request_timeout = int(os.environ.get("MLFLOW_HTTP_REQUEST_TIMEOUT", "120"))
        if request_timeout <= 0:
            raise ValueError("MLflow HTTP request timeout must be positive")
        settings: dict[str, Any] = {
            "sampling_ratio": _load_sampling_ratio(),
            "request_timeout": request_timeout,
            "disabled": os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true",
            "request_headers": capture_request_headers(),
            "span_attribute_limits": _load_span_attribute_limits(),
            "event_limits": _load_event_limits(),
            "otlp": capture_otlp_settings(),
        }
        if os.environ.get("MLFLOW_TRACKING_AUTH") in {"kubernetes", "kubernetes-namespaced"}:
            # These built-in Requests auth objects suppress netrc and URL authentication.
            settings["use_implicit_auth"] = False
        if username and password:
            authorization = "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
            settings["headers"] = {"Authorization": authorization}
        elif token := os.environ.get("MLFLOW_TRACKING_TOKEN"):
            settings["headers"] = {"Authorization": f"Bearer {token}"}
        credential_identity: dict[str, Any] = {}
        aws_credentials = resolve_aws_credentials(credential_identity=credential_identity)
        if aws_credentials is not None:
            settings["aws_sigv4"] = aws_credentials
        elif (auth_provider := os.environ.get("MLFLOW_TRACKING_AUTH")) and auth_provider not in {
            "kubernetes",
            "kubernetes-namespaced",
        }:
            settings["request_auth_provider"] = capture_request_auth_provider(auth_provider)
        if aws_credentials is None and settings.get("use_implicit_auth", True):
            if netrc_auth := capture_netrc_auth():
                settings["netrc_auth"] = netrc_auth
        settings["default_authorization"] = settings.get("use_implicit_auth") is False and not settings.get("headers")
        if headers := resolve_deployment_auth(
            settings.get("headers", {}),
            aws_sigv4=aws_credentials is not None,
            credential_identity=credential_identity,
        ):
            settings["headers"] = headers
        if credential_identity:
            settings["credential_identity"] = credential_identity
        insecure_tls = os.environ.get("MLFLOW_TRACKING_INSECURE_TLS", "false").lower()
        if insecure_tls not in {"true", "false", "1", "0"}:
            raise ValueError("Invalid MLflow TLS verification setting")
        verify = insecure_tls in {"false", "0"}
        certificate = os.environ.get("MLFLOW_TRACKING_SERVER_CERT_PATH")
        if not verify and certificate is not None:
            raise ValueError("MLflow TLS verification cannot be disabled with a server certificate configured")
        # The SDK passes an explicitly blank CA path to Requests as verify="".
        verify = verify and certificate != ""
        if certificate is None and verify:
            certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
        settings["verify"] = verify
        http_tracking = urlsplit(config.tracking_uri).scheme == "http"
        try:
            settings["tls"] = read_tls_files(
                {
                    "certificate": certificate,
                    # Requests accepts a PEM containing both the certificate and key.
                    "client_certificate": os.environ.get("MLFLOW_TRACKING_CLIENT_CERT_PATH"),
                },
                allow_ca_directory=True,
            )
        except ValueError:
            if not http_tracking:
                raise
            # An HTTP tracker may return HTTPS artifacts. Capture their TLS files now,
            # but unreadable files must not prevent requests that remain HTTP.
            settings["artifact_tls_read_failed"] = True
        return settings

    @field_validator("tracking_uri")
    @classmethod
    def tracking_uri_validator(cls, v, info: ValidationInfo):
        if isinstance(v, str) and v.startswith("databricks"):
            raise ValueError(
                "Please use Databricks tracing config below to record traces to Databricks-managed MLflow instances."
            )
        return validate_url_with_path(v, "http://localhost:5000")

    @field_validator("experiment_id")
    @classmethod
    def experiment_id_validator(cls, v, info: ValidationInfo):
        return validate_integer_id(v)


class DatabricksConfig(BaseTracingConfig):
    """
    Model class for Databricks (Databricks-managed MLflow) tracing config.
    """

    experiment_id: str
    host: str
    client_id: str | None = None
    client_secret: str | None = None
    personal_access_token: str | None = None

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("personal_access_token", "client_secret")

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        settings: dict[str, Any] = {
            "sampling_ratio": _load_sampling_ratio(),
            "disabled": os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true",
            "request_headers": capture_request_headers(),
            "span_attribute_limits": _load_span_attribute_limits(),
            "event_limits": _load_event_limits(),
            "otlp": capture_otlp_settings(),
        }
        sdk_enabled = os.environ.get("MLFLOW_ENABLE_DB_SDK", "true").lower()
        if sdk_enabled not in {"true", "false", "1", "0"}:
            raise ValueError("Invalid Databricks SDK setting")
        profiles = configparser.ConfigParser()
        profile_settings: dict[str, str] = {}
        if profile := os.environ.get("DATABRICKS_CONFIG_PROFILE"):
            profile_path = os.environ.get("DATABRICKS_CONFIG_FILE", str(Path.home() / ".databrickscfg"))
            # Only the SDK expands tilde paths and replaces an empty path with its default.
            if sdk_enabled in {"true", "1"}:
                profile_path = str(Path(profile_path or Path.home() / ".databrickscfg").expanduser())
            profiles.read(profile_path)
            # Native named profiles do not inherit DEFAULT options.
            sections = profiles._sections  # type: ignore[attr-defined]  # pyrefly: ignore[missing-attribute]
            profile_settings = dict(profiles.defaults() if profile == "DEFAULT" else sections.get(profile, {}))
        # Dify supplies host/auth, so the SDK skips unselected profiles. Its timeout
        # has no environment variable and a configured zero restores the 60s default.
        request_timeout = 60.0
        verify = True
        if sdk_enabled in {"false", "0"}:
            request_timeout = int(os.environ.get("MLFLOW_HTTP_REQUEST_TIMEOUT", "120"))
            insecure = os.environ.get("DATABRICKS_INSECURE")
            if profile:
                # Legacy selected profiles also take precedence over environment values.
                insecure = profile_settings.get("insecure")
                if insecure is not None:
                    insecure = profiles.get(profile, "insecure")
            # The legacy SDK uses string truthiness, including nonempty "false" and "0".
            verify = not bool(insecure)
        else:
            request_timeout = float(profile_settings.get("http_timeout_seconds", "60")) or 60
        if not math.isfinite(request_timeout) or request_timeout <= 0:
            raise ValueError("Databricks HTTP request timeout must be positive and finite")
        settings["request_timeout"] = request_timeout
        settings["verify"] = verify
        if workspace := os.environ.get("MLFLOW_WORKSPACE", "").strip():
            settings["headers"] = {"X-MLFLOW-WORKSPACE": workspace}
        # The Databricks SDK uses Requests for both API calls and signed uploads.
        try:
            settings["tls"] = read_tls_files(
                {"certificate": os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")},
                allow_ca_directory=True,
            )
        except ValueError:
            if verify and urlsplit(cls.model_validate(provider_config).host).scheme != "http":
                raise
            # Unverified and HTTP tracking ignore CA files; signed uploads still require them.
            settings["tls_read_failed"] = True
        return settings

    @field_validator("experiment_id")
    @classmethod
    def experiment_id_validator(cls, v, info: ValidationInfo):
        return validate_integer_id(v)
