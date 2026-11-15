"""Check Opik workspace access without SDK streamers or ambient credentials.

The auth endpoint is read-only despite using POST. Verification does not create
projects or traces and does not establish project write or ingestion permission.
"""

from dataclasses import dataclass
from typing import Literal
from urllib.parse import quote, urlencode, urlsplit

from pydantic import TypeAdapter

from core.helper import ssrf_proxy
from dify_trace_opik.config import OpikConfig

type VerificationCode = Literal[
    "invalid_endpoint",
    "invalid_workspace",
    "invalid_project",
    "authentication_failed",
    "permission_denied",
    "endpoint_unavailable",
    "malformed_response",
    "connection_failed",
]

_MESSAGES: dict[VerificationCode, str] = {
    "invalid_endpoint": "Opik requires an HTTP(S) API URL ending in /api/.",
    "invalid_workspace": "Opik requires a valid workspace name.",
    "invalid_project": "Opik requires a valid project name.",
    "authentication_failed": "Opik authentication failed.",
    "permission_denied": "Opik workspace access was denied.",
    "endpoint_unavailable": "Opik endpoint could not be verified.",
    "malformed_response": "Opik verification returned an invalid response.",
    "connection_failed": "Opik verification request failed.",
}
_JSON_OBJECT = TypeAdapter(dict[str, object])


class OpikConfigurationError(ValueError):
    """Fixed safe codes; no credentials, vendor bodies or request details."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


@dataclass(frozen=True, slots=True)
class VerifiedOpikWorkspace:
    url: str
    workspace: str
    project: str


def _api_url(config: OpikConfig) -> str:
    value = config.url.strip()
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme in {"http", "https"}
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and parsed.path.endswith("/api/")
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
        )
        _ = parsed.port
    except ValueError:
        raise OpikConfigurationError("invalid_endpoint") from None
    if not valid:
        raise OpikConfigurationError("invalid_endpoint")
    return value


def _name(value: str | None, default: str, code: Literal["invalid_workspace", "invalid_project"]) -> str:
    result = value.strip() if value else default
    result = result or default
    if any(ord(char) < 32 or ord(char) == 127 for char in result) or (
        code == "invalid_workspace" and result in {".", ".."}
    ):
        raise OpikConfigurationError(code)
    return result


def console_url(config: OpikConfig) -> str:
    """Use the configured host and prefix, never the SDK's global OpikConfig."""
    return _api_url(config).removesuffix("api/")


def project_url(config: OpikConfig) -> str | None:
    """Pure fallback; historical default workspaces cannot be resolved on GET."""
    base = console_url(config)
    workspace = _name(config.workspace, "default", "invalid_workspace")
    if workspace == "default":
        return None
    project = _name(config.project, "Default Project", "invalid_project")
    return f"{base}{quote(workspace, safe='')}/redirect/projects?{urlencode({'name': project})}"


def _request(method: Literal["GET", "POST"], url: str, headers: dict[str, str]) -> dict[str, object] | None:
    try:
        response = ssrf_proxy.make_request(
            method,
            url,
            headers=headers,
            json={} if method == "POST" else None,
            max_retries=0,
            timeout=30.0,
            follow_redirects=False,
        )
    except Exception:
        raise OpikConfigurationError("connection_failed") from None
    try:
        if response.status_code == 401:
            raise OpikConfigurationError("authentication_failed")
        if response.status_code == 403:
            raise OpikConfigurationError("permission_denied")
        if not 200 <= response.status_code < 300:
            raise OpikConfigurationError("endpoint_unavailable")
        if method == "POST":
            # The official auth contract is No Content, not an arbitrary 2xx page.
            if response.content.strip():
                raise OpikConfigurationError("malformed_response")
            return None
        try:
            return _JSON_OBJECT.validate_python(response.json(), strict=True)
        except ValueError:
            raise OpikConfigurationError("malformed_response") from None
    finally:
        response.close()


def verify_configuration(config: OpikConfig) -> VerifiedOpikWorkspace:
    """Check auth/workspace via the same endpoints as Opik 1.11.2's auth_check.

    /v1/private/auth checks workspace access and returns no content. Only the
    sentinel default workspace needs /v1/private/auth/workspace resolution.
    Project creation remains an ingestion concern, as in the legacy behavior.
    """
    url = _api_url(config)
    workspace = _name(config.workspace, "default", "invalid_workspace")
    project = _name(config.project, "Default Project", "invalid_project")
    headers = {"Comet-Workspace": workspace, "Accept": "application/json"}
    if config.api_key:
        headers["Authorization"] = config.api_key
    _request("POST", url + "v1/private/auth", headers)
    if workspace == "default":
        data = _request("GET", url + "v1/private/auth/workspace", headers)
        resolved = data.get("workspace_name") if data else None
        if not isinstance(resolved, str) or not resolved.strip():
            raise OpikConfigurationError("malformed_response")
        workspace = _name(resolved, "default", "invalid_workspace")
    return VerifiedOpikWorkspace(url=url, workspace=workspace, project=project)
