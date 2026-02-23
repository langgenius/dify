"""Tests for execution context module."""

import contextvars
import threading
from contextlib import contextmanager
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from core.workflow.context.execution_context import (
    AppContext,
    ExecutionContext,
    ExecutionContextBuilder,
    IExecutionContext,
    NullAppContext,
    read_context,
    register_context,
)


class TestAppContext:
    """Test AppContext abstract base class."""

    def test_app_context_is_abstract(self):
        """Test that AppContext cannot be instantiated directly."""
        with pytest.raises(TypeError):
            AppContext()  # type: ignore


class TestNullAppContext:
    """Test NullAppContext implementation."""

    def test_null_app_context_get_config(self):
        """Test get_config returns value from config dict."""
        config = {"key1": "value1", "key2": "value2"}
        ctx = NullAppContext(config=config)

        assert ctx.get_config("key1") == "value1"
        assert ctx.get_config("key2") == "value2"

    def test_null_app_context_get_config_default(self):
        """Test get_config returns default when key not found."""
        ctx = NullAppContext()

        assert ctx.get_config("nonexistent", "default") == "default"
        assert ctx.get_config("nonexistent") is None

    def test_null_app_context_get_extension(self):
        """Test get_extension returns stored extension."""
        ctx = NullAppContext()
        extension = MagicMock()
        ctx.set_extension("db", extension)

        assert ctx.get_extension("db") == extension

    def test_null_app_context_get_extension_not_found(self):
        """Test get_extension returns None when extension not found."""
        ctx = NullAppContext()

        assert ctx.get_extension("nonexistent") is None

    def test_null_app_context_enter_yield(self):
        """Test enter method yields without any side effects."""
        ctx = NullAppContext()

        with ctx.enter():
            # Should not raise any exception
            pass


class TestExecutionContext:
    """Test ExecutionContext class."""

    def test_initialization_with_all_params(self):
        """Test ExecutionContext initialization with all parameters."""
        app_ctx = NullAppContext()
        context_vars = contextvars.copy_context()
        user = MagicMock()

        ctx = ExecutionContext(
            app_context=app_ctx,
            context_vars=context_vars,
            user=user,
        )

        assert ctx.app_context == app_ctx
        assert ctx.context_vars == context_vars
        assert ctx.user == user

    def test_initialization_with_minimal_params(self):
        """Test ExecutionContext initialization with minimal parameters."""
        ctx = ExecutionContext()

        assert ctx.app_context is None
        assert ctx.context_vars is None
        assert ctx.user is None

    def test_enter_with_context_vars(self):
        """Test enter restores context variables."""
        test_var = contextvars.ContextVar("test_var")
        test_var.set("original_value")

        # Copy context with the variable
        context_vars = contextvars.copy_context()

        # Change the variable
        test_var.set("new_value")

        # Create execution context and enter it
        ctx = ExecutionContext(context_vars=context_vars)

        with ctx.enter():
            # Variable should be restored to original value
            assert test_var.get() == "original_value"

        # After exiting, variable stays at the value from within the context
        # (this is expected Python contextvars behavior)
        assert test_var.get() == "original_value"

    def test_enter_with_app_context(self):
        """Test enter enters app context if available."""
        app_ctx = NullAppContext()
        ctx = ExecutionContext(app_context=app_ctx)

        # Should not raise any exception
        with ctx.enter():
            pass

    def test_enter_without_app_context(self):
        """Test enter works without app context."""
        ctx = ExecutionContext(app_context=None)

        # Should not raise any exception
        with ctx.enter():
            pass

    def test_context_manager_protocol(self):
        """Test ExecutionContext supports context manager protocol."""
        ctx = ExecutionContext()

        with ctx:
            # Should not raise any exception
            pass

    def test_user_property(self):
        """Test user property returns set user."""
        user = MagicMock()
        ctx = ExecutionContext(user=user)

        assert ctx.user == user

    def test_thread_safe_context_manager(self):
        """Test shared ExecutionContext works across threads without token mismatch."""
        test_var = contextvars.ContextVar("thread_safe_test_var")

        class TrackingAppContext(AppContext):
            def get_config(self, key: str, default: Any = None) -> Any:
                return default

            def get_extension(self, name: str) -> Any:
                return None

            @contextmanager
            def enter(self):
                token = test_var.set(threading.get_ident())
                try:
                    yield
                finally:
                    test_var.reset(token)

        ctx = ExecutionContext(app_context=TrackingAppContext())
        errors: list[Exception] = []
        barrier = threading.Barrier(2)

        def worker():
            try:
                for _ in range(20):
                    with ctx:
                        try:
                            barrier.wait()
                            barrier.wait()
                        except threading.BrokenBarrierError:
                            return
            except Exception as exc:
                errors.append(exc)
                try:
                    barrier.abort()
                except Exception:
                    pass

        t1 = threading.Thread(target=worker)
        t2 = threading.Thread(target=worker)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        assert not errors


