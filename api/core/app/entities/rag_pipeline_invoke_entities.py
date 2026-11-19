from typing import Any

from pydantic import BaseModel, field_validator

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom


class RagPipelineInvokeEntity(BaseModel):
    pipeline_id: str
    application_generate_entity: dict[str, Any]
    user_id: str
    tenant_id: str
    workflow_id: str
    streaming: bool
    workflow_execution_id: str | None = None
    workflow_thread_pool_id: str | None = None

    @field_validator("application_generate_entity")
    @classmethod
    def normalize_legacy_execution_identity(cls, value: dict[str, Any]) -> dict[str, Any]:
        """Load queued payloads written before user_from became required.

        Keep this compatibility at the serialized queue boundary, rather than
        weakening validation of new execution entities or changing runner policy.
        """
        if "user_from" in value or "invoke_from" not in value:
            return value
        invoke_from = InvokeFrom(value["invoke_from"])
        if value.get("single_iteration_run") or value.get("single_loop_run"):
            invoke_from = InvokeFrom.DEBUGGER
        user_from = UserFrom.ACCOUNT if invoke_from.runs_as_account() else UserFrom.END_USER
        return {**value, "user_from": user_from.value}
