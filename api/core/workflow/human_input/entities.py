from __future__ import annotations

import abc
import json
import re
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, Self, assert_never

from pydantic import BaseModel, Field, NonNegativeInt, field_validator, model_validator

from factories.file_factory.validation import is_file_valid_with_config
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.file import FileUploadConfig
from graphon.file.enums import FileTransferMethod, FileType
from graphon.runtime import VariablePool
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.segments import Segment

from .enums import ButtonStyle, FormInputType, TimeoutUnit, ValueSourceType

_OUTPUT_VARIABLE_PATTERN = re.compile(r"\{\{#\$output\.(?P<field_name>[a-zA-Z_][a-zA-Z0-9_]{0,29})#\}\}")
_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_ALLOWED_TRANSFER_METHOD = frozenset((FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL))


class StringSource(BaseModel):
    type: ValueSourceType
    selector: Sequence[str] = Field(default_factory=tuple)
    value: str = ""

    @model_validator(mode="after")
    def _validate_selector(self) -> Self:
        if self.type == ValueSourceType.CONSTANT:
            return self
        if len(self.selector) < SELECTORS_LENGTH:
            raise ValueError(
                f"the length of selector should be at least {SELECTORS_LENGTH}, selector={self.selector}"
            )
        return self


class StringListSource(BaseModel):
    type: ValueSourceType
    selector: Sequence[str] = Field(default_factory=tuple)
    value: list[str] = Field(default_factory=list)


class BaseInputConfig(BaseModel):
    output_variable_name: str

    @abc.abstractmethod
    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        raise NotImplementedError

    @abc.abstractmethod
    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        raise NotImplementedError


class ParagraphInputConfig(BaseInputConfig):
    type: Literal[FormInputType.PARAGRAPH] = FormInputType.PARAGRAPH
    default: StringSource | None = None

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        if self.default is None or self.default.type == ValueSourceType.CONSTANT:
            return []
        return [self.default.selector]

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        if self.default is None or self.default.type == ValueSourceType.CONSTANT:
            return None
        return pool.get(self.default.selector)


class SelectInputConfig(BaseInputConfig):
    type: Literal[FormInputType.SELECT] = FormInputType.SELECT
    option_source: StringListSource

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        if self.option_source.type == ValueSourceType.CONSTANT:
            return []
        return [self.option_source.selector]

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


class _FileInputCommonConfig(BaseModel):
    allowed_file_types: Sequence[FileType] = Field(default_factory=list[FileType])
    allowed_file_extensions: Sequence[str] = Field(default_factory=list)
    allowed_file_upload_methods: Sequence[FileTransferMethod] = Field(default_factory=list[FileTransferMethod])

    @field_validator("allowed_file_upload_methods", mode="after")
    @classmethod
    def _validate_upload_methods(cls, transfer_methods: Sequence[FileTransferMethod]) -> Sequence[FileTransferMethod]:
        validated_values: list[FileTransferMethod] = []
        for value in transfer_methods:
            if value not in _ALLOWED_TRANSFER_METHOD:
                raise ValueError(f"unsupported transfer method: {value}")
            validated_values.append(value)
        return validated_values

    @model_validator(mode="after")
    def _validate_extensions(self) -> Self:
        if FileType.CUSTOM not in self.allowed_file_types:
            return self
        if not self.allowed_file_extensions:
            raise ValueError("allowed_file_extensions must be set when allowed_file_types is custom")
        return self


class FileInputConfig(_FileInputCommonConfig, BaseInputConfig):
    type: Literal[FormInputType.FILE] = FormInputType.FILE

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        return []

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


class FileListInputConfig(_FileInputCommonConfig, BaseInputConfig):
    type: Literal[FormInputType.FILE_LIST] = FormInputType.FILE_LIST
    number_limits: NonNegativeInt = 0

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        return []

    def resolve_default_value(self, pool: ReadOnlyVariablePool) -> Segment | None:
        _ = pool
        return None


FormInputConfig = Annotated[
    ParagraphInputConfig | SelectInputConfig | FileInputConfig | FileListInputConfig,
    Field(discriminator="type"),
]


class UserActionConfig(BaseModel):
    id: str = Field(max_length=20)
    title: str = Field(max_length=100)
    button_style: ButtonStyle = ButtonStyle.DEFAULT

    @field_validator("id")
    @classmethod
    def _validate_id(cls, value: str) -> str:
        if not _IDENTIFIER_PATTERN.match(value):
            raise ValueError(
                f"'{value}' is not a valid identifier. It must start with a letter or underscore, and contain only "
                "letters, numbers, or underscores."
            )
        return value


