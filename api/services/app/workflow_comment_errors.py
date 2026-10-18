"""Framework-neutral failures of Console workflow comments, shared by the aggregate, the service, and adapters."""


class WorkflowCommentError(Exception):
    """Base class for framework-neutral workflow comment failures."""


class WorkflowCommentAppNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("App not found")


class WorkflowCommentNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("Comment not found")


class WorkflowCommentReplyNotFoundError(WorkflowCommentError):
    def __init__(self) -> None:
        super().__init__("Reply not found")


class WorkflowCommentPermissionError(WorkflowCommentError):
    """Raised when an account edits or deletes a comment or reply it did not create."""


class InvalidWorkflowCommentContentError(WorkflowCommentError):
    pass


class InvalidMentionedUserIdError(WorkflowCommentError):
    def __init__(self, user_id: str) -> None:
        super().__init__(f"{user_id} is not a valid uuid.")
