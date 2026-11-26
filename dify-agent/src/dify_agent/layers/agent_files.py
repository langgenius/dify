"""File control plane shared by plugin tools and read_media.

Metadata requests never fetch a download URI. Sandbox paths are uploaded by
the sandbox CLI; only plugin blobs already received from the daemon are sent
as multipart bytes. Observations and model messages contain locators only.
"""

from __future__ import annotations

import json
import shlex
from collections.abc import Mapping
from typing import TYPE_CHECKING
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, Field

from dify_agent.agent_stub.protocol import AgentStubFileMapping, file_reference
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.runtime.context import Services

if TYPE_CHECKING:
    from dify_agent.layers.shell.layer import ShellSession


class AgentFileDownload(BaseModel):
    filename: str
    mime_type: str | None = None
    size: int = Field(ge=-1)
    download_uri: str


def file_mapping_from_link(url: str) -> AgentStubFileMapping:
    """Recognize tool download paths; preserve other HTTP(S) URLs verbatim.

    A tool URL yields only its UUID locator. Authorization is deferred to the
    control plane when a caller actually reads or downloads it.
    """
    parsed = urlsplit(url)
    _, separator, filename = parsed.path.rpartition("/files/tools/")
    if separator and filename and "/" not in filename:
        try:
            record_id = str(UUID(filename.split(".", 1)[0]))
        except ValueError:
            record_id = None
        if record_id is not None:
            return AgentStubFileMapping(transfer_method="tool_file", reference=file_reference(record_id))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("media link must be an HTTP(S) URL or a Dify tool file URL")
    return AgentStubFileMapping(transfer_method="remote_url", url=url)


async def _post_file_request(services: Services, path: str, payload: Mapping[str, object]) -> dict[str, object]:
    response = await services.dify_api_http_client.post(
        services.inner_api_url.rstrip("/") + path,
        headers={"X-Inner-Api-Key": services.inner_api_key},
        json=dict(payload),
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("file control plane returned a non-object response")
    return data


async def request_agent_file_download(
    services: Services,
    execution_context: DifyExecutionContextLayerConfig,
    file_mapping: AgentStubFileMapping,
    *,
    for_frontend: bool = False,
) -> AgentFileDownload:
    """Authorize one locator and return authoritative metadata, without fetching bytes.

    Missing identity, HTTP errors and malformed responses propagate to the
    calling tool, which owns its text-observation fallback.
    """
    if not execution_context.user_id or not execution_context.user_from:
        raise ValueError("file operations require execution context user_id and user_from")
    data = await _post_file_request(
        services,
        "/inner/api/agent/files/download-request",
        {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "user_from": execution_context.user_from,
            "invoke_from": execution_context.invoke_from,
            "file": file_mapping.model_dump(mode="json", exclude_none=True),
            "for_frontend": for_frontend,
        },
    )
    return AgentFileDownload.model_validate(data)


async def upload_agent_tool_file(
    services: Services,
    execution_context: DifyExecutionContextLayerConfig,
    *,
    content: bytes,
    filename: str,
    mime_type: str,
    max_size: int,
) -> AgentStubFileMapping:
    """Persist an already-received plugin blob under the current owner.

    Reject missing identity and oversized content before upload allocation.
    Require the upload response's canonical reference and return only its
    tool_file locator. Transport/validation errors propagate without ever
    rendering the blob as observation text.
    """
    if not execution_context.user_id:
        raise ValueError("plugin file upload requires execution context user_id")
    if len(content) > max_size:
        raise ValueError(f"file size {len(content)} bytes exceeds upload limit {max_size} bytes")
    data = await _post_file_request(
        services,
        "/inner/api/agent/files/upload-request",
        {
            "tenant_id": execution_context.tenant_id,
            "user_id": execution_context.user_id,
            "user_from": execution_context.user_from,
            "conversation_id": execution_context.conversation_id,
            "filename": filename,
            "mimetype": mime_type,
            "max_size": max_size,
        },
    )
    uri = data.get("upload_uri")
    if not isinstance(uri, str) or not uri.startswith("/files/upload/for-plugin?"):
        raise ValueError("file control plane returned an invalid upload_uri")
    response = await services.dify_api_http_client.post(
        services.inner_api_url.rstrip("/") + uri,
        files={"file": (filename, content, mime_type)},
    )
    response.raise_for_status()
    uploaded = response.json()
    if not isinstance(uploaded, dict):
        raise ValueError("file upload returned a non-object response")
    return AgentStubFileMapping(transfer_method="tool_file", reference=uploaded.get("reference"))


async def upload_sandbox_path(shell_session: ShellSession, path: str, *, timeout: float = 60.0) -> AgentStubFileMapping:
    """Upload a workspace regular file in the sandbox and parse only its locator.

    The shell must be live and Stub-enabled. Failed, truncated or invalid CLI
    results raise ValueError; no file bytes cross the shell result boundary.
    """
    result = await shell_session.run_remote_script_complete(
        f"dify-agent file upload --no-download-link -- {shlex.quote(path)}",
        timeout=timeout,
        inject_agent_stub_env=True,
    )
    if result.exit_code != 0 or not result.output_complete:
        raise ValueError(
            f"sandbox file upload failed: {result.status}, exit_code={result.exit_code}: {result.output.strip()}"
        )
    payload = json.loads(result.output)
    if not isinstance(payload, dict):
        raise ValueError("sandbox upload did not return a file mapping object")
    mapping = AgentStubFileMapping.model_validate(
        {"transfer_method": payload.get("transfer_method"), "reference": payload.get("reference")}
    )
    if mapping.transfer_method != "tool_file":
        raise ValueError("sandbox upload did not return a tool_file locator")
    return mapping
