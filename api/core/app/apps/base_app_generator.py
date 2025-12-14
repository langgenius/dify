from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Union, final

from sqlalchemy.orm import Session

from core.app.app_config.entities import VariableEntityType
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import File, FileUploadConfig
from core.workflow.enums import NodeType
from core.workflow.repositories.draft_variable_repository import (
    DraftVariableSaver,
    DraftVariableSaverFactory,
    NoopDraftVariableSaver,
)
from factories import file_factory
from libs.orjson import orjson_dumps
from models import Account, EndUser
from services.workflow_draft_variable_service import DraftVariableSaver as DraftVariableSaverImpl

if TYPE_CHECKING:
    from core.app.app_config.entities import VariableEntity


class BaseAppGenerator:
    def _prepare_user_inputs(
        self,
        *,
        user_inputs: Mapping[str, Any] | None,
        variables: Sequence["VariableEntity"],
        tenant_id: str,
        strict_type_validation: bool = False,
    ) -> Mapping[str, Any]:
        user_inputs = user_inputs or {}
        # Filter input variables from form configuration, handle required fields, default values, and option values
        user_inputs = {
            var.variable: self._validate_inputs(value=user_inputs.get(var.variable), variable_entity=var)
            for var in variables
        }
        user_inputs = {k: self._sanitize_value(v) for k, v in user_inputs.items()}
        # Convert files in inputs to File
        entity_dictionary = {item.variable: item for item in variables}
        # Convert single file to File
        files_inputs = {
            k: file_factory.build_from_mapping(
                mapping=v,
                tenant_id=tenant_id,
                config=FileUploadConfig(
                    allowed_file_types=entity_dictionary[k].allowed_file_types or [],
                    allowed_file_extensions=entity_dictionary[k].allowed_file_extensions or [],
                    allowed_file_upload_methods=entity_dictionary[k].allowed_file_upload_methods or [],
                ),
                strict_type_validation=strict_type_validation,
            )
            for k, v in user_inputs.items()
            if isinstance(v, dict) and entity_dictionary[k].type == VariableEntityType.FILE
        }
        # Convert list of files to File
        file_list_inputs = {
            k: file_factory.build_from_mappings(
                mappings=v,
                tenant_id=tenant_id,
                config=FileUploadConfig(
                    allowed_file_types=entity_dictionary[k].allowed_file_types or [],
                    allowed_file_extensions=entity_dictionary[k].allowed_file_extensions or [],
                    allowed_file_upload_methods=entity_dictionary[k].allowed_file_upload_methods or [],
                ),
            )
            for k, v in user_inputs.items()
            if isinstance(v, list)
            # Ensure skip List<File>
            and all(isinstance(item, dict) for item in v)
            and entity_dictionary[k].type == VariableEntityType.FILE_LIST
        }
        # Merge all inputs
        user_inputs = {**user_inputs, **files_inputs, **file_list_inputs}

        # Check if all files are converted to File
        if any(filter(lambda v: isinstance(v, dict), user_inputs.values())):
            raise ValueError("Invalid input type")
        if any(
            filter(lambda v: isinstance(v, dict), filter(lambda item: isinstance(item, list), user_inputs.values()))
        ):
            raise ValueError("Invalid input type")

        return user_inputs

    def _validate_inputs(
        self,
        *,
        variable_entity: "VariableEntity",
        value: Any,
    ):
        if value is None:
            if variable_entity.required:
                raise ValueError(f"{variable_entity.variable} is required in input form")
            # Use default value and continue validation to ensure type conversion
            value = variable_entity.default
            # If default is also None, return None directly
            if value is None:
                return None

        # Treat empty placeholders for optional file inputs as unset
        if (
            variable_entity.type in {VariableEntityType.FILE, VariableEntityType.FILE_LIST}
            and not variable_entity.required
        ):
            # Treat empty string (frontend default) or empty list as unset
            if not value and isinstance(value, (str, list)):
                return None

        if variable_entity.type in {
            VariableEntityType.TEXT_INPUT,
            VariableEntityType.SELECT,
            VariableEntityType.PARAGRAPH,
        } and not isinstance(value, str):
            raise ValueError(
                f"(type '{variable_entity.type}') {variable_entity.variable} in input form must be a string"
            )

        if variable_entity.type == VariableEntityType.NUMBER:
            if isinstance(value, (int, float)):
                return value
            elif isinstance(value, str):
                # handle empty string case
                if not value.strip():
                    return None
                # may raise ValueError if user_input_value is not a valid number
                try:
                    if "." in value:
                        return float(value)
                    else:
                        return int(value)
                except ValueError:
                    raise ValueError(f"{variable_entity.variable} in input form must be a valid number")
            else:
                raise TypeError(f"expected value type int, float or str, got {type(value)}, value: {value}")

        match variable_entity.type:
            case VariableEntityType.SELECT:
                if value not in variable_entity.options:
                    raise ValueError(
                        f"{variable_entity.variable} in input form must be one of the following: "
                        f"{variable_entity.options}"
                    )
            case VariableEntityType.TEXT_INPUT | VariableEntityType.PARAGRAPH:
                if variable_entity.max_length and len(value) > variable_entity.max_length:
                    raise ValueError(
                        f"{variable_entity.variable} in input form must be less than {variable_entity.max_length} "
                        "characters"
                    )
            case VariableEntityType.FILE:
                if not isinstance(value, dict) and not isinstance(value, File):
                    raise ValueError(f"{variable_entity.variable} in input form must be a file")
            case VariableEntityType.FILE_LIST:
                # if number of files exceeds the limit, raise ValueError
                if not (
                    isinstance(value, list)
                    and (all(isinstance(item, dict) for item in value) or all(isinstance(item, File) for item in value))
                ):
                    raise ValueError(f"{variable_entity.variable} in input form must be a list of files")

                if variable_entity.max_length and len(value) > variable_entity.max_length:
                    raise ValueError(
                        f"{variable_entity.variable} in input form must be less than {variable_entity.max_length} files"
                    )
            case VariableEntityType.CHECKBOX:
                if isinstance(value, str):
                    normalized_value = value.strip().lower()
                    if normalized_value in {"true", "1", "yes", "on"}:
                        value = True
                    elif normalized_value in {"false", "0", "no", "off"}:
                        value = False
                elif isinstance(value, (int, float)):
                    if value == 1:
                        value = True
                    elif value == 0:
                        value = False
            case _:
                raise AssertionError("this statement should be unreachable.")

        return value

    def _sanitize_value(self, value: Any):
        if isinstance(value, str):
            return value.replace("\x00", "")
        return value

    @classmethod
    def convert_to_event_stream(cls, generator: Union[Mapping, Generator[Mapping | str, None, None]]):
        """
        Convert messages into event stream
        """
        if isinstance(generator, dict):
            return generator
        else:

            def gen():
                for message in generator:
                    if isinstance(message, Mapping | dict):
                        yield f"data: {orjson_dumps(message)}\n\n"
                    else:
                        yield f"event: {message}\n\n"

            return gen()

    @final
    @staticmethod
    def _get_draft_var_saver_factory(invoke_from: InvokeFrom, account: Account | EndUser) -> DraftVariableSaverFactory:
        if invoke_from == InvokeFrom.DEBUGGER:
            assert isinstance(account, Account)

            def draft_var_saver_factory(
                session: Session,
                app_id: str,
                node_id: str,
                node_type: NodeType,
                node_execution_id: str,
                enclosing_node_id: str | None = None,
            ) -> DraftVariableSaver:
                return DraftVariableSaverImpl(
                    session=session,
                    app_id=app_id,
                    node_id=node_id,
                    node_type=node_type,
                    node_execution_id=node_execution_id,
                    enclosing_node_id=enclosing_node_id,
                    user=account,
                )
        else:

            def draft_var_saver_factory(
                session: Session,
                app_id: str,
                node_id: str,
                node_type: NodeType,
                node_execution_id: str,
                enclosing_node_id: str | None = None,
            ) -> DraftVariableSaver:
                return NoopDraftVariableSaver()

        return draft_var_saver_factory
