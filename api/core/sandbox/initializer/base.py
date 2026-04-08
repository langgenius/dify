from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from core.sandbox.sandbox import Sandbox

if TYPE_CHECKING:
    from core.app_assets.entities.assets import AssetItem


@dataclass
class SandboxInitializeContext:
    """Shared identity context passed to every ``SandboxInitializer``.

    Carries the common identity fields that virtually every initializer
    needs, plus optional artefact slots that sync initializers populate
    for async initializers to consume.

    Identity fields are immutable by convention; artefact slots are
    written at most once during the sync phase and read during the
    async phase.
    """

    tenant_id: str
    app_id: str
    assets_id: str
    user_id: str

    # Populated by DraftAppAssetsInitializer (sync) for
    # DraftAppAssetsDownloader (async) to download into the VM.
    built_assets: list[AssetItem] | None = field(default=None)


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, sandbox: Sandbox, ctx: SandboxInitializeContext) -> None: ...


class SyncSandboxInitializer(SandboxInitializer):
    """Marker class for initializers that must run before async setup."""


class AsyncSandboxInitializer(SandboxInitializer):
    """Marker class for initializers that can run in the background."""
