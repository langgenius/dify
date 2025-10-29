from typing import TYPE_CHECKING, Any, Optional

from pydantic import BaseModel, Field

# Import InvokeFrom locally to avoid circular import
from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.entities.datasource_entities import DatasourceInvokeFrom

if TYPE_CHECKING:
    from core.app.entities.app_invoke_entities import InvokeFrom


class DatasourceRuntime(BaseModel):
    """
    Meta data of a datasource call processing
    """

    tenant_id: str
    datasource_id: str | None = None
    invoke_from: Optional["InvokeFrom"] = None
    datasource_invoke_from: DatasourceInvokeFrom | None = None
    credentials: dict[str, Any] = Field(default_factory=dict)
    runtime_parameters: dict[str, Any] = Field(default_factory=dict)


class FakeDatasourceRuntime(DatasourceRuntime):
    """
    Fake datasource runtime for testing
    """

    def __init__(self):
        super().__init__(
            tenant_id="fake_tenant_id",
            datasource_id="fake_datasource_id",
            invoke_from=InvokeFrom.DEBUGGER,
            datasource_invoke_from=DatasourceInvokeFrom.RAG_PIPELINE,
            credentials={},
            runtime_parameters={},
        )
