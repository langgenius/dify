"""Dify-owned Human Input entities.

Graphon v0.6.0 keeps only the minimal HITL callback contract. Dify owns the
workflow-facing form schema, validation rules, and compatibility payload shapes
that used to live in graphon.
"""

import abc
import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, Self, assert_never

from pydantic import BaseModel, Field, NonNegativeInt, field_validator, model_validator

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.file.enums import FileTransferMethod, FileType
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.segments import Segment

from . import _exc as exc
from .enums import ButtonStyle, FormInputType, TimeoutUnit, ValueSourceType

_OUTPUT_VARIABLE_PATTERN = re.compile(
    r"\{\{#\$output\.(?P<field_name>[a-zA-Z_][a-zA-Z0-9_]{0,29})#\}\}",
)


class StringSource(BaseModel):
    """Default configuration for form inputs."""

    # NOTE: Ideally, a discriminated union would be used to model
    # FormInputDefault. However, the UI requires preserving the previous
    # value when switching between `VARIABLE` and `CONSTANT` types. This
    # necessitates retaining all fields, making a discriminated union unsuitable.

    # NOTE: This class is renamed from FormInputDefault.

    type: ValueSourceType

    # The selector of default variable, used when `type` is `VARIABLE`.
    selector: Sequence[str] = Field(default_factory=tuple)

    # Constant defaults are stored as strings because current form inputs are
    # text-based (`TEXT_INPUT` and `PARAGRAPH`).
    value: str = ""

    @model_validator(mode="after")
    def _validate_selector(self) -> Self:
        if self.type == ValueSourceType.CONSTANT:
            return self
        if len(self.selector) < SELECTORS_LENGTH:
            msg = (
                f"the length of selector should be at least {SELECTORS_LENGTH}, "
                f"selector={self.selector}"
            )
            raise ValueError(msg)
        return self


class StringListSource(BaseModel):
    type: ValueSourceType

    # The selector of default variable, used when `type` is `VARIABLE`.
    selector: Sequence[str] = Field(default_factory=tuple)

    # The value of the default, used when `type` is `CONSTANT`.
    value: list[str] = Field(default_factory=list)


class BaseInputConfig(BaseModel):
    """BaseInputConfig is the base class for all input field definitions.
    One input corresponds to one output variable during form submission.
    """

    output_variable_name: str

    @abc.abstractmethod
    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        """`extract_variable_selectors` extracts variable selectors
        used by this input field.
        """

    @abc.abstractmethod
    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        """`resolve_default_value` resolves the default value for form submission.

        If the form input does not specify a default value, or the default value does
        not depend on the runtime variable, this method should return `None`.
        """


class ParagraphInputConfig(BaseInputConfig):
    """Form input definition."""

    # NOTE: This class is renamed from FormInput.
    type: Literal[FormInputType.PARAGRAPH] = FormInputType.PARAGRAPH
    default: StringSource | None = None

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        default = self.default
        if default is None:
            return []
        if default.type == ValueSourceType.CONSTANT:
            return []
        return [default.selector]

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        default = self.default
        if default is None:
            return None

        if default.type == ValueSourceType.CONSTANT:
            return None

        return pool.get(default.selector)


class SelectInputConfig(BaseInputConfig):
    type: Literal[FormInputType.SELECT] = FormInputType.SELECT
    option_source: StringListSource

    def extract_variable_selectors(self) -> Sequence[Sequence[NodeType]]:
        if self.option_source.type == ValueSourceType.CONSTANT:
            return []
        return [self.option_source.selector]

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


_ALLOWED_TRANSFER_METHOD = frozenset([
    FileTransferMethod.LOCAL_FILE,
    FileTransferMethod.REMOTE_URL,
])


class _FileInputCommonConfig(BaseModel):
    allowed_file_types: Sequence[FileType] = Field(default_factory=list[FileType])
    allowed_file_extensions: Sequence[str] = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] = Field(
        default_factory=list[FileTransferMethod]
    )

    @field_validator("allowed_file_upload_methods", mode="after")
    @classmethod
    def _validate_upload_methods(
        cls, transfer_methods: Sequence[FileTransferMethod]
    ) -> Sequence[FileTransferMethod]:
        validated_values: list[FileTransferMethod] = []
        for value in transfer_methods:
            if value not in _ALLOWED_TRANSFER_METHOD:
                raise exc.InvalidTransferMethodError(value)
            validated_values.append(value)

        return validated_values

    @model_validator(mode="after")
    def _validate_extensions(self) -> Self:
        if FileType.CUSTOM not in self.allowed_file_types:
            return self
        if not self.allowed_file_extensions:
            raise exc.ExtensionsNotSetErrorValueError
        return self


class FileInputConfig(_FileInputCommonConfig, BaseInputConfig):
    type: Literal[FormInputType.FILE] = FormInputType.FILE

    def extract_variable_selectors(self) -> Sequence[Sequence[NodeType]]:
        return []

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


class FileListInputConfig(_FileInputCommonConfig, BaseInputConfig):
    type: Literal[FormInputType.FILE_LIST] = FormInputType.FILE_LIST
    number_limits: NonNegativeInt = 0

    def extract_variable_selectors(self) -> Sequence[Sequence[NodeType]]:
        return []

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


