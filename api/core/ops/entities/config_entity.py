from enum import StrEnum

from pydantic import BaseModel

from core.ops.utils import validate_project_name, validate_url


class TracingProviderEnum(StrEnum):
    ARIZE = "arize"
    PHOENIX = "phoenix"
    LANGFUSE = "langfuse"
    LANGSMITH = "langsmith"
    OPIK = "opik"
    WEAVE = "weave"
    ALIYUN = "aliyun"
    MLFLOW = "mlflow"
    DATABRICKS = "databricks"
    TENCENT = "tencent"


class BaseTracingConfig(BaseModel):
    """
    Base model class for tracing configurations
    """

    @classmethod
    def validate_endpoint_url(cls, v: str, default_url: str) -> str:
        """
        Common endpoint URL validation logic

        Args:
            v: URL value to validate
            default_url: Default URL to use if input is None or empty

        Returns:
            Validated and normalized URL
        """
        return validate_url(v, default_url)

    @classmethod
    def validate_project_field(cls, v: str, default_name: str) -> str:
        """
        Common project name validation logic

        Args:
            v: Project name to validate
            default_name: Default name to use if input is None or empty

        Returns:
            Validated project name
        """
        return validate_project_name(v, default_name)


OPS_FILE_PATH = "ops_trace/"
OPS_TRACE_FAILED_KEY = "FAILED_OPS_TRACE"


def ops_trace_payload_path(app_id: str, file_id: str) -> str:
    return f"{OPS_FILE_PATH}{app_id}/{file_id}.json"


def workflow_final_trace_file_id(workflow_run_id: str) -> str:
    return f"workflow-final-{workflow_run_id}"
