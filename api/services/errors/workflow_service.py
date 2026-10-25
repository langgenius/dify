class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass


class EmptyWorkflowConfirmationRequiredError(ValueError):
    """Raised when an unconfirmed empty save would initialize or clear a draft."""


class DuplicateDraftWorkflowError(ValueError):
    """Historical duplicate drafts require explicit repair before any draft write."""

    def __init__(self) -> None:
        super().__init__(
            "Multiple draft workflows exist for this app. Resolve the duplicate drafts before saving or restoring."
        )
