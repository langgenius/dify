"""MLflow tracking servers and Databricks-managed MLflow experiments.

Spans are serialized with MLflow's own entities, but every request carries this
call's credentials through the egress. Nothing is read from or written to the
process environment, and no MLflow tracer, fluent API, or SDK client runs.

OSS MLflow ingests OTLP/HTTP on its experiment endpoint (MLflow >= 3.4).
Databricks keeps the experiment destination through the V3 trace API and the
trace artifact; its OTLP endpoint writes Unity Catalog tables instead.
"""

import base64
import re
from collections.abc import Mapping
from typing import override
from urllib.parse import quote, unquote, urlencode, urlsplit, urlunsplit

from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import (
    EgressError,
    ExportOutcomeUnknownError,
    ExportRejectedError,
    ExportRetryableError,
    TraceProviderError,
    VerificationError,
)
from dify_trace_sdk.exporting import export_endpoint, send_export_request
from dify_trace_sdk.model import Trace
from dify_trace_sdk.otlp import post_otlp, read_otlp_ack
from dify_trace_sdk.provider import ProviderCapabilities, SendResult, TraceProvider
from google.protobuf.json_format import ParseDict, ParseError
from mlflow.protos.service_pb2 import GetExperiment
from mlflow.tracing.constant import TRACE_REQUEST_ID_PREFIX
from mlflow.tracing.utils.otlp import MLFLOW_EXPERIMENT_ID_HEADER, OTLP_TRACES_PATH

from dify_trace_mlflow._databricks import DatabricksStore, trace_info, upload_trace_data
from dify_trace_mlflow._spans import mlflow_spans, otlp_request, standalone, trace_data
from dify_trace_mlflow.config import DatabricksConfig, MLflowConfig

VERIFY_TIMEOUT_SECONDS = 10.0
_GET_EXPERIMENT_PATH = "/api/2.0/mlflow/experiments/get"
_OAUTH_TOKEN_PATH = "/oidc/v1/token"
_OAUTH_TOKEN_REQUEST = urlencode({"grant_type": "client_credentials", "scope": "all-apis"}).encode()


def _has_control_character(value: str) -> bool:
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _basic_authorization(username: str, password: str) -> str:
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


def _basic_credentials(config: MLflowConfig) -> tuple[str, str] | None:
    """Both or neither; the username cannot contain the Basic separator."""
    username, password = config.username or "", config.password or ""
    if not username and not password:
        return None
    if not username.strip() or not password.strip() or ":" in username or _has_control_character(username + password):
        raise VerificationError("incomplete_basic_auth")
    return username, password


def _experiment_id(value: str) -> str:
    stripped = value.strip()
    if not stripped.isascii() or not stripped.isdigit():
        raise VerificationError("invalid_experiment_id")
    return stripped.lstrip("0") or "0"


def _tracking_uri(value: str) -> str:
    """Normalize an OSS tracking server URL with an optional path prefix.

    Anything a URL parser or proxy could read in two ways is rejected, and the
    raw input is inspected first because parsers silently drop some characters.
    """
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
            and not _has_control_character(decoded_path)
            and "//" not in parsed.path
            and not any(part in {".", ".."} for part in decoded_path.split("/"))
        )
        if not valid or host is None:
            raise VerificationError("invalid_tracking_uri")
        host = host.encode("idna").decode("ascii").lower()
    except (UnicodeError, ValueError):
        raise VerificationError("invalid_tracking_uri") from None
    authority = f"[{host}]" if ":" in host else host
    if port is not None:
        authority = f"{authority}:{port}"
    return urlunsplit((parsed.scheme, authority, path, "", ""))


def _workspace(config: DatabricksConfig) -> tuple[str, str]:
    """The HTTPS workspace origin and the experiment ID, normalized."""
    host = config.host.strip()
    try:
        parsed = urlsplit(host)
        port = parsed.port
    except ValueError:
        raise VerificationError("invalid_workspace_url") from None
    valid = (
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
        and port != 0
        and "\\" not in host
        and not any(ord(char) <= 32 or ord(char) == 127 for char in host)
    )
    if not valid:
        raise VerificationError("invalid_workspace_url")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", "")), _experiment_id(config.experiment_id)