class HumanInputNodeData(BaseNodeData):
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
                raise ValueError(f"duplicated output_variable_name '{name}' in inputs")
            seen_names.add(name)
        return inputs

    @field_validator("user_actions")
    @classmethod
    def _validate_user_actions(cls, user_actions: list[UserActionConfig]) -> list[UserActionConfig]:
        seen_ids: set[str] = set()
        for action in user_actions:
            if action.id in seen_ids:
                raise ValueError(f"duplicated user action id '{action.id}'")
            seen_ids.add(action.id)
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
        return [match.group("field_name") for match in _OUTPUT_VARIABLE_PATTERN.finditer(self.form_content)]

    def extract_variable_selector_to_variable_mapping(self, node_id: str) -> Mapping[str, Sequence[str]]:
        variable_mappings: dict[str, Sequence[str]] = {}

        def _add_variable_selectors(selectors: Sequence[Sequence[str]]) -> None:
            for selector in selectors:
                if len(selector) < SELECTORS_LENGTH:
                    continue
                qualified_key = f"{node_id}.#{'.'.join(selector[:SELECTORS_LENGTH])}#"
                variable_mappings[qualified_key] = list(selector[:SELECTORS_LENGTH])

        form_template_parser = VariableTemplateParser(template=self.form_content)
        _add_variable_selectors(
            [selector.value_selector for selector in form_template_parser.extract_variable_selectors()],
        )

        for form_input in self.inputs:
            for selector in form_input.extract_variable_selectors():
                if len(selector) < SELECTORS_LENGTH:
                    continue
                value_key = ".".join(selector)
                variable_mappings[f"{node_id}.#{value_key}#"] = list(selector)

        return variable_mappings

    def find_action_text(self, action_id: str) -> str:
        for action in self.user_actions:
            if action.id == action_id:
                return action.title
        return action_id

    def must_resolve_action_value(self, action_id: str) -> str:
        for action in self.user_actions:
            if action.id == action_id:
                return action.title
        raise AssertionError(f"Invalid action: {action_id}")


class FormDefinition(BaseModel):
    form_content: str
    inputs: list[FormInputConfig] = Field(default_factory=list[FormInputConfig])
    user_actions: list[UserActionConfig] = Field(default_factory=list[UserActionConfig])
    rendered_content: str
    expiration_time: datetime
    default_values: dict[str, Any] = Field(default_factory=dict)
    node_title: str | None = None
    display_in_ui: bool | None = None


class HumanInputSubmissionValidationError(ValueError):
    pass


def _input_type_value(form_input: Any) -> str | None:
    input_type = getattr(form_input, "type", None)
    return str(input_type) if input_type is not None else None


def _is_paragraph_input(form_input: Any) -> bool:
    return _input_type_value(form_input) == FormInputType.PARAGRAPH


def _is_select_input(form_input: Any) -> bool:
    return _input_type_value(form_input) == FormInputType.SELECT


def _is_file_input(form_input: Any) -> bool:
    return _input_type_value(form_input) == FormInputType.FILE


def _is_file_list_input(form_input: Any) -> bool:
    return _input_type_value(form_input) == FormInputType.FILE_LIST


def extract_output_field_names(form_content: str) -> list[str]:
    if not form_content:
        return []
    return [match.group("field_name") for match in _OUTPUT_VARIABLE_PATTERN.finditer(form_content)]


def render_form_content_before_submission(
    *,
    form_content: str,
    variable_pool: VariablePool | None,
) -> str:
    """Render runtime variables while leaving output placeholders intact."""
    if variable_pool is None:
        return form_content

    rendered_content = variable_pool.convert_template(form_content)
    markdown = getattr(rendered_content, "markdown", None)
    if isinstance(markdown, str):
        return markdown

    text = getattr(rendered_content, "text", None)
    if isinstance(text, str):
        return text
    return form_content


def _render_output_placeholder_value(*, value: Any, form_input: FormInputConfig | None) -> str:
    if value is None:
        return ""
    if _is_file_input(form_input):
        return "[file]"
    if _is_file_list_input(form_input):
        file_count = len(value) if isinstance(value, Sequence) and not isinstance(value, str | bytes) else 0
        return f"[{file_count} files]"
    if _is_paragraph_input(form_input) or _is_select_input(form_input):
        return str(value)
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def render_form_content_with_outputs(
    form_content: str,
    outputs: Mapping[str, Any],
    field_names: Sequence[str],
    form_inputs: Sequence[FormInputConfig] | None = None,
) -> str:
    inputs_by_name = {}
    if form_inputs is not None:
        inputs_by_name = {form_input.output_variable_name: form_input for form_input in form_inputs}

    rendered_content = form_content
    for field_name in field_names:
        placeholder = "{{#$output." + field_name + "#}}"
        rendered_content = rendered_content.replace(
            placeholder,
            _render_output_placeholder_value(value=outputs.get(field_name), form_input=inputs_by_name.get(field_name)),
        )
    return rendered_content


def restore_submitted_data(
    *,
    node_data: HumanInputNodeData,
    submitted_data: Mapping[str, Any],
    file_value_restorer: Callable[[Mapping[str, Any]], Any],
) -> Mapping[str, Any]:
    restored_data: dict[str, Any] = dict(submitted_data)
    for input_config in node_data.inputs:
        output_variable_name = input_config.output_variable_name
        if output_variable_name not in submitted_data:
            continue
        restored_data[output_variable_name] = restore_submitted_value(
            input_config=input_config,
            value=submitted_data[output_variable_name],
            file_value_restorer=file_value_restorer,
        )
    return restored_data


