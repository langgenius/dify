"""Runtime Dify drive layer with eager pull for prompt-mentioned targets.

The API backend sends the full drive skill catalog plus the ordered drive keys
mentioned in the prompt. When the layer enters a run context it eagerly pulls
those mentioned skills/files from the Dify inner drive bridge, materializes them
under the fixed Agent Stub drive base for ``drive_ref``, and contributes a
concise prompt block describing what was loaded. It also contributes a suffix
prompt with the remaining skill catalog plus ``dify-agent drive`` and
``dify-agent file`` usage so the model has concrete Agent Stub commands for
materializing drive content and workflow files when a shell layer is available.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar, cast

import httpx
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, Layer, LayerDeps, PlainLayer
from dify_agent.agent_stub._drive_materialization import (
    DriveDownloadPayload,
    DriveMaterializationTransferError,
    DriveMaterializationValidationError,
    materialize_drive_downloads,
)
from dify_agent.agent_stub.protocol import agent_stub_drive_base_for_ref
from dify_agent.agent_stub.protocol.agent_stub import AgentStubDriveItem, AgentStubDriveManifestResponse
from dify_agent.layers.drive.configs import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig

_DOWNLOAD_CONCURRENCY = 4
_AGENT_STUB_CLI_USAGE_PROMPT = """Agent Stub CLI usage is available inside shell jobs:

Drive assets are Agent Soul versioned assets:

- List drive assets: `dify-agent drive list [REMOTE_PREFIX]`
- Pull drive assets: `dify-agent drive pull [REMOTE ...] [--to LOCAL_DIR]`
  With no remote, pulls the whole visible drive. Pull overwrites local files.
  Defaults to `$DIFY_AGENT_STUB_DRIVE_BASE`; use `--to .` for cwd.
  `--to` is a local root; remote keys keep their path under it.
  Skill archives are automatically extracted after pull.
- Push one file: `dify-agent drive push LOCAL_FILE REMOTE_PATH`
- Push a skill package: `dify-agent drive push LOCAL_DIR REMOTE_PATH --kind skill`
- Push a raw directory: `dify-agent drive push LOCAL_DIR REMOTE_PATH --kind dir`

Workflow file mappings:

