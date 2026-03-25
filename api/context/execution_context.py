"""
Application-layer execution context adapters.

Concrete context capture lives outside `graphon` so the graph package only
consumes injected context managers when it needs to preserve thread-local state.
"""

import contextvars
import threading
from abc import ABC, abstractmethod
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from typing import Any, Protocol, TypeVar, final, runtime_checkable

from pydantic import BaseModel


class AppContext(ABC):
    """
    Abstract application context interface.

    Application adapters can implement this to restore framework-specific state
    such as Flask app context around worker execution.
    """

    @abstractmethod
    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        raise NotImplementedError

    @abstractmethod
    def get_extension(self, name: str) -> Any:
        """Get application extension by name."""
        raise NotImplementedError

    @abstractmethod
    def enter(self) -> AbstractContextManager[None]:
        """Enter the application context."""
        raise NotImplementedError


@runtime_checkable
class IExecutionContext(Protocol):
    """
    Protocol for enterable execution context objects.

    Concrete implementations may carry extra framework state, but callers only
    depend on standard context-manager behavior plus optional user metadata.
    """

    def __enter__(self) -> "IExecutionContext":
        """Enter the execution context."""
        ...

    def __exit__(self, *args: Any) -> None:
        """Exit the execution context."""
        ...

    @property
    def user(self) -> Any:
        """Get user object."""
        ...


@final
class ExecutionContext:
    """
    Generic execution context used by application-layer adapters.

    It restores captured `contextvars` and optionally enters an application
    context before the worker executes graph logic.
    """

    def __init__(
        self,
        app_context: AppContext | None = None,
        context_vars: contextvars.Context | None = None,
        user: Any = None,
    ) -> None:
        self._app_context = app_context
        self._context_vars = context_vars
        self._user = user
        self._local = threading.local()

    @property
    def app_context(self) -> AppContext | None:
        """Get application context."""
        return self._app_context

    @property
    def context_vars(self) -> contextvars.Context | None:
        """Get captured context variables."""
        return self._context_vars

    @property
    def user(self) -> Any:
        """Get captured user object."""
        return self._user

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter this execution context."""
        if self._context_vars:
            for var, val in self._context_vars.items():
                var.set(val)

        if self._app_context is not None:
            with self._app_context.enter():
                yield
        else:
            yield

    def __enter__(self) -> "ExecutionContext":
        """Enter the execution context."""
        cm = self.enter()
        self._local.cm = cm
        cm.__enter__()
        return self

    def __exit__(self, *args: Any) -> None:
        """Exit the execution context."""
        cm = getattr(self._local, "cm", None)
        if cm is not None:
            cm.__exit__(*args)


class NullAppContext(AppContext):
    """
    Null application context for non-framework environments.
    """

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self._config = config or {}
        self._extensions: dict[str, Any] = {}

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        return self._config.get(key, default)

    def get_extension(self, name: str) -> Any:
        """Get extension by name."""
        return self._extensions.get(name)

    def set_extension(self, name: str, extension: Any) -> None:
        """Register an extension for tests or standalone execution."""
        self._extensions[name] = extension

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter null context (no-op)."""
        yield


class ExecutionContextBuilder:
    """
    Builder for creating `ExecutionContext` instances.
    """

    def __init__(self) -> None:
        self._app_context: AppContext | None = None
        self._context_vars: contextvars.Context | None = None
        self._user: Any = None

    def with_app_context(self, app_context: AppContext) -> "ExecutionContextBuilder":
        """Set application context."""
        self._app_context = app_context
        return self

    def with_context_vars(self, context_vars: contextvars.Context) -> "ExecutionContextBuilder":
        """Set context variables."""
        self._context_vars = context_vars
        return self

    def with_user(self, user: Any) -> "ExecutionContextBuilder":
        """Set user."""
        self._user = user
        return self

    def build(self) -> ExecutionContext:
        """Build the execution context."""
        return ExecutionContext(
            app_context=self._app_context,
            context_vars=self._context_vars,
            user=self._user,
        )


_capturer: Callable[[], IExecutionContext] | None = None
_tenant_context_providers: dict[tuple[str, str], Callable[[], BaseModel]] = {}

T = TypeVar("T", bound=BaseModel)


class ContextProviderNotFoundError(KeyError):
    """Raised when a tenant-scoped context provider is missing."""

    pass


def register_context_capturer(capturer: Callable[[], IExecutionContext]) -> None:
    """Register an enterable execution context capturer."""
    global _capturer
    _capturer = capturer


def register_context(name: str, tenant_id: str, provider: Callable[[], BaseModel]) -> None:
    """Register a tenant-specific provider for a named context."""
    _tenant_context_providers[(name, tenant_id)] = provider


def read_context(name: str, *, tenant_id: str) -> BaseModel:
    """Read a context value for a specific tenant."""
    provider = _tenant_context_providers.get((name, tenant_id))
    if provider is None:
        raise ContextProviderNotFoundError(f"Context provider '{name}' not registered for tenant '{tenant_id}'")
    return provider()


def capture_current_context() -> IExecutionContext:
    """
    Capture current execution context from the calling environment.

    If no framework adapter is registered, return a minimal context that only
    restores `contextvars`.
    """
    if _capturer is None:
        return ExecutionContext(
            app_context=NullAppContext(),
            context_vars=contextvars.copy_context(),
        )
    return _capturer()


def reset_context_provider() -> None:
    """Reset the capturer and tenant-scoped providers."""
    global _capturer
    _capturer = None
    _tenant_context_providers.clear()


__all__ = [
    "AppContext",
    "ContextProviderNotFoundError",
    "ExecutionContext",
    "ExecutionContextBuilder",
    "IExecutionContext",
    "NullAppContext",
    "capture_current_context",
    "read_context",
    "register_context",
    "register_context_capturer",
    "reset_context_provider",
]
