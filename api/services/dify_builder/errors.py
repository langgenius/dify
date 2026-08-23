"""Domain errors raised by the Dify Builder's Dify-service adapter.

These sit alongside (not instead of) ``core.dify_builder.errors`` --
they're specific to the OSS ``WorkflowService`` surface the adapter wraps,
so they live in this package rather than the I/O-free ``core`` layer.
"""


class WorkflowNotInitializedError(Exception):
    """Raised when an app has no draft workflow yet (``get_draft_workflow`` returns ``None``)."""


class HashMismatchError(Exception):
    """Domain re-map of ``services.errors.app.WorkflowHashNotEqualError``.

    Raised when ``sync_draft_workflow``'s optimistic-concurrency check finds
    the draft graph changed since it was last read. The adapter (Task 4)
    catches the OSS error and re-raises this instead, so callers only need
    to know about ``core``/``services.dify_builder`` error types.
    """
