"""Read-only Weave configuration checks without SDK login or global client state.

Projects must already exist. Configuration verification never creates a project,
trace, or local credential file; actual legacy exports retain their SDK lifecycle.
"""

from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from weave.trace_server.trace_server_interface import CallsQueryStatsReq, CallsQueryStatsRes

from core.helper import ssrf_proxy
from dify_trace_weave.config import WeaveConfig

type VerificationCode = Literal[
    "invalid_project",
    "invalid_endpoint",
    "authentication_failed",
    "permission_denied",
    "project_not_found_or_inaccessible",
    "project_read_only",
    "project_permission_unknown",
    "graphql_error",
    "malformed_response",
    "endpoint_unavailable",
    "connection_failed",
]

_MESSAGES: dict[VerificationCode, str] = {
    "invalid_project": "Weave requires a valid entity and project name.",
    "invalid_endpoint": "Weave endpoint is invalid.",
    "authentication_failed": "Weave authentication failed.",
    "permission_denied": "Weave permission was denied.",
    "project_not_found_or_inaccessible": "Create the Weave project first or check project access.",
    "project_read_only": "Weave project is read-only for these credentials.",
    "project_permission_unknown": "Weave project write permission could not be verified.",
    "graphql_error": "Weave project verification returned an error.",
    "malformed_response": "Weave verification returned an invalid response.",
    "endpoint_unavailable": "Weave endpoint could not be verified.",
    "connection_failed": "Weave verification request failed.",
}

_VIEWER_QUERY = "query DifyWeaveViewer { viewer { id entity } }"
_PROJECT_QUERY = """query DifyWeaveProject($entity: String!, $project: String!) {
  viewer { id }
  project(name: $project, entityName: $entity) { id name entityName readOnly }
}"""
_JSON_OBJECT = TypeAdapter(dict[str, object])


