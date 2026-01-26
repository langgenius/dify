"""
Execution Context - Abstracted context management for workflow execution.
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

    This abstraction allows workflow execution to work with or without Flask
    by providing a common interface for application context management.
    """

    @abstractmethod
    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        pass

    @abstractmethod
    def get_extension(self, name: str) -> Any:
        """Get Flask extension by name (e.g., 'db', 'cache')."""
        pass

    @abstractmethod
    def enter(self) -> AbstractContextManager[None]:
        """Enter the application context."""
        pass


@runtime_checkable
class IExecutionContext(Protocol):
    """
    Protocol for execution context.

    This protocol defines the interface that all execution contexts must implement,
    allowing both ExecutionContext and FlaskExecutionContext to be used interchangeably.
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
    Execution context for workflow execution in worker threads.

    This class encapsulates all context needed for workflow execution:
    - Application context (Flask app or standalone)
    - Context variables for Python contextvars
    - User information (optional)

    It is designed to be serializable and passable to worker threads.
    """

    def __init__(
        self,
        app_context: AppContext | None = None,
        context_vars: contextvars.Context | None = None,
        user: Any = None,
    ) -> None:
        """
        Initialize execution context.

        Args:
            app_context: Application context (Flask or standalone)
            context_vars: Python contextvars to preserve
            user: User object (optional)
        """
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
        """Get context variables."""
        return self._context_vars

    @property
    def user(self) -> Any:
        """Get user object."""
        return self._user

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """
        Enter this execution context.

        This is a convenience method that creates a context manager.
        """
        # Restore context variables if provided
        if self._context_vars:
            for var, val in self._context_vars.items():
                var.set(val)

        # Enter app context if available
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
    Null implementation of AppContext for non-Flask environments.

    This is used when running without Flask (e.g., in tests or standalone mode).
    """

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        """
        Initialize null app context.

        Args:
            config: Optional configuration dictionary
        """
        self._config = config or {}
        self._extensions: dict[str, Any] = {}

    def get_config(self, key: str, default: Any = None) -> Any:
        """Get configuration value by key."""
        return self._config.get(key, default)

    def get_extension(self, name: str) -> Any:
        """Get extension by name."""
        return self._extensions.get(name)

    def set_extension(self, name: str, extension: Any) -> None:
        """Set extension by name."""
        self._extensions[name] = extension

    @contextmanager
    def enter(self) -> Generator[None, None, None]:
        """Enter null context (no-op)."""
        yield


class ExecutionContextBuilder:
    """
    Builder for creating ExecutionContext instances.

    This provides a fluent API for building execution contexts.
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

# Tenant-scoped providers using tuple keys for clarity and constant-time lookup.
# Key mapping:
#   (name, tenant_id) -> provider
# - name: namespaced identifier (recommend prefixing, e.g. "workflow.sandbox")
# - tenant_id: tenant identifier string
# Value:
#   provider: Callable[[], BaseModel] returning the typed context value
# Type-safety note:
#   - This registry cannot enforce that all providers for a given name return the same BaseModel type.
#   - Implementors SHOULD provide typed wrappers around register/read (like Go's context best practice),
#     e.g. def register_sandbox_ctx(tenant_id: str, p: Callable[[], SandboxContext]) and
#          def read_sandbox_ctx(tenant_id: str) -> SandboxContext.
_tenant_context_providers: dict[tuple[str, str], Callable[[], BaseModel]] = {}

T = TypeVar("T", bound=BaseModel)


class ContextProviderNotFoundError(KeyError):
    """Raised when a tenant-scoped context provider is missing for a given (name, tenant_id)."""

    pass


def register_context_capturer(capturer: Callable[[], IExecutionContext]) -> None:
    """Register a single enterable execution context capturer (e.g., Flask)."""
    global _capturer
    _capturer = capturer


def register_context(name: str, tenant_id: str, provider: Callable[[], BaseModel]) -> None:
    """Register a tenant-specific provider for a named context.

    Tip: use a namespaced "name" (e.g., "workflow.sandbox") to avoid key collisions.
    Consider adding a typed wrapper for this registration in your feature module.
    """
    _tenant_context_providers[(name, tenant_id)] = provider


def read_context(name: str, *, tenant_id: str) -> BaseModel:
    """
    Read a context value for a specific tenant.

    Raises KeyError if the provider for (name, tenant_id) is not registered.
    """
    prov = _tenant_context_providers.get((name, tenant_id))
    if prov is None:
        raise ContextProviderNotFoundError(f"Context provider '{name}' not registered for tenant '{tenant_id}'")
    return prov()


def capture_current_context() -> IExecutionContext:
    """
    Capture current execution context from the calling environment.

    If a capturer is registered (e.g., Flask), use it. Otherwise, return a minimal
    context with NullAppContext + copy of current contextvars.
    """
    if _capturer is None:
        return ExecutionContext(
            app_context=NullAppContext(),
            context_vars=contextvars.copy_context(),
        )
    return _capturer()


def reset_context_provider() -> None:
    """Reset the capturer and all tenant-scoped context providers (primarily for tests)."""
    global _capturer
    _capturer = None
    _tenant_context_providers.clear()
