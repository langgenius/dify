from collections.abc import Mapping
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class DatasourceStreamEvent(Enum):
    """
    Datasource Stream event
    """

    PROCESSING = "datasource_processing"
    COMPLETED = "datasource_completed"
    ERROR = "datasource_error"


class BaseDatasourceEvent(BaseModel):
    pass


class DatasourceErrorEvent(BaseDatasourceEvent):
    event: str = DatasourceStreamEvent.ERROR.value
    error: str = Field(..., description="error message")


class DatasourceCompletedEvent(BaseDatasourceEvent):
    event: str = DatasourceStreamEvent.COMPLETED.value
    data: Mapping[str, Any] | list = Field(..., description="result")
    total: Optional[int] = Field(default=0, description="total")
    completed: Optional[int] = Field(default=0, description="completed")
    time_consuming: Optional[float] = Field(default=0.0, description="time consuming")


class DatasourceProcessingEvent(BaseDatasourceEvent):
    event: str = DatasourceStreamEvent.PROCESSING.value
    total: Optional[int] = Field(..., description="total")
    completed: Optional[int] = Field(..., description="completed")
