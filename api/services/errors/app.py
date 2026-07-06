class MoreLikeThisDisabledError(Exception):
    pass


class WorkflowHashNotEqualError(Exception):
    pass


class IsDraftWorkflowError(Exception):
    pass


class WorkflowNotFoundError(Exception):
    pass


class WorkflowAgentNodeDslExportUnsupportedError(ValueError):
    """Raised when a workflow DSL export contains Agent v2 nodes.

    Agent v2 node configuration is not fully portable until Agent DSL
    export/import is supported, because its runtime config lives outside the
    workflow graph in agent bindings and config snapshots.
    """


class WorkflowIdFormatError(Exception):
    pass


class WorkflowQuotaLimitError(Exception):
    """Raised when workflow execution quota is exceeded (for async/background workflows)."""

    pass


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
