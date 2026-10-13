class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass


class EmptyWorkflowConfirmationRequiredError(ValueError):
    """Raised when an unconfirmed empty save would initialize or clear a draft."""
