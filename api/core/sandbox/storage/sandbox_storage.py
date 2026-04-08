from abc import ABC, abstractmethod

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class SandboxStorage(ABC):
    @abstractmethod
    def mount(self, sandbox: VirtualEnvironment) -> bool:
        """Load files from storage into VM. Returns True if files were loaded."""

    @abstractmethod
    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        """Save files from VM to storage. Returns True if files were saved."""

    @abstractmethod
    def exists(self) -> bool:
        """Check if storage has saved data."""

    @abstractmethod
    def delete(self) -> None:
        """Delete saved data from storage."""