def _verification_json(
    egress: Egress,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    content: bytes | None,
    not_found: str,
) -> dict[str, object]:
    """Send one verification request; ``not_found`` is the code for HTTP 404."""
    try:
        response = egress.request(
            method, url, headers=headers, content=content, timeout=VERIFY_TIMEOUT_SECONDS, sensitive_url=False
        )
    except EgressError:
        raise VerificationError("connection_failed") from None
    if response.status_code == 401:
        raise VerificationError("authentication_failed")
    if response.status_code == 403:
        raise VerificationError("permission_denied")
    if response.status_code == 404:
        raise VerificationError(not_found)
    if not 200 <= response.status_code < 300:
        raise VerificationError("endpoint_unavailable")
    try:
        body = response.json()
    except ValueError:
        raise VerificationError("malformed_response") from None
    if not isinstance(body, dict):
        raise VerificationError("malformed_response")
    return body


def _check_experiment(egress: Egress, base_url: str, experiment_id: str, headers: Mapping[str, str]) -> None:
    """Read the exact experiment. Read access does not prove trace write permission."""
    body = _verification_json(
        egress,
        "GET",
        f"{base_url}{_GET_EXPERIMENT_PATH}?{urlencode({'experiment_id': experiment_id})}",
        headers={"Accept": "application/json", **headers},
        content=None,
        not_found="experiment_not_found_or_inaccessible",
    )
    try:
        result = ParseDict(body, GetExperiment.Response(), ignore_unknown_fields=True)
    except (ParseError, TypeError, ValueError):
        raise VerificationError("malformed_response") from None
    if not result.HasField("experiment") or not result.experiment.experiment_id:
        raise VerificationError("malformed_response")
    if result.experiment.experiment_id != experiment_id:
        raise VerificationError("experiment_id_mismatch")
    if result.experiment.lifecycle_stage != "active":
        raise VerificationError("experiment_not_active")


def _oauth_headers(client_id: str, client_secret: str) -> dict[str, str]:
    return {
        "Authorization": _basic_authorization(client_id, client_secret),
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }


class MLflowProvider(TraceProvider[MLflowConfig]):
    id = "mlflow"
    config_model = MLflowConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=False)

    @override
    def verify(self, config: MLflowConfig) -> MLflowConfig:
        tracking_uri = _tracking_uri(config.tracking_uri)
        experiment_id = _experiment_id(config.experiment_id)
        credentials = _basic_credentials(config)
        headers = {} if credentials is None else {"Authorization": _basic_authorization(*credentials)}
        _check_experiment(self.egress, tracking_uri, experiment_id, headers)
        return config.model_copy(update={"tracking_uri": tracking_uri, "experiment_id": experiment_id})

    @override
    def project_url(self, config: MLflowConfig) -> str | None:
        try:
            tracking_uri = _tracking_uri(config.tracking_uri)
            experiment_id = _experiment_id(config.experiment_id)
        except VerificationError:
            return None
        return f"{tracking_uri}/#/experiments/{experiment_id}/traces"

    @override
    def send(self, config: MLflowConfig, trace: Trace) -> SendResult:
        tracking_uri = export_endpoint(config.tracking_uri)
        unit = standalone(trace)
        trace_id = TRACE_REQUEST_ID_PREFIX + unit.trace_id
        try:
            request = otlp_request(mlflow_spans(unit, config.experiment_id, trace_id))
        except ValueError:
            raise ExportRejectedError("MLflow cannot encode the trace") from None
        headers = {MLFLOW_EXPERIMENT_ID_HEADER: config.experiment_id}
        if config.username and config.password:
            headers["Authorization"] = _basic_authorization(config.username, config.password)
        response = post_otlp(
            self.egress,
            tracking_uri + OTLP_TRACES_PATH,
            request,
            destination="MLflow",
            headers=headers,
            sensitive_url=False,
        )
        read_otlp_ack(response, "MLflow")
        # MLflow 3.4's classic and GenAI trace views read selectedTraceId and
        # selectedEvaluationId; later views read traceId. Each ignores the others.
        query = urlencode({"traceId": trace_id, "selectedTraceId": trace_id, "selectedEvaluationId": trace_id})
        trace_url = f"{tracking_uri}/#/experiments/{config.experiment_id}/traces?{query}"
        return SendResult(trace_id=trace_id, trace_url=trace_url, span_urls={})


