class QuestionClassifierNodeError(ValueError):
    """Base class for QuestionClassifierNode errors."""


class InvalidModelTypeError(QuestionClassifierNodeError):
    """Raised when the model is not a Large Language Model."""
