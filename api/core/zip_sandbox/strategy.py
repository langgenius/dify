from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class ZipStrategy(ABC):
    """Abstract base class for zip/unzip strategies."""

    @abstractmethod
    def is_available(self, vm: VirtualEnvironment) -> bool:
        """Check if this strategy is available in the given VM."""
        ...

    @abstractmethod
    def zip(
        self,
        vm: VirtualEnvironment,
        *,
        src: str,
        out_path: str,
        cwd: str | None,
        timeout: float,
    ) -> None:
        """Create a zip archive."""
        ...

    @abstractmethod
    def unzip(
        self,
        vm: VirtualEnvironment,
        *,
        archive_path: str,
        dest_dir: str,
        timeout: float,
    ) -> None:
        """Extract a zip archive."""
        ...