class WeaveConfigurationError(ValueError):
    """Fixed diagnostic codes: never include keys, request data, or server errors."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


@dataclass(frozen=True, slots=True)
class VerifiedWeaveProject:
    entity: str
    project: str
    project_url: str


class _Viewer(BaseModel):
    id: str = Field(min_length=1)
    entity: str | None = None
    model_config = ConfigDict(strict=True)


class _Project(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    entity_name: str = Field(alias="entityName", min_length=1)
    read_only: bool | None = Field(alias="readOnly")
    model_config = ConfigDict(strict=True)


def _base_url(value: str, *, allow_http: bool) -> str:
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in ({"https", "http"} if allow_http else {"https"})
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
        )
        _ = parsed.port
    except ValueError:
        raise WeaveConfigurationError("invalid_endpoint") from None
    if not valid:
        raise WeaveConfigurationError("invalid_endpoint")
    return urlunsplit(parsed).rstrip("/")


def _name(value: str) -> str:
    value = value.strip()
    if (
        not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise WeaveConfigurationError("invalid_project")
    return value


def _target(config: WeaveConfig) -> tuple[str | None, str]:
    entity = config.entity.strip() if config.entity else None
    project = config.project.strip()
    if "/" in project:
        parts = project.split("/")
        if entity or len(parts) != 2:
            raise WeaveConfigurationError("invalid_project")
        entity, project = _name(parts[0]), parts[1]
    return (_name(entity) if entity else None), _name(project)


def console_url(config: WeaveConfig) -> str:
    """Map the public API origin to its UI; preserve private origins and prefixes."""
    host = _base_url(config.host or "https://api.wandb.ai", allow_http=True)
    parsed = urlsplit(host)
    if (
        parsed.scheme == "https"
        and parsed.hostname == "api.wandb.ai"
        and parsed.port in {None, 443}
        and not parsed.path
    ):
        return "https://wandb.ai"
    return host


def project_url(config: WeaveConfig) -> str | None:
    """Pure presentation fallback; never resolve a default entity over the network."""
    entity, project = _target(config)
    if entity is None:
        return None
    return f"{console_url(config)}/{quote(entity, safe='')}/{quote(project, safe='')}"


def _post(url: str, *, api_key: str, body: dict[str, object]) -> dict[str, object]:
    try:
        response = ssrf_proxy.post(
            url,
            auth=("api", api_key),
            json=body,
            max_retries=0,
            timeout=30.0,
            follow_redirects=False,
        )
    except Exception:
        raise WeaveConfigurationError("connection_failed") from None
    try:
        if response.status_code == 401:
            raise WeaveConfigurationError("authentication_failed")
        if response.status_code == 403:
            raise WeaveConfigurationError("permission_denied")
        if not 200 <= response.status_code < 300:
            raise WeaveConfigurationError("endpoint_unavailable")
        try:
            return _JSON_OBJECT.validate_python(response.json(), strict=True)
        except ValueError:
            raise WeaveConfigurationError("malformed_response") from None
    finally:
        response.close()


def _graphql(host: str, *, api_key: str, body: dict[str, object]) -> dict[str, object]:
    response = _post(host + "/graphql", api_key=api_key, body=body)
    errors = response.get("errors")
    if errors is not None:
        if not isinstance(errors, list):
            raise WeaveConfigurationError("malformed_response")
        if errors:
            raise WeaveConfigurationError("graphql_error")
    try:
        return _JSON_OBJECT.validate_python(response.get("data"), strict=True)
    except ValidationError:
        raise WeaveConfigurationError("malformed_response") from None


def verify_configuration(config: WeaveConfig) -> VerifiedWeaveProject:
    """Verify credentials, an existing writable project, and the trace read endpoint.

    The GraphQL fields match W&B's Viewer, GetProject and IsProjectReadOnly
    queries. CallsQueryStats uses the same typed read API as the Weave SDK.
    These checks do not write a test trace or replace ingestion authorization.
    """
    if not config.api_key.strip():
        raise WeaveConfigurationError("authentication_failed")
    entity, project = _target(config)
    host = _base_url(config.host or "https://api.wandb.ai", allow_http=True)
    trace_endpoint = _base_url(config.endpoint, allow_http=False)
    try:
        if entity is None:
            data = _graphql(host, api_key=config.api_key, body={"query": _VIEWER_QUERY})
            if "viewer" not in data:
                raise WeaveConfigurationError("malformed_response")
            if data.get("viewer") is None:
                raise WeaveConfigurationError("authentication_failed")
            viewer = _Viewer.model_validate(data["viewer"])
            if not viewer.entity:
                raise WeaveConfigurationError("invalid_project")
            entity = _name(viewer.entity)

        data = _graphql(
            host,
            api_key=config.api_key,
            body={"query": _PROJECT_QUERY, "variables": {"entity": entity, "project": project}},
        )
        if "viewer" not in data or "project" not in data:
            raise WeaveConfigurationError("malformed_response")
        if data.get("viewer") is None:
            raise WeaveConfigurationError("authentication_failed")
        _Viewer.model_validate(data["viewer"])
        if data.get("project") is None:
            raise WeaveConfigurationError("project_not_found_or_inaccessible")
        resolved = _Project.model_validate(data["project"])
        if resolved.name != project or resolved.entity_name != entity:
            raise WeaveConfigurationError("invalid_project")
        if resolved.read_only is True:
            raise WeaveConfigurationError("project_read_only")
        if resolved.read_only is None:
            raise WeaveConfigurationError("project_permission_unknown")

        stats_request = CallsQueryStatsReq(project_id=f"{entity}/{project}", limit=1)
        stats_response = _post(
            trace_endpoint + "/calls/query_stats",
            api_key=config.api_key,
            body=stats_request.model_dump(mode="json", exclude_none=True),
        )
        stats = CallsQueryStatsRes.model_validate(stats_response, strict=True)
        if stats.count < 0:
            raise WeaveConfigurationError("malformed_response")
    except ValidationError:
        raise WeaveConfigurationError("malformed_response") from None

    return VerifiedWeaveProject(
        entity=entity,
        project=project,
        project_url=f"{console_url(config)}/{quote(entity, safe='')}/{quote(project, safe='')}",
    )
