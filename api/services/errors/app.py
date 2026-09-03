class MoreLikeThisDisabledError(Exception):
    pass


class WorkflowHashNotEqualError(Exception):
    pass


class IsDraftWorkflowError(Exception):
    pass


class WorkflowNotFoundError(Exception):
    pass


class WorkflowIdFormatError(Exception):
    pass


TRIGGER_WORKFLOW_SERVICE_MODE_UNAVAILABLE_CODE = "trigger_workflow_service_mode_unavailable"
TRIGGER_WORKFLOW_SERVICE_MODE_UNAVAILABLE_MESSAGE = (
    "This workflow uses a trigger entry and cannot be invoked through Web App, Service API, OpenAPI, or MCP."
)


class TriggerWorkflowServiceModeUnavailableError(Exception):
    """Raised when a trigger-entry Workflow is invoked through a manual service surface."""

    error_code = TRIGGER_WORKFLOW_SERVICE_MODE_UNAVAILABLE_CODE

    def __init__(self) -> None:
        super().__init__(TRIGGER_WORKFLOW_SERVICE_MODE_UNAVAILABLE_MESSAGE)


class QuotaExceededError(ValueError):
    """Raised when billing quota is exceeded for a feature."""

    def __init__(self, feature: str, tenant_id: str, required: int):
        self.feature = feature
        self.tenant_id = tenant_id
        self.required = required
        super().__init__(f"Quota exceeded for feature '{feature}' (tenant: {tenant_id}). Required: {required}")


class TriggerNodeLimitExceededError(ValueError):
    """Raised when trigger node count exceeds the plan limit."""

    def __init__(self, count: int, limit: int):
        self.count = count
        self.limit = limit
        super().__init__(
            f"Trigger node count ({count}) exceeds the limit ({limit}) for your subscription plan. "
            f"Please upgrade your plan or reduce the number of trigger nodes."
        )
