from typing import Any

from pydantic import BaseModel


class RagPipelineInvokeEntity(BaseModel):
    pipeline_id: str
    application_generate_entity: dict[str, Any]
    user_id: str
    tenant_id: str
    workflow_id: str
    streaming: bool
    workflow_execution_id: str | None = None
    workflow_thread_pool_id: str | None = None
    # Stored inside the uploaded batch instead of the Celery task signature so
    # new producers remain compatible with old workers during a rolling update.
    tenant_isolated: bool | None = None
