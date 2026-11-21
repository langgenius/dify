"""Container handler contracts and built-in implementations."""

from .builtin.iteration import IterationContainerHandler
from .builtin.loop import LoopContainerHandler
from .container_handler_factory import ContainerHandlerFactory
from .protocol import ContainerHandler

__all__ = [
    "ContainerHandler",
    "ContainerHandlerFactory",
    "IterationContainerHandler",
    "LoopContainerHandler",
]