def restore_submitted_value(
    *,
    input_config: FormInputConfig,
    value: Any,
    file_value_restorer: Callable[[Mapping[str, Any]], Any],
) -> Any:
    if _is_file_input(input_config):
        if not isinstance(value, Mapping):
            raise ValueError(
                "HumanInput file submission must be persisted as a mapping, "
                f"output_variable_name={input_config.output_variable_name}"
            )
        return file_value_restorer(value)
    if _is_file_list_input(input_config):
        if not isinstance(value, list):
            raise ValueError(
                "HumanInput file-list submission must be persisted as a list, "
                f"output_variable_name={input_config.output_variable_name}"
            )
        if any(not isinstance(item, Mapping) for item in value):
            raise ValueError(
                "HumanInput file-list submission must contain mappings, "
                f"output_variable_name={input_config.output_variable_name}"
            )
        return [file_value_restorer(item) for item in value]
    return value


def validate_human_input_submission(
    *,
    inputs: Sequence[FormInputConfig],
    user_actions: Sequence[UserActionConfig],
    selected_action_id: str,
    form_data: Mapping[str, Any],
) -> None:
    available_actions = {action.id for action in user_actions}
    if selected_action_id not in available_actions:
        raise HumanInputSubmissionValidationError(f"Invalid action: {selected_action_id}")

    provided_inputs = set(form_data.keys())
    missing_inputs = [form_input.output_variable_name for form_input in inputs if form_input.output_variable_name not in provided_inputs]
    if missing_inputs:
        raise HumanInputSubmissionValidationError(f"Missing required inputs: {', '.join(missing_inputs)}")

    inputs_by_name = {form_input.output_variable_name: form_input for form_input in inputs}
    for output_variable_name, value in form_data.items():
        form_input = inputs_by_name.get(output_variable_name)
        if form_input is None:
            continue
        _validate_submitted_input_value(form_input=form_input, value=value)


def _validate_submitted_input_value(*, form_input: FormInputConfig, value: Any) -> None:
    if _is_select_input(form_input):
        if not isinstance(value, str):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for select input '{form_input.output_variable_name}': expected string"
            )
        option_source = form_input.option_source
        if str(option_source.type) == ValueSourceType.CONSTANT and value not in option_source.value:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for select input '{form_input.output_variable_name}': {value}"
            )
        return

    if _is_file_input(form_input):
        if not isinstance(value, Mapping):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file input '{form_input.output_variable_name}': expected mapping"
            )
        _validate_submitted_file_mapping(form_input=form_input, value=value)
        return

    if _is_file_list_input(form_input):
        if not isinstance(value, list):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': expected list"
            )
        if any(not isinstance(item, Mapping) for item in value):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': expected list of mappings"
            )
        for item in value:
            _validate_submitted_file_mapping(form_input=form_input, value=item)
        if getattr(form_input, "number_limits", 0) > 0 and len(value) > form_input.number_limits:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': exceeds number limit"
            )


def _validate_submitted_file_mapping(
    *,
    form_input: FileInputConfig | FileListInputConfig,
    value: Mapping[str, Any],
) -> None:
    file_type_value = value.get("type")
    transfer_method_value = value.get("transfer_method")
    extension = value.get("extension")

    try:
        file_type = FileType(file_type_value)
    except ValueError as exc:
        raise HumanInputSubmissionValidationError(
            f"Invalid value for file input '{form_input.output_variable_name}': unsupported file type"
        ) from exc

    try:
        transfer_method = FileTransferMethod(transfer_method_value)
    except ValueError as exc:
        raise HumanInputSubmissionValidationError(
            f"Invalid value for file input '{form_input.output_variable_name}': unsupported transfer method"
        ) from exc

    if not isinstance(extension, str):
        extension = ""

    upload_config = FileUploadConfig(
        allowed_file_types=list(form_input.allowed_file_types),
        allowed_file_extensions=list(form_input.allowed_file_extensions),
        allowed_file_upload_methods=list(form_input.allowed_file_upload_methods),
        number_limits=1,
    )
    if is_file_valid_with_config(
        input_file_type=file_type,
        file_extension=extension,
        file_transfer_method=transfer_method,
        config=upload_config,
    ):
        return

    raise HumanInputSubmissionValidationError(
        f"Invalid value for file input '{form_input.output_variable_name}': file is not allowed by config"
    )


__all__ = [
    "FileInputConfig",
    "FileListInputConfig",
    "FormDefinition",
    "FormInputConfig",
    "HumanInputNodeData",
    "HumanInputSubmissionValidationError",
    "ParagraphInputConfig",
    "SelectInputConfig",
    "StringListSource",
    "StringSource",
    "UserActionConfig",
    "extract_output_field_names",
    "render_form_content_before_submission",
    "render_form_content_with_outputs",
    "restore_submitted_data",
    "restore_submitted_value",
    "validate_human_input_submission",
]
