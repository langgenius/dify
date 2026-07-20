"""Public sandbox DTOs shared by the API and Dify Agent backends.

The sandbox file APIs must rebuild only the minimum runtime needed to re-enter a
prior shell session: ``dify.execution_context`` for Dify-owned identity and
``dify.shell`` for the sandbox workspace itself. ``SandboxLocator`` therefore
contains a safe composition subset plus the matching filtered session snapshot.
Credential-bearing or runtime-only tool layers are intentionally excluded from
persisted runtime specs and from sandbox locators.
"""

from __future__ import annotations

from typing import ClassVar, Literal, cast

from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from dify_agent.layers.dify_core_tools import DIFY_CORE_TOOLS_LAYER_TYPE_ID
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LLM_LAYER_TYPE_ID, DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID
from pydantic import BaseModel, ConfigDict, Field, JsonValue

from .schemas import CreateRunRequest, RunComposition, RunLayerSpec

_SENSITIVE_LAYER_TYPES = frozenset(
    {
        DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
        DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
        DIFY_CORE_TOOLS_LAYER_TYPE_ID,
    }
)


class RuntimeLayerSpec(BaseModel):
    """Persistable non-sensitive layer spec derived from a run composition.

    API-side runtime-session rows store these specs so later cleanup or sandbox
    requests can rebuild the minimal layer graph without persisting model or
    tool credentials.
    """

    name: str
    type: str
    deps: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    config: JsonValue = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxLocator(BaseModel):
    """Safe subset of one prior run request needed to re-enter a sandbox shell."""

    composition: RunComposition
    session_snapshot: CompositorSessionSnapshot

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxFileEntry(BaseModel):
    """One directory entry returned by ``/sandbox/files/list``."""

    name: str
    type: Literal["file", "dir", "symlink", "other"]
    size: int | None = None
    mtime: int | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxListRequest(BaseModel):
    """Request body for listing a sandbox directory."""

    locator: SandboxLocator
    path: str = "."

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxListResponse(BaseModel):
    """Structured sandbox directory listing."""

    path: str
    entries: list[SandboxFileEntry]
    truncated: bool

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxReadRequest(BaseModel):
    """Request body for reading a sandbox file preview."""

    locator: SandboxLocator
    path: str
    max_bytes: int = 262144

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxReadResponse(BaseModel):
    """Text preview returned by ``/sandbox/files/read``."""

    path: str
    size: int | None = None
    truncated: bool
    binary: bool
    text: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadedFile(BaseModel):
    """Canonical ToolFile mapping returned after sandbox upload."""

    transfer_method: Literal["tool_file"] = "tool_file"
    reference: str
    download_url: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadRequest(BaseModel):
    """Request body for uploading one sandbox file through the Agent Stub."""

    locator: SandboxLocator
    path: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadResponse(BaseModel):
    """Result returned after sandbox upload creates a ToolFile mapping."""

    path: str
    file: SandboxUploadedFile

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def extract_runtime_layer_specs(composition: RunComposition) -> list[RuntimeLayerSpec]:
    """Project a run composition into the persistable non-sensitive layer list."""
    specs: list[RuntimeLayerSpec] = []
    for layer in composition.layers:
        if layer.type in _SENSITIVE_LAYER_TYPES:
            continue
        config_value: JsonValue = None
        if isinstance(layer.config, BaseModel):
            config_value = layer.config.model_dump(mode="json", warnings=False)
        else:
            config_value = cast(JsonValue, layer.config)
        specs.append(
            RuntimeLayerSpec(
                name=layer.name,
                type=layer.type,
                deps=dict(layer.deps),
                metadata=dict(layer.metadata),
                config=config_value,
            )
        )
    return specs


def build_sandbox_locator_from_run_request(request: CreateRunRequest) -> SandboxLocator:
    """Build a safe sandbox locator from a full create-run request.

    Raises:
        ValueError: if the request has no resumable session snapshot or lacks the
            execution-context/shell layers needed for sandbox access.
    """
    if request.session_snapshot is None:
        raise ValueError("Sandbox locator requires a non-empty session_snapshot.")
    return build_sandbox_locator_from_layer_specs(
        layer_specs=extract_runtime_layer_specs(request.composition),
        session_snapshot=request.session_snapshot,
    )


def build_sandbox_locator_from_layer_specs(
    *,
    layer_specs: list[RuntimeLayerSpec],
    session_snapshot: CompositorSessionSnapshot,
) -> SandboxLocator:
    """Build a sandbox locator from persisted runtime specs plus a saved snapshot."""
    if not layer_specs:
        raise ValueError("Sandbox locator requires persisted runtime layer specs.")

    for spec in layer_specs:
        if spec.type in _SENSITIVE_LAYER_TYPES:
            raise ValueError(f"Sandbox locator runtime specs must not include sensitive layer type {spec.type!r}.")

    execution_context_index = next(
        (index for index, spec in enumerate(layer_specs) if spec.name == "execution_context"),
        None,
    )
    shell_index = next((index for index, spec in enumerate(layer_specs) if spec.name == "shell"), None)
    if execution_context_index is None:
        raise ValueError("Sandbox locator requires an 'execution_context' runtime layer spec.")
    if shell_index is None:
        raise ValueError("Sandbox locator requires a 'shell' runtime layer spec.")
    if execution_context_index > shell_index:
        raise ValueError("Sandbox locator requires 'execution_context' to appear before 'shell'.")

    execution_context_spec = layer_specs[execution_context_index]
    shell_spec = layer_specs[shell_index]
    if shell_spec.deps.get("execution_context") != execution_context_spec.name:
        raise ValueError("Sandbox shell layer must depend on the execution_context layer.")

    kept_specs = [execution_context_spec, shell_spec]
    kept_names = [spec.name for spec in kept_specs]
    snapshot_layers = [layer for layer in session_snapshot.layers if layer.name in set(kept_names)]
    if [layer.name for layer in snapshot_layers] != kept_names:
        raise ValueError("Sandbox locator session_snapshot must contain execution_context and shell layers in order.")

    return SandboxLocator(
        composition=RunComposition(
            schema_version=1,
            layers=[
                RunLayerSpec(
                    name=spec.name,
                    type=spec.type,
                    deps=dict(spec.deps),
                    metadata=dict(spec.metadata),
                    config=spec.config,
                )
                for spec in kept_specs
            ],
        ),
        session_snapshot=CompositorSessionSnapshot(
            schema_version=session_snapshot.schema_version,
            layers=[
                LayerSessionSnapshot(
                    name=layer.name,
                    lifecycle_state=layer.lifecycle_state,
                    runtime_state=dict(layer.runtime_state),
                )
                for layer in snapshot_layers
            ],
        ),
    )


__all__ = [
    "RuntimeLayerSpec",
    "SandboxFileEntry",
    "SandboxListRequest",
    "SandboxListResponse",
    "SandboxLocator",
    "SandboxReadRequest",
    "SandboxReadResponse",
    "SandboxUploadRequest",
    "SandboxUploadResponse",
    "SandboxUploadedFile",
    "build_sandbox_locator_from_layer_specs",
    "build_sandbox_locator_from_run_request",
    "extract_runtime_layer_specs",
]
