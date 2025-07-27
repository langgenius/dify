from collections.abc import Sequence
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from core.file.models import File
from core.workflow.enums import SystemVariableKey


class SystemVariable(BaseModel):
    """A model for managing system variables.

    Fields with a value of `None` are treated as absent and will not be included
    in the variable pool.
    """

    model_config = ConfigDict(
        extra="forbid",
        serialize_by_alias=True,
        validate_by_alias=True,
    )

    user_id: str | None = None

    # Ideally, `app_id` and `workflow_id` should be required and not `None`.
    # However, there are scenarios in the codebase where these fields are not set.
    # To maintain compatibility, they are marked as optional here.
    app_id: str | None = None
    workflow_id: str | None = None

    files: Sequence[File] = Field(default_factory=list)

    # NOTE: The `workflow_execution_id` field was previously named `workflow_run_id`.
    # To maintain compatibility with existing workflows, it must be serialized
    # as `workflow_run_id` in dictionaries or JSON objects, and also referenced
    # as `workflow_run_id` in the variable pool.
    workflow_execution_id: str | None = Field(
        validation_alias=AliasChoices("workflow_execution_id", "workflow_run_id"),
        serialization_alias="workflow_run_id",
        default=None,
    )
    # Chatflow related fields.
    query: str | None = None
    conversation_id: str | None = None
    dialogue_count: int | None = None

    @model_validator(mode="before")
    @classmethod
    def validate_json_fields(cls, data):
        if isinstance(data, dict):
            # For JSON validation, only allow workflow_run_id
            if "workflow_execution_id" in data and "workflow_run_id" not in data:
                # This is likely from direct instantiation, allow it
                return data
            elif "workflow_execution_id" in data and "workflow_run_id" in data:
                # Both present, remove workflow_execution_id
                data = data.copy()
                data.pop("workflow_execution_id")
                return data
        return data

    @classmethod
    def empty(cls) -> "SystemVariable":
        return cls()

    def to_dict(self) -> dict[SystemVariableKey, Any]:
        # NOTE: This method is provided for compatibility with legacy code.
        # New code should use the `SystemVariable` object directly instead of converting
        # it to a dictionary, as this conversion results in the loss of type information
        # for each key, making static analysis more difficult.

        d: dict[SystemVariableKey, Any] = {
            SystemVariableKey.FILES: self.files,
        }
        if self.user_id is not None:
            d[SystemVariableKey.USER_ID] = self.user_id
        if self.app_id is not None:
            d[SystemVariableKey.APP_ID] = self.app_id
        if self.workflow_id is not None:
            d[SystemVariableKey.WORKFLOW_ID] = self.workflow_id
        if self.workflow_execution_id is not None:
            d[SystemVariableKey.WORKFLOW_EXECUTION_ID] = self.workflow_execution_id
        if self.query is not None:
            d[SystemVariableKey.QUERY] = self.query
        if self.conversation_id is not None:
            d[SystemVariableKey.CONVERSATION_ID] = self.conversation_id
        if self.dialogue_count is not None:
            d[SystemVariableKey.DIALOGUE_COUNT] = self.dialogue_count
        return d
