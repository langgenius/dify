from pydantic import Field
from pydantic_settings import BaseSettings


class APOConfig(BaseSettings):
    """
    Configuration settings for apo
    """

    APO_BACKEND_URL: str = Field(
        description="apo backend url",
        default="http://localhost:8080",
    )
    APO_VM_URL: str = Field(
        description="apo vm url",
        default="http://localhost:8080",
    )
    INITIAL_LANGUAGE: str = Field(
        description="Initial workflows' language",
        default="en-US"
    )
    WORKFLOW_DIR: str = Field(
        description="Directory of workflows yaml file.",
        default="./workflows"
    )