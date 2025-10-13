from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class DatasourceStreamEvent(StrEnum):
    """
    Datasource Stream event
    """

    PROCESSING = "datasource_processing"
    COMPLETED = "datasource_completed"
    ERROR = "datasource_error"


class BaseDatasourceEvent(BaseModel):
    pass


class DatasourceErrorEvent(BaseDatasourceEvent):
    event: DatasourceStreamEvent = DatasourceStreamEvent.ERROR
    error: str = Field(..., description="error message")


class DatasourceCompletedEvent(BaseDatasourceEvent):
    event: DatasourceStreamEvent = DatasourceStreamEvent.COMPLETED
    data: Mapping[str, Any] | list = Field(..., description="result")
    total: int | None = Field(default=0, description="total")
    completed: int | None = Field(default=0, description="completed")
    time_consuming: float | None = Field(default=0.0, description="time consuming")


class DatasourceProcessingEvent(BaseDatasourceEvent):
    event: DatasourceStreamEvent = DatasourceStreamEvent.PROCESSING
    total: int | None = Field(..., description="total")
    completed: int | None = Field(..., description="completed")
