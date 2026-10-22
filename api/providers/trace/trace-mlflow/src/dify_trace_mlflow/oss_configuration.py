"""Read one OSS MLflow experiment without changing SDK or authentication state.

Configuration verification proves only read access to an existing active experiment.
It does not establish trace ingestion, artifact delivery, or write permission. The
legacy exporter remains a separate owner; configuration never constructs it.
"""

import base64
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal
from urllib.parse import unquote, urlsplit, urlunsplit

from google.protobuf.json_format import ParseDict, ParseError
from mlflow.protos.service_pb2 import GetExperiment
from pydantic import TypeAdapter

from core.helper import ssrf_proxy
from dify_trace_mlflow.config import MLflowConfig

type VerificationCode = Literal[
    "invalid_tracking_uri",
    "invalid_experiment_id",
    "incomplete_basic_auth",
    "authentication_failed",
    "permission_denied",
    "experiment_not_found_or_inaccessible",
    "experiment_not_active",
    "experiment_id_mismatch",
    "malformed_response",
    "endpoint_unavailable",
    "connection_failed",
]

_MESSAGES: dict[VerificationCode, str] = {
    "invalid_tracking_uri": "MLflow requires an HTTP(S) tracking server URL with an optional path prefix.",
    "invalid_experiment_id": "MLflow requires a numeric experiment ID.",
    "incomplete_basic_auth": "MLflow username and password must both be supplied or both be empty.",
    "authentication_failed": "MLflow authentication failed.",
    "permission_denied": "MLflow experiment access was denied.",
    "experiment_not_found_or_inaccessible": "The selected MLflow experiment was not found or is inaccessible.",
    "experiment_not_active": "The selected MLflow experiment is not active.",
    "experiment_id_mismatch": "MLflow returned a different experiment.",
    "malformed_response": "MLflow verification returned an invalid response.",
    "endpoint_unavailable": "MLflow endpoint could not be verified.",
    "connection_failed": "MLflow verification request failed.",
}
_JSON_OBJECT = TypeAdapter(dict[str, object])
_MAX_RESPONSE_BYTES = 1024 * 1024


class MLflowConfigurationError(ValueError):
    """Fixed diagnostics that never include request values or vendor response text."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


@dataclass(frozen=True, slots=True)
class ReadableMLflowExperiment:
    tracking_uri: str
    experiment_id: str


def _tracking_uri(value: object) -> str:
    if not isinstance(value, str):
        raise MLflowConfigurationError("invalid_tracking_uri")
    # Only surrounding ordinary spaces are normalization; URL parsers silently
    # discard some control characters, so inspect the original input first.
    value = value.strip(" ")
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        path = parsed.path.rstrip("/")
        decoded_path = unquote(path, errors="strict")
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
            and "%" not in host
            and not re.search(r"%(?![0-9a-fA-F]{2})", path)
            and not re.search(r"%(?:2f|5c)", path, re.IGNORECASE)
            and not any(char in decoded_path for char in "\\?#%")
            and not any(ord(char) < 32 or ord(char) == 127 for char in decoded_path)
            and "//" not in parsed.path
            and not any(part in {".", ".."} for part in decoded_path.split("/"))
        )
        if not valid or host is None:
            raise MLflowConfigurationError("invalid_tracking_uri")
        host = host.encode("idna").decode("ascii").lower()
        authority = f"[{host}]" if ":" in host else host
        if port is not None:
            authority = f"{authority}:{port}"
        return urlunsplit((parsed.scheme, authority, path, "", ""))
    except (UnicodeError, ValueError):
        raise MLflowConfigurationError("invalid_tracking_uri") from None


def _experiment_id(value: str) -> str:
    value = value.strip()
    if not value or not value.isascii() or not value.isdigit():
        raise MLflowConfigurationError("invalid_experiment_id")
    return value.lstrip("0") or "0"


def normalize_configuration(values: Mapping[str, object]) -> MLflowConfig:
    """Validate new destinations while retaining masked/nullable password values.

    Pair validation belongs after masked credentials are restored and decrypted.
    Keeping it out of MLflowConfig also leaves historical records readable and
    avoids interpreting RSA ciphertext as a user-supplied password.
    """
    config = MLflowConfig.model_validate(values)
    return config.model_copy(
        update={
            "tracking_uri": _tracking_uri(values.get("tracking_uri", config.tracking_uri)),
            "experiment_id": _experiment_id(config.experiment_id),
        }
    )


def project_url(config: MLflowConfig) -> str:
    """Pure link calculation, independent of authentication and server access."""
    host = _tracking_uri(config.tracking_uri)
    experiment_id = _experiment_id(config.experiment_id)
    return f"{host}/#/experiments/{experiment_id}/traces"


def verify_configuration(config: MLflowConfig) -> ReadableMLflowExperiment:
    """GET the exact experiment with only this request's optional Basic credentials."""
    config = normalize_configuration(config.model_dump())
    username, password = config.username, config.password
    has_username, has_password = bool(username), bool(password)
    if has_username != has_password or (
        has_username
        and (
            username is None
            or password is None
            or not username.strip()
            or not password.strip()
            or ":" in username
            or any(ord(char) < 32 or ord(char) == 127 for char in username + password)
        )
    ):
        raise MLflowConfigurationError("incomplete_basic_auth")

    # Explicit Cookie suppresses the pooled HTTP client's ambient cookie jar.
    # No MLflow environment variables, SDK client, or process-wide auth is read.
    headers = {"Accept": "application/json", "Accept-Encoding": "identity", "Cookie": ""}
    if username and password:
        encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {encoded}"
    request = GetExperiment(experiment_id=config.experiment_id)
    try:
        response = ssrf_proxy.get(
            config.tracking_uri + "/api/2.0/mlflow/experiments/get",
            params={"experiment_id": request.experiment_id},
            headers=headers,
            auth=None,
            max_retries=0,
            timeout=30.0,
            follow_redirects=False,
            stream_response=True,
        )
    except Exception:
        raise MLflowConfigurationError("connection_failed") from None
    try:
        if response.status_code == 401:
            raise MLflowConfigurationError("authentication_failed")
        if response.status_code == 403:
            raise MLflowConfigurationError("permission_denied")
        if response.status_code == 404:
            raise MLflowConfigurationError("experiment_not_found_or_inaccessible")
        if not 200 <= response.status_code < 300:
            raise MLflowConfigurationError("endpoint_unavailable")
        try:
            buffered = ssrf_proxy.buffer_response(response, max_response_bytes=_MAX_RESPONSE_BYTES)
            data = _JSON_OBJECT.validate_python(buffered.json(), strict=True)
            result = ParseDict(data, GetExperiment.Response(), ignore_unknown_fields=True)
        except (ValueError, TypeError, ParseError):
            raise MLflowConfigurationError("malformed_response") from None
        except Exception:
            raise MLflowConfigurationError("connection_failed") from None
    finally:
        response.close()
    if not result.HasField("experiment") or not result.experiment.experiment_id:
        raise MLflowConfigurationError("malformed_response")
    if result.experiment.experiment_id != config.experiment_id:
        raise MLflowConfigurationError("experiment_id_mismatch")
    if result.experiment.lifecycle_stage != "active":
        raise MLflowConfigurationError("experiment_not_active")
    return ReadableMLflowExperiment(config.tracking_uri, config.experiment_id)
