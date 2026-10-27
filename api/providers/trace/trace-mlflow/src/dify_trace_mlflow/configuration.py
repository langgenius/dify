"""Read Databricks experiment metadata without changing MLflow's global state.

This verifies authentication and read access to an existing active experiment.
It does not prove write permission, tracing API availability, or artifact delivery.
"""

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from google.protobuf.json_format import ParseDict, ParseError
from mlflow.protos.service_pb2 import GetExperiment
from pydantic import TypeAdapter

from core.helper import ssrf_proxy
from dify_trace_mlflow.config import DatabricksConfig

type VerificationCode = Literal[
    "invalid_workspace_url",
    "invalid_experiment_id",
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
    "invalid_workspace_url": "Databricks requires an HTTPS workspace origin.",
    "invalid_experiment_id": "Databricks requires a numeric experiment ID.",
    "authentication_failed": "Databricks authentication failed.",
    "permission_denied": "Databricks experiment access was denied.",
    "experiment_not_found_or_inaccessible": "The selected Databricks experiment was not found or is inaccessible.",
    "experiment_not_active": "The selected Databricks experiment is not active.",
    "experiment_id_mismatch": "Databricks returned a different experiment.",
    "malformed_response": "Databricks verification returned an invalid response.",
    "endpoint_unavailable": "Databricks endpoint could not be verified.",
    "connection_failed": "Databricks verification request failed.",
}
_JSON_OBJECT = TypeAdapter(dict[str, object])


class DatabricksConfigurationError(ValueError):
    """Fixed safe diagnostics; never include credentials or a vendor response."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


@dataclass(frozen=True, slots=True)
class ReadableDatabricksExperiment:
    host: str
    experiment_id: str


def _target(config: DatabricksConfig) -> ReadableDatabricksExperiment:
    host = config.host.strip()
    try:
        parsed = urlsplit(host)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and "\\" not in host
            and not any(ord(char) <= 32 or ord(char) == 127 for char in host)
        )
        _ = parsed.port
    except ValueError:
        raise DatabricksConfigurationError("invalid_workspace_url") from None
    if not valid:
        raise DatabricksConfigurationError("invalid_workspace_url")
    experiment_id = config.experiment_id.strip()
    if not experiment_id or not experiment_id.isascii() or not experiment_id.isdigit():
        raise DatabricksConfigurationError("invalid_experiment_id")
    return ReadableDatabricksExperiment(
        host=urlunsplit((parsed.scheme, parsed.netloc, "", "", "")),
        experiment_id=experiment_id.lstrip("0") or "0",
    )


def project_url(config: DatabricksConfig) -> str:
    """Pure URL presentation, including for historical configurations."""
    target = _target(config)
    return f"{target.host}/ml/experiments/{target.experiment_id}/traces"


def _request(method: Literal["GET", "POST"], url: str, **options: object) -> dict[str, object]:
    request = ssrf_proxy.get if method == "GET" else ssrf_proxy.post
    try:
        response = request(url, max_retries=0, timeout=30.0, follow_redirects=False, **options)
    except Exception:
        raise DatabricksConfigurationError("connection_failed") from None
    try:
        if response.status_code == 401:
            raise DatabricksConfigurationError("authentication_failed")
        if response.status_code == 403:
            raise DatabricksConfigurationError("permission_denied")
        if response.status_code == 404 and method == "GET":
            raise DatabricksConfigurationError("experiment_not_found_or_inaccessible")
        if not 200 <= response.status_code < 300:
            raise DatabricksConfigurationError("endpoint_unavailable")
        try:
            return _JSON_OBJECT.validate_python(response.json(), strict=True)
        except ValueError:
            raise DatabricksConfigurationError("malformed_response") from None
    finally:
        response.close()


def verify_configuration(config: DatabricksConfig) -> ReadableDatabricksExperiment:
    """Read the exact experiment with the exporter's existing PAT/M2M precedence.

    GetExperiment uses the official MLflow request/response schema. No permissions,
    SCIM or account API is needed, and no experiment, run or trace is created.
    Read access alone is intentionally not presented as write authorization.
    """
    target = _target(config)
    if config.client_id and config.client_secret:
        data = _request(
            "POST",
            target.host + "/oidc/v1/token",
            auth=(config.client_id, config.client_secret),
            data={"grant_type": "client_credentials", "scope": "all-apis"},
        )
        access_token = data.get("access_token")
        token_type = data.get("token_type")
        if (
            not isinstance(access_token, str)
            or not access_token.strip()
            or not isinstance(token_type, str)
            or token_type.lower() != "bearer"
        ):
            raise DatabricksConfigurationError("authentication_failed")
    else:
        access_token = config.personal_access_token
        if not access_token or not access_token.strip():
            raise DatabricksConfigurationError("authentication_failed")
    request = GetExperiment(experiment_id=target.experiment_id)
    data = _request(
        "GET",
        target.host + "/api/2.0/mlflow/experiments/get",
        params={"experiment_id": request.experiment_id},
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
    )
    try:
        result = ParseDict(data, GetExperiment.Response(), ignore_unknown_fields=True)
    except (ValueError, TypeError, ParseError):
        raise DatabricksConfigurationError("malformed_response") from None
    if not result.HasField("experiment") or not result.experiment.experiment_id:
        raise DatabricksConfigurationError("malformed_response")
    if result.experiment.experiment_id != target.experiment_id:
        raise DatabricksConfigurationError("experiment_id_mismatch")
    if result.experiment.lifecycle_stage != "active":
        raise DatabricksConfigurationError("experiment_not_active")
    return target
