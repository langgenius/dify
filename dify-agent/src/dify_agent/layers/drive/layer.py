"""Runtime Dify drive layer with eager pull for prompt-mentioned targets.

The API backend sends the full drive skill catalog plus the ordered drive keys
mentioned in the prompt. When the layer enters a run context it eagerly pulls
those mentioned skills/files from the Dify inner drive bridge, materializes them
under the fixed Agent Stub drive base for ``drive_ref``, and contributes a
concise prompt block describing what was loaded and what other skills remain
available for lazy pull. It also contributes a suffix prompt with
``dify-agent drive`` and ``dify-agent file`` usage so the model has concrete
Agent Stub commands for materializing drive content and workflow files when a
shell layer is available.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import Any, ClassVar, cast
from uuid import uuid4
from zipfile import BadZipFile, ZipFile, ZipInfo

import httpx
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, Layer, LayerDeps, PlainLayer
from dify_agent.agent_stub.protocol import agent_stub_drive_base_for_ref
from dify_agent.layers.drive.configs import DIFY_DRIVE_LAYER_TYPE_ID, DifyDriveLayerConfig

_SKILL_ARCHIVE_FILENAME = ".DIFY-SKILL-FULL.zip"
_DOWNLOAD_CONCURRENCY = 4
_AGENT_STUB_CLI_USAGE_PROMPT = """Agent Stub CLI usage is available inside shell jobs:

Drive commands:

- List drive items: `dify-agent drive list [PATH_PREFIX]`
- Emit the drive manifest as JSON: `dify-agent drive list [PATH_PREFIX] --json`
- Pull drive keys or prefixes: `dify-agent drive pull TARGET ...`
  Pulled files are written under `$DIFY_AGENT_STUB_DRIVE_BASE` by default.
  Use `--drive-base .` to materialize pulled files under the current working directory.
- Upload a local file or directory: `dify-agent drive push LOCAL_PATH DRIVE_PATH`
  Add `--recursive` to upload raw directory contents. Without `--recursive`, a directory must contain `SKILL.md`
  and is uploaded as a standardized skill.

File commands:

- Download one workflow file mapping: `dify-agent file download TRANSFER_METHOD REFERENCE_OR_URL [DIR]`
  `TRANSFER_METHOD` is one of `local_file`, `tool_file`, `datasource_file`, or `remote_url`.
  If `DIR` is omitted, the file is saved in the current working directory.
