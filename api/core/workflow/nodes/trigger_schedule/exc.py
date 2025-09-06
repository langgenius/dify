from core.workflow.nodes.base.exc import BaseNodeError


class ScheduleNodeError(BaseNodeError):
    """Base schedule node error."""

    pass


class ScheduleNotFoundError(ScheduleNodeError):
    """Schedule not found error."""

    pass


class ScheduleConfigError(ScheduleNodeError):
    """Schedule configuration error."""

    pass


class ScheduleExecutionError(ScheduleNodeError):
    """Schedule execution error."""

    pass


class TenantOwnerNotFoundError(ScheduleExecutionError):
    """Tenant owner not found error for schedule execution."""

    pass
