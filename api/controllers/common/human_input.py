from pydantic import BaseModel, JsonValue


class HumanInputFormSubmitPayload(BaseModel):
    inputs: dict[str, JsonValue]
    action: str
