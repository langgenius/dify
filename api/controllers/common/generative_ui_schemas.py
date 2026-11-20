"""Independent OpenUI draft request and response contracts."""

from pydantic import BaseModel, ConfigDict, JsonValue

from fields.base import ResponseModel
from libs.generative_ui import OpenUIContentBlock


class OpenUIStatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    form_state: dict[str, JsonValue]


class OpenUIStateResponse(ResponseModel):
    block: OpenUIContentBlock