class DatabricksProvider(TraceProvider[DatabricksConfig]):
    id = "databricks"
    config_model = DatabricksConfig
    capabilities = ProviderCapabilities(native_cost=True, trace_url=True, span_url=False)

    def _verification_token(self, host: str, config: DatabricksConfig) -> str:
        """OAuth machine-to-machine credentials take precedence over a personal access token."""
        if config.client_id and config.client_secret:
            body = _verification_json(
                self.egress,
                "POST",
                host + _OAUTH_TOKEN_PATH,
                headers=_oauth_headers(config.client_id, config.client_secret),
                content=_OAUTH_TOKEN_REQUEST,
                not_found="endpoint_unavailable",
            )
            token, token_type = body.get("access_token"), body.get("token_type")
            if (
                not isinstance(token, str)
                or not token.strip()
                or not isinstance(token_type, str)
                or token_type.lower() != "bearer"
            ):
                raise VerificationError("authentication_failed")
            return token
        if not config.personal_access_token or not config.personal_access_token.strip():
            raise VerificationError("authentication_failed")
        return config.personal_access_token

    def _export_token(self, host: str, config: DatabricksConfig) -> str:
        if config.client_id and config.client_secret:
            try:
                response = send_export_request(
                    self.egress,
                    "POST",
                    host + _OAUTH_TOKEN_PATH,
                    destination="Databricks",
                    headers=_oauth_headers(config.client_id, config.client_secret),
                    content=_OAUTH_TOKEN_REQUEST,
                    sensitive_url=False,
                )
            except ExportOutcomeUnknownError:
                # Nothing is exported before the token arrives, so asking again is safe.
                raise ExportRetryableError("Databricks OAuth token request failed in transport") from None
            try:
                body = response.json()
            except ValueError:
                body = None
            token = body.get("access_token") if isinstance(body, dict) else None
            if not isinstance(token, str) or not token:
                raise ExportRejectedError("Databricks OAuth token was not returned")
            return token
        if not config.personal_access_token:
            raise ExportRejectedError("Databricks credentials are not configured")
        return config.personal_access_token

    @override
    def verify(self, config: DatabricksConfig) -> DatabricksConfig:
        host, experiment_id = _workspace(config)
        token = self._verification_token(host, config)
        _check_experiment(self.egress, host, experiment_id, {"Authorization": f"Bearer {token}"})
        return config.model_copy(update={"host": host, "experiment_id": experiment_id})

    @override
    def project_url(self, config: DatabricksConfig) -> str | None:
        try:
            host, experiment_id = _workspace(config)
        except VerificationError:
            return None
        return f"{host}/ml/experiments/{experiment_id}/traces"

    @override
    def send(self, config: DatabricksConfig, trace: Trace) -> SendResult:
        host = export_endpoint(config.host)
        unit = standalone(trace)
        requested_id = TRACE_REQUEST_ID_PREFIX + unit.trace_id
        try:
            info = trace_info(unit, config.experiment_id, requested_id)
            artifact = trace_data(mlflow_spans(unit, config.experiment_id, requested_id))
        except ValueError:
            raise ExportRejectedError("Databricks cannot encode the trace") from None
        headers = {"Authorization": f"Bearer {self._export_token(host, config)}"}
        trace_id = DatabricksStore(self.egress, host, headers).start_trace(info).trace_id
        if not trace_id:
            raise ExportOutcomeUnknownError("Databricks did not acknowledge a trace identifier")
        try:
            if trace_id != requested_id:
                artifact = trace_data(mlflow_spans(unit, config.experiment_id, trace_id))
            upload_trace_data(self.egress, host, headers, trace_id, artifact)
        except TraceProviderError:
            raise ExportOutcomeUnknownError(
                "Databricks accepted trace metadata but artifact delivery is incomplete"
            ) from None
        # Databricks opens its trace panel with a different query key from OSS MLflow.
        trace_url = (
            f"{host}/ml/experiments/{config.experiment_id}/traces?selectedEvaluationId={quote(trace_id, safe='')}"
        )
        return SendResult(trace_id=trace_id, trace_url=trace_url, span_urls={})
