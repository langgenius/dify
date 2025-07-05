from enum import Enum


class WorkflowExecRepoMode(str, Enum):
    """
    Enum for NodeExecution repository storage mode.
    """

    SQL = "sql"
    MEMORY = "memory"
