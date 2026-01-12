"""
Sandbox initializer protocol for post-construction initialization.

This module defines the interface for initializers that can perform
setup tasks on newly created VirtualEnvironment instances.
"""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.virtual_environment.__base.virtual_environment import VirtualEnvironment


class SandboxInitializer(ABC):
    """
    Abstract base class for sandbox post-construction initialization.

    Initializers are called by VMFactory after a VirtualEnvironment is created.
    They allow decoupling of environment creation from environment setup tasks
    like uploading binaries, configuring tools, or setting up directories.

    Example:
        class MyInitializer(SandboxInitializer):
            def initialize(self, env: VirtualEnvironment) -> None:
                env.upload_file("/path/to/file", BytesIO(b"content"))
    """

    @abstractmethod
    def initialize(self, env: "VirtualEnvironment") -> None:
        """
        Perform initialization on a newly created sandbox.

        Called by VMFactory after VirtualEnvironment._construct_environment().
        Implementations should be idempotent where possible.

        Args:
            env: The virtual environment to initialize.

        Raises:
            Exception: If initialization fails. The caller is responsible
                for handling cleanup.
        """
        ...
