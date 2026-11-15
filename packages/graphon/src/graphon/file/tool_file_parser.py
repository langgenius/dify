from collections.abc import Callable
from typing import Any

ToolFileManagerFactory = Callable[[], Any]


class ToolFileManagerFactoryNotSetError(RuntimeError):
    """Raised when code requires a configured tool file manager factory."""

    def __init__(self) -> None:
        super().__init__(
            "Tool file manager factory is not configured. "
            "Call set_tool_file_manager_factory(...)."
        )


class _ToolFileManagerFactoryRegistry:
    """Store the active tool file manager factory behind an explicit API."""

    def __init__(self) -> None:
        self._factory: ToolFileManagerFactory | None = None

    def get(self) -> ToolFileManagerFactory | None:
        return self._factory

    def require(self) -> ToolFileManagerFactory:
        factory = self.get()
        if factory is None:
            raise ToolFileManagerFactoryNotSetError
        return factory

    def set(self, factory: ToolFileManagerFactory) -> None:
        self._factory = factory


_tool_file_manager_factory_registry = _ToolFileManagerFactoryRegistry()


def get_tool_file_manager_factory() -> ToolFileManagerFactory | None:
    return _tool_file_manager_factory_registry.get()


def require_tool_file_manager_factory() -> ToolFileManagerFactory:
    return _tool_file_manager_factory_registry.require()


def set_tool_file_manager_factory(factory: ToolFileManagerFactory) -> None:
    """Compatibility wrapper around the registry's explicit setter."""

    _tool_file_manager_factory_registry.set(factory)


__all__ = [
    "ToolFileManagerFactory",
    "ToolFileManagerFactoryNotSetError",
    "get_tool_file_manager_factory",
    "require_tool_file_manager_factory",
    "set_tool_file_manager_factory",
]
