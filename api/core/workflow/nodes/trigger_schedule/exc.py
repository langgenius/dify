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
