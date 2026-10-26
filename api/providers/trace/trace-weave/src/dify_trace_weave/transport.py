"""Instance-authenticated Weave SDK transport shared by managed and legacy tracing."""

from collections.abc import Mapping
from typing import Any, override

from pydantic import BaseModel
from weave.trace_server_bindings.remote_http_trace_server import RemoteHTTPTraceServer

from dify_trace_weave.config import WeaveConfig
from dify_trace_weave.configuration import console_url
from services.tracing.provider_common import endpoint, request, required
from services.tracing.provider_dispatch import TraceExportRejectedError, TraceExportUncertainError


class TraceServer(RemoteHTTPTraceServer):
    """Use SDK request/response validation without SDK retries or global W&B login."""

    @override
    def _post_request_executor(self, url: str, req: BaseModel, stream: bool = False):
        return request(
            "POST",
            self.trace_server_url + url,
            "weave",
            auth=self._auth,
            content=req.model_dump_json(by_alias=True).encode(),
            headers={"Content-Type": "application/json"},
        )

    @override
    def _generic_request(self, url, req, req_model, res_model, method="POST", params=None):
        response = self._post_request_executor(url, req)
        try:
            return res_model.model_validate(response.json())
        except ValueError:
            raise TraceExportUncertainError("Weave returned an unreadable ingestion acknowledgment") from None


def resolve_project(config: Mapping[str, Any], api_key: str) -> tuple[str, str, str]:
    project = required(config, "project")
    host = endpoint(config.get("host") or "https://api.wandb.ai")
    entity = config.get("entity")
    if not entity and "/" in project:
        entity, project = project.split("/", 1)
    if not entity:
        response = request(
            "POST",
            host + "/graphql",
            "weave",
            auth=("api", api_key),
            json={"query": "query DifyTraceEntity { viewer { entity } }"},
        )
        entity = (response.json().get("data") or {}).get("viewer", {}).get("entity")
    if not isinstance(entity, str) or not entity or "/" in entity or not project or "/" in project:
        raise TraceExportRejectedError("Weave project or entity could not be resolved")
    ui_host = console_url(WeaveConfig(api_key=api_key, entity=entity, project=project, host=host))
    return entity, project, ui_host
