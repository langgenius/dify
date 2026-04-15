from services.errors.base import BaseServiceError


class EvaluationFrameworkNotConfiguredError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Evaluation framework is not configured. Set EVALUATION_FRAMEWORK env var.")


class EvaluationNotFoundError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Evaluation not found.")


class EvaluationDatasetInvalidError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Evaluation dataset is invalid.")


class EvaluationMaxConcurrentRunsError(BaseServiceError):
    def __init__(self, description: str | None = None):
        super().__init__(description or "Maximum number of concurrent evaluation runs reached.")
