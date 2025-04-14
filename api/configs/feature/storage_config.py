from pydantic import Field
from pydantic_settings import BaseSettings


class WorkflowNodeExecutionStorageConfig(BaseSettings):
    """
    Configuration settings for WorkflowNodeExecution storage.
    """

    WORKFLOW_NODE_EXECUTION_STORAGE: str = Field(
        default="rdbms",
        description="Storage backend for WorkflowNodeExecution. Options: 'rdbms', 'hybrid'",
    )
