from abc import ABC, abstractmethod

from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class SandboxInitializer(ABC):
    @abstractmethod
    def initialize(self, env: VirtualEnvironment) -> None: ...
