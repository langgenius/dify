from typing import Any, Literal, Union

from pydantic import BaseModel, field_validator
from pydantic_core.core_schema import ValidationInfo

from core.workflow.nodes.base.entities import BaseNodeData


class DatasourceEntity(BaseModel):
    plugin_id: str
    provider_name: str  # redundancy
    provider_type: str
    datasource_name: str | None = "local_file"
    datasource_configurations: dict[str, Any] | None = None
    plugin_unique_identifier: str | None = None  # redundancy


class DatasourceNodeData(BaseNodeData, DatasourceEntity):
    class DatasourceInput(BaseModel):
        # TODO: check this type
        value: Union[Any, list[str]]
        type: Literal["mixed", "variable", "constant"] | None = None

        @field_validator("type", mode="before")
        @classmethod
        def check_type(cls, value, validation_info: ValidationInfo):
            typ = value
            value = validation_info.data.get("value")
            if typ == "mixed" and not isinstance(value, str):
                raise ValueError("value must be a string")
            elif typ == "variable":
                if not isinstance(value, list):
                    raise ValueError("value must be a list")
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError("value must be a list of strings")
            elif typ == "constant" and not isinstance(value, str | int | float | bool):
                raise ValueError("value must be a string, int, float, or bool")
            return typ

    datasource_parameters: dict[str, DatasourceInput] | None = None
