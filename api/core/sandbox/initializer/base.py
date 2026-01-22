from abc import ABC, abstractmethod

from core.sandbox.sandbox import Sandbox


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, env: Sandbox) -> None: ...