type FormInputConfig = Annotated[
    ParagraphInputConfig | SelectInputConfig | FileInputConfig | FileListInputConfig,
    Field(discriminator="type"),
]


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class UserActionConfig(BaseModel):
    """User action configuration."""

    # id is the identifier for this action.
    # It also serves as the identifiers of output handle.
    #
    # The id must be a valid identifier (satisfy the _IDENTIFIER_PATTERN above.)
    id: str = Field(max_length=20)
    title: str = Field(max_length=100)
    button_style: ButtonStyle = ButtonStyle.DEFAULT

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.match(value):
            msg = (
                f"'{value}' is not a valid identifier. It must start with "
                f"a letter or underscore, and contain only letters, "
                f"numbers, or underscores."
            )
            raise ValueError(msg)
        return value


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    type: NodeType = BuiltinNodeTypes.HUMAN_INPUT
    form_content: str = ""
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    timeout: int = 36
    timeout_unit: TimeoutUnit = TimeoutUnit.HOUR

    @field_validator("inputs")
    @classmethod
    def _validate_inputs(cls, inputs: list[FormInputConfig]) -> list[FormInputConfig]:
        seen_names: set[str] = set()
        for form_input in inputs:
            name = form_input.output_variable_name
            if name in seen_names:
                msg = f"duplicated output_variable_name '{name}' in inputs"
                raise ValueError(msg)
            seen_names.add(name)
        return inputs

    @field_validator("user_actions")
    @classmethod
    def _validate_user_actions(
        cls, user_actions: list[UserActionConfig]
    ) -> list[UserActionConfig]:
        seen_ids: set[str] = set()
        for action in user_actions:
            action_id = action.id
            if action_id in seen_ids:
                msg = f"duplicated user action id '{action_id}'"
                raise ValueError(msg)
            seen_ids.add(action_id)
        return user_actions

    def expiration_time(self, start_time: datetime) -> datetime:
        match self.timeout_unit:
            case TimeoutUnit.HOUR:
                return start_time + timedelta(hours=self.timeout)
            case TimeoutUnit.DAY:
                return start_time + timedelta(days=self.timeout)
            case _:
                assert_never(self.timeout_unit)

    def outputs_field_names(self) -> Sequence[str]:
        return [
            match.group("field_name")
            for match in _OUTPUT_VARIABLE_PATTERN.finditer(self.form_content)
        ]

    def extract_variable_selector_to_variable_mapping(
        self,
        node_id: str,
    ) -> Mapping[str, Sequence[str]]:
        variable_mappings: dict[str, Sequence[str]] = {}

        def _add_variable_selectors(selectors: Sequence[Sequence[str]]) -> None:
            for selector in selectors:
                if len(selector) < SELECTORS_LENGTH:
                    continue
                qualified_variable_mapping_key = (
                    f"{node_id}.#{'.'.join(selector[:SELECTORS_LENGTH])}#"
                )
                variable_mappings[qualified_variable_mapping_key] = list(
                    selector[:SELECTORS_LENGTH],
                )

        form_template_parser = VariableTemplateParser(template=self.form_content)
        _add_variable_selectors([
            selector.value_selector
            for selector in form_template_parser.extract_variable_selectors()
        ])

        for form_input in self.inputs:
            selectors = form_input.extract_variable_selectors()
            for selector in selectors:
                value_key = ".".join(selector)
                qualified_variable_mapping_key = f"{node_id}.#{value_key}#"
                variable_mappings[qualified_variable_mapping_key] = selector

        return variable_mappings

    def find_action_text(self, action_id: str) -> str:
        """Resolve action display text by id."""
        for action in self.user_actions:
            if action.id == action_id:
                return action.title
        return action_id

    def must_resolve_action_value(self, action_id: str) -> str:
        """Resolve the selected action's workflow-facing value by id.

        This method should only be called with action ids that have already been
        validated against the node configuration.

        Returns:
            The configured workflow-facing value for the selected action id.

        Raises:
            AssertionError: If the action id is not present in the node config.
        """
        for action in self.user_actions:
            if action.id == action_id:
                return action.title
        msg = f"Invalid action: {action_id}"
        raise AssertionError(msg)


class FormDefinition(BaseModel):
    form_content: str
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    rendered_content: str
    expiration_time: datetime

    # this is used to store the resolved default values
    default_values: dict[str, Any] = Field(default_factory=dict)

    # node_title records the title of the HumanInput node.
    node_title: str | None = None

    # display_in_ui controls whether the form should be displayed in UI surfaces.
    display_in_ui: bool | None = None


class HumanInputSubmissionValidationError(ValueError):
    pass


def validate_human_input_submission(
    *,
    inputs: Sequence[FormInputConfig],
    user_actions: Sequence[UserActionConfig],
    selected_action_id: str,
    form_data: Mapping[str, Any],
) -> None:
    available_actions = {action.id for action in user_actions}
    if selected_action_id not in available_actions:
        msg = f"Invalid action: {selected_action_id}"
        raise HumanInputSubmissionValidationError(msg)

    provided_inputs = set(form_data.keys())
    missing_inputs = [
        form_input.output_variable_name
        for form_input in inputs
        if form_input.output_variable_name not in provided_inputs
    ]

    if missing_inputs:
        missing_list = ", ".join(missing_inputs)
        msg = f"Missing required inputs: {missing_list}"
        raise HumanInputSubmissionValidationError(msg)
