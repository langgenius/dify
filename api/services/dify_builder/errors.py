"""Domain errors raised by the Dify Builder's Dify-service adapter.

These sit alongside (not instead of) ``core.dify_builder.errors`` --
they're specific to the OSS ``WorkflowService`` surface the adapter wraps,
so they live in this package rather than the I/O-free ``core`` layer.
"""

from core.dify_builder.errors import DraftWouldNotStartError, HashMismatchError

__all__ = ["HashMismatchError", "PreflightError", "WorkflowNotInitializedError"]


class WorkflowNotInitializedError(Exception):
    """Raised when an app has no draft workflow yet (``get_draft_workflow`` returns ``None``)."""


class PreflightError(DraftWouldNotStartError):
    """Raised by ``apply_repair`` when the graph it was about to write would
    not start: ``services.dify_builder.preflight.preflight_errors`` found a
    node ``Graph.init`` would reject. Subclasses the core
    ``DraftWouldNotStartError`` so the handlers (which cannot import
    ``services``) can tell it apart from a stale intent; still a
    ``ValueError`` underneath.
    """
