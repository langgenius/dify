"""Factory type for constructing container handlers."""

from collections.abc import Callable

from ..frame import FrameRegistry
from .protocol import ContainerHandler

type ContainerHandlerFactory = Callable[[FrameRegistry], ContainerHandler]
