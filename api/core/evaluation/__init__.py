"""Shared credit attribution for Evaluation's built-in scoring models."""

from core.credit_usage import CreditUsageCreatedBy, normalize_credit_usage_app_type
from core.model_context import get_credit_usage_metadata


def get_evaluation_credit_usage_metadata() -> dict[str, object]:
    """Attribute built-in scoring to Evaluation and the scoped target app type, if known."""
    request_metadata = get_credit_usage_metadata() or {}
    return {
        "app_type": normalize_credit_usage_app_type(request_metadata.get("app_type")),
        "created_by": CreditUsageCreatedBy.EVALUATION,
    }