- Download a mapping: `dify-agent file download TRANSFER_METHOD REFERENCE_OR_URL [--to LOCAL_DIR]`
- Or pass a mapping object: `dify-agent file download --mapping '{"transfer_method":"tool_file","reference":"..."}'`
- Upload an output file: `dify-agent file upload PATH`
  Prints JSON like `{"transfer_method":"tool_file","reference":"..."}`."""


class DifyDriveLayerError(RuntimeError):
    """Raised when one eager-pull drive operation fails."""


class DifyDriveDeps(LayerDeps):
    execution_context: Layer[Any, Any, Any, Any, Any, Any]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class DifyDriveLayer(PlainLayer[DifyDriveDeps, DifyDriveLayerConfig, EmptyRuntimeState]):
    """Drive runtime layer that eagerly materializes prompt-mentioned drive targets."""

    type_id: ClassVar[str | None] = DIFY_DRIVE_LAYER_TYPE_ID

    config: DifyDriveLayerConfig
    inner_api_url: str
    inner_api_key: str
    _loaded_skill_bodies: dict[str, str] = field(default_factory=dict)
    _pulled_file_paths: dict[str, str] = field(default_factory=dict)

    @classmethod
    @override
    def from_config(cls, config: DifyDriveLayerConfig) -> Self:
        del config
        raise TypeError("DifyDriveLayer requires server-side Dify API settings and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyDriveLayerConfig,
        *,
        inner_api_url: str,
        inner_api_key: str,
    ) -> Self:
        return cls(
            config=DifyDriveLayerConfig.model_validate(config),
            inner_api_url=inner_api_url.rstrip("/"),
            inner_api_key=inner_api_key,
        )

    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return [self.build_prompt_context()]

    @property
    @override
    def suffix_prompts(self) -> list[str]:
        return [self.build_suffix_prompt()]

    @override
    async def on_context_create(self) -> None:
        await self._pull_mentioned_targets()

    @override
    async def on_context_resume(self) -> None:
        await self._pull_mentioned_targets()

    def build_prompt_context(self) -> str:
        sections: list[str] = []

        loaded_skill_sections: list[str] = []
        for skill_key in self.config.mentioned_skill_keys:
            body = self._loaded_skill_bodies.get(skill_key)
            if body is None:
                continue
            skill = next((item for item in self.config.skills if item.skill_md_key == skill_key), None)
            if skill is None:
                continue
            pulled_skill_path = self._pulled_file_paths.get(skill_key)
            if pulled_skill_path is None:
                continue
            local_path = Path(pulled_skill_path).parent
            loaded_skill_sections.append(
                f"Path: {skill.path}\nLocal path: {local_path}\nName: {skill.name}\nSKILL.md:\n{body}"
            )
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_files = [
            f"- {key} -> {self._pulled_file_paths[key]}"
            for key in self.config.mentioned_file_keys
            if key in self._pulled_file_paths
        ]
        if mentioned_files:
            sections.append("Mentioned files pulled to local drive:\n" + "\n".join(mentioned_files))

        if not sections:
            return ""
        return "\n\n".join(sections)

    def build_suffix_prompt(self) -> str:
        sections: list[str] = []
        mentioned_skill_keys = set(self.config.mentioned_skill_keys)
        other_skills = [
            f"- {skill.path}: {skill.name} — {skill.description}"
            for skill in self.config.skills
            if skill.skill_md_key not in mentioned_skill_keys
        ]
        if other_skills:
            sections.append(
                "Other available skills:\n"
                + "\n".join(other_skills)
                + "\n\nIf you want to use one, pull it with `dify-agent drive pull <SKILL_PATH>/`, "
                "then read the pulled skill content before using it."
            )
        sections.append(_AGENT_STUB_CLI_USAGE_PROMPT)
        return "\n\n".join(sections)

    async def _pull_mentioned_targets(self) -> None:
        self._loaded_skill_bodies = {}
        self._pulled_file_paths = {}
        targets: list[tuple[str, bool]] = [
            (self._skill_prefix(skill_key), False) for skill_key in self.config.mentioned_skill_keys
        ] + [(file_key, True) for file_key in self.config.mentioned_file_keys]
        if not targets:
            return

        tenant_id = self._require_tenant_id()
        manifest_items = await self._fetch_manifest_items(tenant_id=tenant_id, targets=targets)
        written_paths = await self._download_items(manifest_items)
        self._pulled_file_paths = written_paths
        for file_key in self.config.mentioned_file_keys:
            if file_key not in written_paths:
                raise DifyDriveLayerError(f"missing pulled file for mentioned drive key {file_key}")
        for skill_key in self.config.mentioned_skill_keys:
            skill_path = written_paths.get(skill_key)
            if skill_path is None:
                raise DifyDriveLayerError(f"missing pulled SKILL.md for mentioned skill {skill_key}")
            try:
                self._loaded_skill_bodies[skill_key] = Path(skill_path).read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                raise DifyDriveLayerError(f"failed to load pulled SKILL.md for mentioned skill {skill_key}") from exc

    async def _fetch_manifest_items(
        self,
        *,
        tenant_id: str,
        targets: list[tuple[str, bool]],
    ) -> list[AgentStubDriveItem]:
        semaphore = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, trust_env=False) as client:

            async def fetch_one(target: tuple[str, bool]) -> list[AgentStubDriveItem]:
                prefix, exact = target
                try:
                    async with semaphore:
                        response = await client.get(
                            f"{self.inner_api_url}/inner/api/drive/{self.config.drive_ref}/manifest",
                            params={
                                "tenant_id": tenant_id,
                                "prefix": prefix,
                                "include_download_url": "true",
                            },
                            headers={"X-Inner-Api-Key": self.inner_api_key},
                        )
                except (httpx.InvalidURL, httpx.TimeoutException, httpx.RequestError) as exc:
                    raise DifyDriveLayerError(f"drive manifest request failed for {prefix}") from exc
                if response.is_error:
                    raise DifyDriveLayerError(f"drive manifest request failed for {prefix}: {response.status_code}")
                try:
                    payload = AgentStubDriveManifestResponse.model_validate(response.json())
                except (ValueError, TypeError) as exc:
                    raise DifyDriveLayerError(f"drive manifest response is invalid for {prefix}") from exc
                manifest_items: list[AgentStubDriveItem] = []
                for item in payload.items:
                    if not item.download_url:
                        raise DifyDriveLayerError(f"drive manifest item is missing download_url for {prefix}")
                    if exact and item.key != prefix:
                        continue
                    manifest_items.append(item)
                return manifest_items

            grouped_items = await asyncio.gather(*(fetch_one(target) for target in targets))

        deduplicated: dict[str, AgentStubDriveItem] = {}
        for items in grouped_items:
            for item in items:
                deduplicated.setdefault(item.key, item)
        return [deduplicated[key] for key in sorted(deduplicated)]

    async def _download_items(self, items: list[AgentStubDriveItem]) -> dict[str, str]:
        base_path = Path(agent_stub_drive_base_for_ref(self.config.drive_ref))
        semaphore = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, trust_env=False) as client:

            async def download_one(item: AgentStubDriveItem) -> DriveDownloadPayload:
                download_url = item.download_url
                if not download_url:
                    raise DifyDriveLayerError(f"drive manifest item is missing download_url for {item.key}")
                try:
                    async with semaphore:
                        response = await client.get(download_url)
                except (httpx.InvalidURL, httpx.TimeoutException, httpx.RequestError) as exc:
                    raise DifyDriveLayerError(f"drive download failed for {item.key}") from exc
                if response.is_error:
                    raise DifyDriveLayerError(f"drive download failed for {item.key}: {response.status_code}")
                return DriveDownloadPayload(key=item.key, payload=response.content, size=item.size)

            downloads = await asyncio.gather(*(download_one(item) for item in items))

        try:
            written_paths = materialize_drive_downloads(
                base_path=base_path,
                downloads=downloads,
            )
        except (DriveMaterializationValidationError, DriveMaterializationTransferError) as exc:
            raise DifyDriveLayerError(str(exc)) from exc

        return {download.key: str(path) for download, path in zip(downloads, written_paths, strict=True)}

    def _require_tenant_id(self) -> str:
        execution_context = self.deps.execution_context.config
        tenant_id = getattr(execution_context, "tenant_id", None)
        if not isinstance(tenant_id, str) or not tenant_id.strip():
            raise DifyDriveLayerError("DifyDriveLayer requires execution_context.tenant_id")
        return cast(str, tenant_id).strip()

    @staticmethod
    def _skill_prefix(skill_key: str) -> str:
        return f"{skill_key.rsplit('/', 1)[0]}/"


__all__ = ["DifyDriveLayer", "DifyDriveLayerError"]
