"""Tests for ExecutionContext.refresh_context_vars."""

import contextvars

from context.execution_context import ExecutionContext


class TestRefreshContextVars:
    """Tests for ExecutionContext.refresh_context_vars."""

    def test_refresh_captures_current_contextvars(self):
        """refresh_context_vars should re-capture the current ContextVar state."""
        test_var: contextvars.ContextVar[str] = contextvars.ContextVar("test_refresh_var", default="initial")

        # Set a value so it appears in the copy_context snapshot
        token1 = test_var.set("initial")
        try:
            ctx = ExecutionContext(context_vars=contextvars.copy_context())
            assert ctx.context_vars is not None

            # Change the ContextVar in the current thread
            token2 = test_var.set("updated")
            try:
                # Before refresh, the snapshot still has "initial"
                old_val = ctx.context_vars.get(test_var)
                assert old_val == "initial"

                # After refresh, the snapshot should have "updated"
                ctx.refresh_context_vars()
                new_val = ctx.context_vars.get(test_var)
                assert new_val == "updated"
            finally:
                test_var.reset(token2)
        finally:
            test_var.reset(token1)

    def test_refresh_replaces_context_vars(self):
        """refresh_context_vars should replace the _context_vars attribute."""
        ctx = ExecutionContext(context_vars=contextvars.copy_context())
        original = ctx.context_vars
        assert original is not None

        ctx.refresh_context_vars()
        assert ctx.context_vars is not None
        # Should be a new Context object (not the same reference)
        assert ctx.context_vars is not original
