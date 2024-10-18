from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.workflow.entities.variable_pool import VariablePool

tenant_id: ContextVar[str] = ContextVar("tenant_id")

workflow_variable_pool: ContextVar["VariablePool"] = ContextVar("workflow_variable_pool")
