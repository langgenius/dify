from pydantic import Field

from core.workflow.events.base import BaseParallelBranchEvent


class ParallelBranchRunStartedEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunSucceededEvent(BaseParallelBranchEvent):
    pass


class ParallelBranchRunFailedEvent(BaseParallelBranchEvent):
    error: str = Field(..., description="failed reason")