class TestIExecutionContextProtocol:
    """Test IExecutionContext protocol."""

    def test_execution_context_implements_protocol(self):
        """Test that ExecutionContext implements IExecutionContext protocol."""
        ctx = ExecutionContext()

        # Should have __enter__ and __exit__ methods
        assert hasattr(ctx, "__enter__")
        assert hasattr(ctx, "__exit__")
        assert hasattr(ctx, "user")

    def test_protocol_compatibility(self):
        """Test that ExecutionContext can be used where IExecutionContext is expected."""

        def accept_context(context: IExecutionContext) -> Any:
            """Function that accepts IExecutionContext protocol."""
            # Just verify it has the required protocol attributes
            assert hasattr(context, "__enter__")
            assert hasattr(context, "__exit__")
            assert hasattr(context, "user")
            return context.user

        ctx = ExecutionContext(user="test_user")
        result = accept_context(ctx)

        assert result == "test_user"

    def test_protocol_with_flask_execution_context(self):
        """Test that IExecutionContext protocol is compatible with different implementations."""
        # Verify the protocol works with ExecutionContext
        ctx = ExecutionContext(user="test_user")

        # Should have the required protocol attributes
        assert hasattr(ctx, "__enter__")
        assert hasattr(ctx, "__exit__")
        assert hasattr(ctx, "user")
        assert ctx.user == "test_user"

        # Should work as context manager
        with ctx:
            assert ctx.user == "test_user"


class TestExecutionContextBuilder:
    """Test ExecutionContextBuilder class."""

    def test_builder_with_all_params(self):
        """Test builder with all parameters set."""
        app_ctx = NullAppContext()
        context_vars = contextvars.copy_context()
        user = MagicMock()

        ctx = (
            ExecutionContextBuilder().with_app_context(app_ctx).with_context_vars(context_vars).with_user(user).build()
        )

        assert ctx.app_context == app_ctx
        assert ctx.context_vars == context_vars
        assert ctx.user == user

    def test_builder_with_partial_params(self):
        """Test builder with only some parameters set."""
        app_ctx = NullAppContext()

        ctx = ExecutionContextBuilder().with_app_context(app_ctx).build()

        assert ctx.app_context == app_ctx
        assert ctx.context_vars is None
        assert ctx.user is None

    def test_builder_fluent_interface(self):
        """Test builder provides fluent interface."""
        builder = ExecutionContextBuilder()

        # Each method should return the builder
        assert isinstance(builder.with_app_context(NullAppContext()), ExecutionContextBuilder)
        assert isinstance(builder.with_context_vars(contextvars.copy_context()), ExecutionContextBuilder)
        assert isinstance(builder.with_user(None), ExecutionContextBuilder)


class TestCaptureCurrentContext:
    """Test capture_current_context function."""

    def test_capture_current_context_returns_context(self):
        """Test that capture_current_context returns a valid context."""
        from core.workflow.context.execution_context import capture_current_context

        result = capture_current_context()

        # Should return an object that implements IExecutionContext
        assert hasattr(result, "__enter__")
        assert hasattr(result, "__exit__")
        assert hasattr(result, "user")

    def test_capture_current_context_captures_contextvars(self):
        """Test that capture_current_context captures context variables."""
        # Set a context variable before capturing
        import contextvars

        test_var = contextvars.ContextVar("capture_test_var")
        test_var.set("test_value_123")

        from core.workflow.context.execution_context import capture_current_context

        result = capture_current_context()

        # Context variables should be captured
        assert result.context_vars is not None


class TestTenantScopedContextRegistry:
    def setup_method(self):
        from core.workflow.context import reset_context_provider

        reset_context_provider()

    def teardown_method(self):
        from core.workflow.context import reset_context_provider

        reset_context_provider()

    def test_tenant_provider_read_ok(self):
        class SandboxContext(BaseModel):
            base_url: str | None = None

        register_context("workflow.sandbox", "t1", lambda: SandboxContext(base_url="http://t1"))
        register_context("workflow.sandbox", "t2", lambda: SandboxContext(base_url="http://t2"))

        assert read_context("workflow.sandbox", tenant_id="t1").base_url == "http://t1"
        assert read_context("workflow.sandbox", tenant_id="t2").base_url == "http://t2"

    def test_missing_provider_raises_keyerror(self):
        from core.workflow.context import ContextProviderNotFoundError

        with pytest.raises(ContextProviderNotFoundError):
            read_context("missing", tenant_id="unknown")