- Upload one sandbox-local output file: `dify-agent file upload PATH`
  The command prints a JSON file mapping such as `{"transfer_method":"tool_file","reference":"..."}`."""


class DifyDriveLayerError(RuntimeError):
    """Raised when one eager-pull drive operation fails."""


class DifyDriveDeps(LayerDeps):
    execution_context: Layer[Any, Any, Any, Any, Any, Any]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(frozen=True, slots=True)
class _DriveManifestItem:
    key: str
    download_url: str
    size: int | None = None


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
        return [_AGENT_STUB_CLI_USAGE_PROMPT]

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
            loaded_skill_sections.append(f"Path: {skill.path}\nName: {skill.name}\nSKILL.md:\n{body}")
        if loaded_skill_sections:
            sections.append("Loaded mentioned skills:\n\n" + "\n\n".join(loaded_skill_sections))

        mentioned_files = [
            f"- {key} -> {self._pulled_file_paths[key]}"
            for key in self.config.mentioned_file_keys
            if key in self._pulled_file_paths
        ]
        if mentioned_files:
            sections.append("Mentioned files pulled to local drive:\n" + "\n".join(mentioned_files))

        other_skills = [
            f"- {skill.path}: {skill.name} — {skill.description}"
            for skill in self.config.skills
            if skill.skill_md_key not in set(self.config.mentioned_skill_keys)
        ]
        if other_skills:
            sections.append("Other available skills:\n" + "\n".join(other_skills))

        if not sections:
            return ""
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
    ) -> list[_DriveManifestItem]:
        semaphore = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, trust_env=False) as client:

            async def fetch_one(target: tuple[str, bool]) -> list[_DriveManifestItem]:
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
                    payload = response.json()
                except ValueError as exc:
                    raise DifyDriveLayerError(f"drive manifest response is invalid for {prefix}") from exc
                items = payload.get("items") if isinstance(payload, dict) else None
                if not isinstance(items, list):
                    raise DifyDriveLayerError(f"drive manifest response is invalid for {prefix}")
                manifest_items: list[_DriveManifestItem] = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    key = item.get("key")
                    download_url = item.get("download_url")
                    if not isinstance(key, str) or not isinstance(download_url, str) or not download_url:
                        raise DifyDriveLayerError(f"drive manifest item is missing download_url for {prefix}")
                    if exact and key != prefix:
                        continue
                    manifest_items.append(_DriveManifestItem(key=key, download_url=download_url, size=item.get("size")))
                return manifest_items

            grouped_items = await asyncio.gather(*(fetch_one(target) for target in targets))

        deduplicated: dict[str, _DriveManifestItem] = {}
        for items in grouped_items:
            for item in items:
                deduplicated.setdefault(item.key, item)
        return [deduplicated[key] for key in sorted(deduplicated)]

    async def _download_items(self, items: list[_DriveManifestItem]) -> dict[str, str]:
        base_path = Path(agent_stub_drive_base_for_ref(self.config.drive_ref))
        try:
            base_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise DifyDriveLayerError(f"failed to prepare drive base {base_path}") from exc
        semaphore = asyncio.Semaphore(_DOWNLOAD_CONCURRENCY)
        archive_paths: list[Path] = []
        canonical_skill_dirs = {item.key.rsplit("/", 1)[0] for item in items if item.key.endswith("/SKILL.md")}

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, trust_env=False) as client:

            async def download_one(item: _DriveManifestItem) -> tuple[str, str]:
                try:
                    async with semaphore:
                        response = await client.get(item.download_url)
                except (httpx.InvalidURL, httpx.TimeoutException, httpx.RequestError) as exc:
                    raise DifyDriveLayerError(f"drive download failed for {item.key}") from exc
                if response.is_error:
                    raise DifyDriveLayerError(f"drive download failed for {item.key}: {response.status_code}")
                payload = response.content
                if item.size is not None and len(payload) != item.size:
                    raise DifyDriveLayerError(f"downloaded drive file size mismatch for {item.key}")
                try:
                    destination = _resolve_drive_destination(base_path, item.key)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temp_path = destination.with_name(f"{destination.name}.tmp-{uuid4().hex}")
                    temp_path.write_bytes(payload)
                    temp_path.replace(destination)
                except OSError as exc:
                    raise DifyDriveLayerError(f"failed to materialize drive file {item.key}") from exc
                if destination.name == _SKILL_ARCHIVE_FILENAME:
                    archive_paths.append(destination)
                return item.key, str(destination)

            pairs = await asyncio.gather(*(download_one(item) for item in items))
        for archive_path in sorted(archive_paths):
            archive_skill_dir = archive_path.parent.relative_to(base_path).as_posix()
            skip_entry_names = {"SKILL.md"} if archive_skill_dir in canonical_skill_dirs else set()
            _extract_skill_archive(archive_path, skip_entry_names=skip_entry_names)
        return {key: path for key, path in pairs}

    def _require_tenant_id(self) -> str:
        execution_context = self.deps.execution_context.config
        tenant_id = getattr(execution_context, "tenant_id", None)
        if not isinstance(tenant_id, str) or not tenant_id.strip():
            raise DifyDriveLayerError("DifyDriveLayer requires execution_context.tenant_id")
        return cast(str, tenant_id).strip()

    @staticmethod
    def _skill_prefix(skill_key: str) -> str:
        return f"{skill_key.rsplit('/', 1)[0]}/"


def _resolve_drive_destination(base_path: Path, drive_key: str) -> Path:
    destination = (base_path / Path(drive_key)).resolve()
    try:
        destination.relative_to(base_path)
    except ValueError as exc:
        raise DifyDriveLayerError(f"drive key resolves outside the drive base: {drive_key}") from exc
    return destination


def _extract_skill_archive(archive_path: Path, *, skip_entry_names: set[str]) -> None:
    target_dir = archive_path.parent.resolve()
    try:
        with TemporaryDirectory(dir=target_dir, prefix=".dify-skill-extract-") as staging_dir_name:
            staging_dir = Path(staging_dir_name).resolve()
            with ZipFile(archive_path) as archive:
                for zip_info in archive.infolist():
                    if zip_info.filename.replace("\\", "/").rstrip("/") in skip_entry_names:
                        continue
                    destination = _resolve_zip_entry_destination(staging_dir, zip_info.filename)
                    if _is_zip_symlink(zip_info):
                        raise DifyDriveLayerError(
                            f"skill archive contains unsupported symlink entry: {zip_info.filename}"
                        )
                    if zip_info.is_dir():
                        destination.mkdir(parents=True, exist_ok=True)
                        continue
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(zip_info) as source_file:
                        temp_path = destination.with_name(f"{destination.name}.tmp-{uuid4().hex}")
                        temp_path.write_bytes(source_file.read())
                        temp_path.replace(destination)
            for staged_path in sorted(staging_dir.rglob("*")):
                if staged_path.is_dir():
                    continue
                relative_path = staged_path.relative_to(staging_dir)
                destination = (target_dir / relative_path).resolve()
                destination.parent.mkdir(parents=True, exist_ok=True)
                staged_path.replace(destination)
    except DifyDriveLayerError:
        raise
    except (BadZipFile, OSError) as exc:
        raise DifyDriveLayerError(f"downloaded skill archive is invalid: {archive_path.name}") from exc


def _resolve_zip_entry_destination(target_dir: Path, entry_name: str) -> Path:
    normalized_name = entry_name.replace("\\", "/")
    pure_path = PurePosixPath(normalized_name)
    if not normalized_name or normalized_name.startswith("/") or pure_path.is_absolute():
        raise DifyDriveLayerError(f"skill archive contains unsafe absolute path: {entry_name}")
    if any(part in {"", ".", ".."} for part in pure_path.parts):
        raise DifyDriveLayerError(f"skill archive contains unsafe path traversal entry: {entry_name}")
    destination = (target_dir / Path(*pure_path.parts)).resolve()
    try:
        destination.relative_to(target_dir)
    except ValueError as exc:
        raise DifyDriveLayerError(f"skill archive entry resolves outside the skill directory: {entry_name}") from exc
    return destination


def _is_zip_symlink(zip_info: ZipInfo) -> bool:
    file_mode = zip_info.external_attr >> 16
    return (file_mode & 0o170000) == 0o120000


__all__ = ["DifyDriveLayer", "DifyDriveLayerError"]
