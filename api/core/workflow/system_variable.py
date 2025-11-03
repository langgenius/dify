from collections.abc import Mapping, Sequence
from types import MappingProxyType
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
    document_id: str | None = None
    original_document_id: str | None = None
    dataset_id: str | None = None
    batch: str | None = None
    datasource_type: str | None = None
    datasource_info: Mapping[str, Any] | None = None
    invoke_from: str | None = None

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
        if self.document_id is not None:
            d[SystemVariableKey.DOCUMENT_ID] = self.document_id
        if self.original_document_id is not None:
            d[SystemVariableKey.ORIGINAL_DOCUMENT_ID] = self.original_document_id
        if self.dataset_id is not None:
            d[SystemVariableKey.DATASET_ID] = self.dataset_id
        if self.batch is not None:
            d[SystemVariableKey.BATCH] = self.batch
        if self.datasource_type is not None:
            d[SystemVariableKey.DATASOURCE_TYPE] = self.datasource_type
        if self.datasource_info is not None:
            d[SystemVariableKey.DATASOURCE_INFO] = self.datasource_info
        if self.invoke_from is not None:
            d[SystemVariableKey.INVOKE_FROM] = self.invoke_from
        return d

    def as_view(self) -> "SystemVariableReadOnlyView":
        return SystemVariableReadOnlyView(self)


class SystemVariableReadOnlyView:
    """
    A read-only view of a SystemVariable that implements the ReadOnlySystemVariable protocol.

    This class wraps a SystemVariable instance and provides read-only access to all its fields.
    It always reads the latest data from the wrapped instance and prevents any write operations.
    """

    def __init__(self, system_variable: SystemVariable) -> None:
        """
        Initialize the read-only view with a SystemVariable instance.

        Args:
            system_variable: The SystemVariable instance to wrap
        """
        self._system_variable = system_variable

    @property
    def user_id(self) -> str | None:
        return self._system_variable.user_id

    @property
    def app_id(self) -> str | None:
        return self._system_variable.app_id

    @property
    def workflow_id(self) -> str | None:
        return self._system_variable.workflow_id

    @property
    def workflow_execution_id(self) -> str | None:
        return self._system_variable.workflow_execution_id

    @property
    def query(self) -> str | None:
        return self._system_variable.query

    @property
    def conversation_id(self) -> str | None:
        return self._system_variable.conversation_id

    @property
    def dialogue_count(self) -> int | None:
        return self._system_variable.dialogue_count

    @property
    def document_id(self) -> str | None:
        return self._system_variable.document_id

    @property
    def original_document_id(self) -> str | None:
        return self._system_variable.original_document_id

    @property
    def dataset_id(self) -> str | None:
        return self._system_variable.dataset_id

    @property
    def batch(self) -> str | None:
        return self._system_variable.batch

    @property
    def datasource_type(self) -> str | None:
        return self._system_variable.datasource_type

    @property
    def invoke_from(self) -> str | None:
        return self._system_variable.invoke_from

    @property
    def files(self) -> Sequence[File]:
        """
        Get a copy of the files from the wrapped SystemVariable.

        Returns:
            A defensive copy of the files sequence to prevent modification
        """
        return tuple(self._system_variable.files)  # Convert to immutable tuple

    @property
    def datasource_info(self) -> Mapping[str, Any] | None:
        """
        Get a copy of the datasource info from the wrapped SystemVariable.

        Returns:
            A view of the datasource info mapping to prevent modification
        """
        if self._system_variable.datasource_info is None:
            return None
        return MappingProxyType(self._system_variable.datasource_info)

    def __repr__(self) -> str:
        """Return a string representation of the read-only view."""
        return f"SystemVariableReadOnlyView(system_variable={self._system_variable!r})"
