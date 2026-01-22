from abc import ABC, abstractmethod

from core.sandbox.sandbox import Sandbox


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, sandbox: Sandbox) -> None: ...


class SyncSandboxInitializer(SandboxInitializer):
    """Marker class for initializers that must run before async setup."""


class AsyncSandboxInitializer(SandboxInitializer):
    """Marker class for initializers that can run in the background."""
