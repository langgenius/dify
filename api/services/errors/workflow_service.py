from libs.exception import BaseHTTPException


class WorkflowInUseError(ValueError):
    """Raised when attempting to delete a workflow that's in use by an app"""

    pass


class DraftWorkflowDeletionError(ValueError):
    """Raised when attempting to delete a draft workflow"""

    pass


class ConversationVariableDescriptionTooLongError(BaseHTTPException):
    """Raised when conversation variable description exceeds maximum length"""

    error_code = "conversation_variable_description_too_long"
    code = 400

    def __init__(self, current_length: int, max_length: int):
        description = (
            f"Conversation variable description exceeds maximum length of "
            f"{max_length} characters. Current length: {current_length} characters."
        )
        super().__init__(description)
