from abc import ABC, abstractmethod

from core.sandbox.sandbox import Sandbox


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, env: Sandbox) -> None: ...

    def async_initialize(self) -> bool:
        """
        Whether the initializer needs to run asynchronously.
        """
        return False
