from collections.abc import Mapping
from typing import Any, Literal, Union

from pydantic import BaseModel, Field, ValidationInfo, field_validator

from core.trigger.entities.entities import EventParameter
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.trigger_plugin.exc import TriggerEventParameterError


class TriggerEventNodeData(BaseNodeData):
    """Plugin trigger node data"""

    class TriggerEventInput(BaseModel):
        value: Union[Any, list[str]]
        type: Literal["mixed", "variable", "constant"]

        @field_validator("type", mode="before")
        @classmethod
        def check_type(cls, value, validation_info: ValidationInfo):
            type = value
            value = validation_info.data.get("value")

            if value is None:
                return type

            if type == "mixed" and not isinstance(value, str):
                raise ValueError("value must be a string")

            if type == "variable":
                if not isinstance(value, list):
                    raise ValueError("value must be a list")
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError("value must be a list of strings")

            if type == "constant" and not isinstance(value, str | int | float | bool | dict | list):
                raise ValueError("value must be a string, int, float, bool or dict")
            return type

    title: str
    desc: str | None = None
    plugin_id: str = Field(..., description="Plugin ID")
    provider_id: str = Field(..., description="Provider ID")
    event_name: str = Field(..., description="Event name")
    subscription_id: str = Field(..., description="Subscription ID")
    plugin_unique_identifier: str = Field(..., description="Plugin unique identifier")
    event_parameters: Mapping[str, TriggerEventInput] = Field(default_factory=dict, description="Trigger parameters")

    def resolve_parameters(
        self,
        *,
        parameter_schemas: Mapping[str, EventParameter],
    ) -> Mapping[str, Any]:
        """
        Generate parameters based on the given plugin trigger parameters.

        Args:
            parameter_schemas (Mapping[str, EventParameter]): The mapping of parameter schemas.

        Returns:
            Mapping[str, Any]: A dictionary containing the generated parameters.

        """
        result: dict[str, Any] = {}
        for parameter_name in self.event_parameters:
            parameter: EventParameter | None = parameter_schemas.get(parameter_name)
            if not parameter:
                result[parameter_name] = None
                continue
            event_input = self.event_parameters[parameter_name]

            # trigger node only supports constant input
            if event_input.type != "constant":
                raise TriggerEventParameterError(f"Unknown plugin trigger input type '{event_input.type}'")
            result[parameter_name] = event_input.value
        return result
