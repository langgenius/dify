"""Business failures of workflow comment threads; the application service translates them into the slice's errors."""


class WorkflowCommentRuleError(Exception):
    """A thread rule refused a change; the message states the rule."""


class NotCreatorError(WorkflowCommentRuleError):
    """The actor did not create the comment or reply it tries to change."""


class InvalidContentError(WorkflowCommentRuleError):
    """Comment or reply text is blank or too long."""


class InvalidMentionError(WorkflowCommentRuleError):
    def __init__(self, user_id: str) -> None:
        self.user_id = user_id
        super().__init__(f"{user_id} is not a valid uuid.")


class UnknownReplyError(WorkflowCommentRuleError):
    def __init__(self, reply_id: str) -> None:
        self.reply_id = reply_id
        super().__init__(f"The thread has no reply {reply_id}")
