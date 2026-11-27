from services.errors.base import BaseServiceError


class EvaluationDisabledError(Exception):
    """The deployment has turned off Evaluation."""


class EvaluationPlanRequiredError(Exception):
    """A Cloud workspace cannot use Evaluation without a paid subscription."""


class EvaluationEntitlementUnavailableError(Exception):
    """Evaluation billing could not be checked, so the operation must not proceed."""


class EvaluationFrameworkNotConfiguredError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Selected evaluation framework is unavailable.")


class EvaluationNotFoundError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Evaluation not found.")


class EvaluationDatasetInvalidError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Evaluation dataset is invalid.")


class EvaluationMaxConcurrentRunsError(BaseServiceError):
    def __init__(self, description: str | None = None, *, limit: int | None = None):
        super().__init__(description or "Maximum number of concurrent evaluation runs reached.")
        self.limit = limit


class EvaluationRunControlError(Exception):
    """Base class for control signals that must stop row-level error handling."""


class EvaluationRunCancelledError(EvaluationRunControlError):
    """Raised when cooperative cancellation stops an evaluation task."""


class EvaluationRunOwnershipLostError(EvaluationRunControlError):
    """Raised when a task invocation no longer owns the evaluation run lease."""
