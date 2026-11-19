"""On-demand media inspection through authorized metadata and URL-only messages.

Only download-request's authoritative metadata determines format, modality and
size. No download URI is fetched here. Sandbox uploads run in the sandbox;
managed references remain opaque until the API model gateway resolves them.
"""

from __future__ import annotations

import json
import mimetypes
from typing import Literal, override
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability, CapabilityOrdering
from pydantic_ai.messages import AudioUrl, DocumentUrl, ImageUrl, ToolReturn, VideoUrl
from pydantic_ai.models import ModelRequestContext
from pydantic_ai.toolsets import FunctionToolset

from dify_agent.agent_stub.protocol import AgentStubFileMapping
from dify_agent.layers.agent_files import request_agent_file_download, upload_sandbox_path
from dify_agent.layers.dify_plugin.configs import DifyModelModality, DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.layers.read_media.configs import DifyReadMediaLayerConfig
from dify_agent.layers.read_media.history import attachment_marker, collapse_read_media_content
from dify_agent.layers.read_media.mime import normalize_media_mime
from dify_agent.layers.shell.layer import Capability as ShellCapability
from dify_agent.runtime.context import Deps

_MAX_ACTIVE_ITEMS = 4
_MAX_BYTES_BY_MODALITY: dict[DifyModelModality, int] = {
    "vision": 10 * 1024 * 1024,
    "audio": 25 * 1024 * 1024,
    "video": 50 * 1024 * 1024,
    "document": 20 * 1024 * 1024,
}
_URL_CLASS_BY_MODALITY = {"vision": ImageUrl, "audio": AudioUrl, "video": VideoUrl, "document": DocumentUrl}
_MIMES_BY_MODALITY: dict[DifyModelModality, set[str]] = {
    "vision": {"image/jpeg", "image/png", "image/gif", "image/webp"},
    "audio": {"audio/mpeg", "audio/wav", "audio/flac", "audio/ogg", "audio/aiff", "audio/aac"},
    "video": {
        "video/mp4",
        "video/webm",
        "video/quicktime",
        "video/x-matroska",
        "video/mpeg",
        "video/x-flv",
        "video/x-ms-wmv",
        "video/3gpp",
    },
    "document": {
        "application/pdf",
        "text/plain",
        "text/csv",
        "text/html",
        "text/markdown",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
}


class Config(DifyReadMediaLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReadMediaFileInput(BaseModel):
    """Locator fields only; pasted filename/MIME/size summaries are untrusted."""

    transfer_method: str | None = None
    reference: str | None = None
    url: str | None = None

    model_config = ConfigDict(extra="ignore")


class Capability(AbstractCapability[Deps]):
    """Expose explicit inspection and bound active attachments to four per run."""

    def __init__(self, name: str):
        self.id = name
        self.name = name

    @override
    def get_ordering(self) -> CapabilityOrdering:
        # Optional shells are ordered when present; no shell is required for
        # file-handle inspection, which is also used by shell-free Agents.
        return CapabilityOrdering(wrapped_by=[ShellCapability])

    @override
    def get_toolset(self) -> FunctionToolset[Deps]:
        async def read_media(
            ctx: RunContext[Deps],
            *,
            file: ReadMediaFileInput | None = None,
            path: str | None = None,
            detail: Literal["high", "low"] = "high",
        ) -> str | ToolReturn:
            """Attach image, audio, video or document content from a Dify file handle or workspace path.

            Supply exactly one of file or path, only when direct inspection is
            needed. Unsupported or inaccessible media returns a text explanation.
            """
            return await _read_media(ctx.deps, self.name, file=file, path=path, detail=detail)

        return FunctionToolset[Deps](tools=[read_media], id=self.name)

    @override
    async def before_model_request(
        self, ctx: RunContext[Deps], request_context: ModelRequestContext
    ) -> ModelRequestContext:
        collapse_read_media_content(request_context.messages, keep=_MAX_ACTIVE_ITEMS)
        return request_context


async def _read_media(
    deps: Deps, name: str, *, file: ReadMediaFileInput | None, path: str | None, detail: Literal["high", "low"]
) -> str | ToolReturn:
    """Validate a locator and attach only allowed URL content; all failures are text.

    Called under a validated module composition. Unsupported models short
    circuit before sandbox/control-plane I/O. Successful reads perform one
    metadata request; cancellation still propagates through BaseException.
    """
    config = Config.model_validate(deps.layers[name]["config"])
    hint = (
        " Use workspace commands or `dify-agent file download` to inspect, resize, transcode or extract pages first."
        if config.shell
        else " Proceed without direct media inspection."
    )

    def fallback(reason: str) -> str:
        return "read_media cannot attach multimodal content: " + reason + hint

    if (file is None) == (path is None):
        return fallback("provide exactly one file handle or workspace path.")
    llm = DifyPluginLLMLayerConfig.model_validate(deps.layers[config.llm]["config"])
    model_name = f"{llm.model_provider}/{llm.model}"
    if not llm.supported_modalities:
        return fallback(f"model {model_name} does not support any multimodal input.")
    try:
        if file is not None:
            mapping = AgentStubFileMapping.model_validate(file.model_dump(exclude_none=True))
        else:
            if config.shell is None:
                return fallback(f"workspace is not enabled; path {path!r} cannot be uploaded.")
            if not path or not path.strip():
                return fallback("workspace path must not be blank.")
            mapping = await upload_sandbox_path(deps.resources.shells[config.shell], path)
        if mapping.transfer_method == "remote_url":
            parsed = urlsplit(mapping.url or "")
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                return fallback("remote_url requires an HTTP(S) URL.")
        execution_context = DifyExecutionContextLayerConfig.model_validate(
            deps.layers[config.execution_context]["config"]
        )
        metadata = await request_agent_file_download(deps.services, execution_context, mapping, for_frontend=False)
        mime_type = normalize_media_mime(metadata.mime_type)
        if not mime_type or mime_type == "application/octet-stream":
            mime_type = normalize_media_mime(mimetypes.guess_type(metadata.filename)[0])
        modality = next((key for key, values in _MIMES_BY_MODALITY.items() if mime_type in values), None)
        size_label = f"{metadata.size} bytes" if metadata.size >= 0 else "unknown size"
        description = f"{metadata.filename} ({mime_type or 'unknown MIME'}, {size_label})"
        if modality is None:
            allowed = ", ".join(sorted(mime for values in _MIMES_BY_MODALITY.values() for mime in values))
            return fallback(f"unsupported format for {description}. Supported formats: {allowed}.")
        if modality not in llm.supported_modalities:
            return fallback(f"{description} requires {modality}, which model {model_name} does not support.")
        if metadata.size == 0:
            return fallback(f"{description} is empty.")
        limit = _MAX_BYTES_BY_MODALITY[modality]
        if metadata.size > limit:
            return fallback(f"{description} exceeds the {modality} limit of {limit} bytes.")
        locator = {"file": mapping.model_dump(mode="json", exclude_none=True)} if file is not None else {"path": path}
        media_url = (
            mapping.url
            if mapping.transfer_method == "remote_url"
            else (f"dify-file://{mapping.transfer_method}/{mapping.reference}")
        )
        assert media_url is not None
        media_part = _URL_CLASS_BY_MODALITY[modality](
            url=media_url,
            media_type=mime_type,
            vendor_metadata={
                "dify_read_media": True,
                "modality": modality,
                "filename": metadata.filename,
                "mime_type": mime_type,
                "size": metadata.size,
                "locator": locator,
                **({"detail": detail} if modality == "vision" else {}),
            },
        )
        summary = json.dumps(
            {
                "status": "loaded",
                "modality": modality,
                "filename": metadata.filename,
                "mime_type": mime_type,
                "size": metadata.size if metadata.size >= 0 else None,
                "locator": locator,
            },
            ensure_ascii=False,
        )
        marker = attachment_marker(modality, f"{metadata.filename}, {mime_type}, {size_label}")
        return ToolReturn(return_value=summary, content=[marker, media_part])
    except Exception as exc:
        return fallback(
            f"file/path is inaccessible or metadata validation failed ({type(exc).__name__}: {exc}). "
            "Check the file transfer_method and reference/url, or the workspace path."
        )
