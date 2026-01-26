from core.sandbox.storage.sandbox_storage import SandboxStorage
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class NoopSandboxStorage(SandboxStorage):
    """A no-op storage implementation that does nothing on mount/unmount."""

    def mount(self, sandbox: VirtualEnvironment) -> bool:
        return False

    def unmount(self, sandbox: VirtualEnvironment) -> bool:
        return False

    def exists(self) -> bool:
        return False

    def delete(self) -> None:
        return
