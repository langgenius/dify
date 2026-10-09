"""Draft-variable loading and output preparation through injected ports."""

import json
import logging
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, ClassVar, Protocol, cast, override

from configs import dify_config
from core.trigger.constants import is_trigger_node_type
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    RAG_PIPELINE_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from factories.variable_factory import build_segment, build_segment_with_type, segment_to_variable
from graphon.enums import NodeType
from graphon.file import File
from graphon.nodes import BuiltinNodeTypes
from graphon.nodes.variable_assigner.common.helpers import get_updated_variables
from graphon.variable_loader import VariableLoader
from graphon.variables import Segment, StringSegment, VariableBase
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.segments import ArrayFileSegment
from graphon.variables.types import SegmentType
from graphon.variables.utils import dumps_with_segments
from libs.uuid_utils import uuidv7
from models import Account, UploadFile
from models.workflow import WorkflowDraftVariable, WorkflowDraftVariableFile, is_system_variable_editable
from services.variable_truncator import VariableTruncator


class DraftVariableReader(Protocol):
    def get_draft_variables_by_selectors(
        self, app_id: str, selectors: Sequence[list[str]], user_id: str
    ) -> list[WorkflowDraftVariable]: ...


class DraftVariableWriter(Protocol):
    def save(self, variables: Sequence[WorkflowDraftVariable], files: Sequence[WorkflowDraftVariableFile]) -> None: ...
    def retain_files_for_cleanup(self, files: Sequence[WorkflowDraftVariableFile]) -> None: ...


class DraftFileUploader(Protocol):
    def upload_file(
        self, *, filename: str, content: bytes, mimetype: str, user: Account, tenant_id: str
    ) -> UploadFile: ...


class DraftFileRestorer(Protocol):
    def restore(self, *, tenant_id: str, mapping: dict[str, Any]) -> File: ...


def conversation_defaults(app_id: str, variables: Sequence[VariableBase], user_id: str) -> list[WorkflowDraftVariable]:
    return [
        WorkflowDraftVariable.new_conversation_variable(
            app_id=app_id, user_id=user_id, name=variable.name, value=variable, description=variable.description
        )
        for variable in variables
    ]


logger = logging.getLogger(__name__)


class WorkflowDraftVariableError(Exception):
    pass


class VariableResetError(WorkflowDraftVariableError):
    pass


class UpdateNotSupportedError(WorkflowDraftVariableError):
    pass


class DraftVarLoader(VariableLoader):
    # This implements the VariableLoader interface for loading draft variables.
    #
    # ref: graphon.variable_loader.VariableLoader

    # Short sessions used for loading variables, including injected execution stores.
    _repository: DraftVariableReader
    # Application ID for which variables are being loaded.
    _app_id: str
    _user_id: str
    _tenant_id: str

    def __init__(
        self,
        repository: DraftVariableReader,
        app_id: str,
        tenant_id: str,
        user_id: str,
        *,
        load_file: Callable[[str], bytes],
        file_inputs: DraftFileRestorer,
    ):
        self._repository = repository
        self._app_id = app_id
        self._user_id = user_id
        self._tenant_id = tenant_id
        self._load_file = load_file
        self._file_inputs = file_inputs

    def _selector_to_tuple(self, selector: Sequence[str]) -> tuple[str, str]:
        return (selector[0], selector[1])

    def _build_segment(self, value_type: SegmentType, value: Any) -> Segment:
        # The owner may be an App, Pipeline or Snippet. Use the invocation's
        # tenant and file gateway instead of asking the ORM to resolve an App.
        if value_type == SegmentType.FILE:
            value = self._file_inputs.restore(tenant_id=self._tenant_id, mapping=value)
        elif value_type == SegmentType.ARRAY_FILE:
            value = [self._file_inputs.restore(tenant_id=self._tenant_id, mapping=item) for item in value]
        return build_segment_with_type(value_type, value)

    @override
    def load_variables(self, selectors: list[list[str]]) -> list[VariableBase]:
        if not selectors:
            return []

        # Map each selector (as a tuple via `_selector_to_tuple`) to its corresponding variable instance.
        variable_by_selector: dict[tuple[str, str], VariableBase] = {}

        draft_vars = self._repository.get_draft_variables_by_selectors(self._app_id, selectors, self._user_id)

        offloaded_draft_vars = []
        for draft_var in draft_vars:
            if draft_var.is_truncated():
                offloaded_draft_vars.append(draft_var)
                continue

            segment = self._build_segment(draft_var.value_type, json.loads(draft_var.value))
            variable = segment_to_variable(
                segment=segment,
                selector=draft_var.get_selector(),
                variable_id=draft_var.id,
                name=draft_var.name,
                description=draft_var.description,
            )
            selector_tuple = self._selector_to_tuple(variable.selector)
            variable_by_selector[selector_tuple] = variable

        # Load offloaded variables using multithreading.
        # This approach reduces loading time by querying external systems concurrently.
        with ThreadPoolExecutor(max_workers=10) as executor:
            offloaded_variables = executor.map(self._load_offloaded_variable, offloaded_draft_vars)
            for selector, offloaded_variable in offloaded_variables:
                variable_by_selector[selector] = offloaded_variable

        return list(variable_by_selector.values())

    def _load_offloaded_variable(self, draft_var: WorkflowDraftVariable) -> tuple[tuple[str, str], VariableBase]:
        # This logic is closely tied to `DraftVariableSaver._try_offload_large_variable`
        # and must remain synchronized with it.
        # Ideally, these should be co-located for better maintainability.
        # However, due to the current code structure, this is not straightforward.

        variable_file = draft_var.variable_file
        assert variable_file is not None
        upload_file = variable_file.upload_file
        assert upload_file is not None
        content = self._load_file(upload_file.key)
        if variable_file.value_type == SegmentType.STRING:
            # The inferenced type is StringSegment, which is not correct inside this function.
            segment: Segment = StringSegment(value=content.decode())

            variable = segment_to_variable(
                segment=segment,
                selector=draft_var.get_selector(),
                variable_id=draft_var.id,
                name=draft_var.name,
                description=draft_var.description,
            )
            return (draft_var.node_id, draft_var.name), variable

        deserialized = json.loads(content)
        segment = self._build_segment(variable_file.value_type, deserialized)
        variable = segment_to_variable(
            segment=segment,
            selector=draft_var.get_selector(),
            variable_id=draft_var.id,
            name=draft_var.name,
            description=draft_var.description,
        )
        # No special handling needed for  ArrayFileSegment, as we do not offload ArrayFileSegment
        return (draft_var.node_id, draft_var.name), variable


def _build_segment_for_serialized_values(v: Any) -> Segment:
    """
    Reconstructs Segment objects from serialized values, with special handling
    for FileSegment and ArrayFileSegment types.

    This function should only be used when:
    1. No explicit type information is available
    2. The input value is in serialized form (dict or list)

    It detects potential file objects in the serialized data and properly rebuilds the
    appropriate segment type.
    """
    return build_segment(WorkflowDraftVariable.rebuild_file_types(v))


def _make_filename_trans_table() -> dict[int, str]:
    linux_chars = ["/", "\x00"]
    windows_chars = [
        "<",
        ">",
        ":",
        '"',
        "/",
        "\\",
        "|",
        "?",
        "*",
    ]
    windows_chars.extend(chr(i) for i in range(32))

    trans_table = dict.fromkeys(linux_chars + windows_chars, "_")
    return str.maketrans(trans_table)


_FILENAME_TRANS_TABLE = _make_filename_trans_table()


class DraftVariableSaver:
    """Persist draft outputs under the tenant that owns the app or pipeline."""

    # _DUMMY_OUTPUT_IDENTITY is a placeholder output for workflow nodes.
    # Its sole possible value is `None`.
    #
    # This is used to signal the execution of a workflow node when it has no other outputs.
    _DUMMY_OUTPUT_IDENTITY: ClassVar[str] = "__dummy__"
    _DUMMY_OUTPUT_VALUE: ClassVar[None] = None

    # _EXCLUDE_VARIABLE_NAMES_MAPPING maps node types and versions to variable names that
    # should be excluded when saving draft variables. This prevents certain internal or
    # technical variables from being exposed in the draft environment, particularly those
    # that aren't meant to be directly edited or viewed by users.
    _EXCLUDE_VARIABLE_NAMES_MAPPING: dict[NodeType, frozenset[str]] = {
        BuiltinNodeTypes.LLM: frozenset(("finish_reason",)),
        BuiltinNodeTypes.LOOP: frozenset(("loop_round",)),
    }

    # Database session used for persisting draft variables.
    _repository: DraftVariableWriter

    # Resource owner tenant. An account's current tenant may be unset or point elsewhere
    # when draft variables are persisted by an asynchronous workflow execution.
    _tenant_id: str

    # The application ID associated with the draft variables.
    # This should match the `Workflow.app_id` of the workflow to which the current node belongs.
    _app_id: str

    # The ID of the node for which DraftVariableSaver is saving output variables.
    _node_id: str

    # The type of the current node (see NodeType).
    _node_type: NodeType

    #
    _node_execution_id: str

    # _enclosing_node_id identifies the container node that the current node belongs to.
    # For example, if the current node is an LLM node inside an Iteration node
    # or Loop node, then `_enclosing_node_id` refers to the ID of
    # the containing Iteration or Loop node.
    #
    # If the current node is not nested within another node, `_enclosing_node_id` is
    # `None`.
    _enclosing_node_id: str | None

    def __init__(
        self,
        app_id: str,
        node_id: str,
        node_type: NodeType,
        node_execution_id: str,
        enclosing_node_id: str | None = None,
        *,
        repository: DraftVariableWriter,
        files: DraftFileUploader,
        file_inputs: DraftFileRestorer,
        cleanup_files: Callable[[list[str]], None],
        tenant_id: str,
        user: Account,
    ):
        # Important: `node_execution_id` parameter refers to the primary key (`id`) of the
        # WorkflowNodeExecutionModel/WorkflowNodeExecution, not their `node_execution_id`
        # field. These are distinct database fields with different purposes.
        self._repository = repository
        self._files = files
        self._file_inputs = file_inputs
        self._cleanup_files = cleanup_files
        self._uploaded_file_ids: list[str] = []
        self._variable_files: list[WorkflowDraftVariableFile] = []
        self._tenant_id = tenant_id
        self._app_id = app_id
        self._node_id = node_id
        self._node_type = node_type
        self._node_execution_id = node_execution_id
        self._user = user
        self._enclosing_node_id = enclosing_node_id

    def _create_dummy_output_variable(self):
        return WorkflowDraftVariable.new_node_variable(
            app_id=self._app_id,
            user_id=self._user.id,
            node_id=self._node_id,
            name=self._DUMMY_OUTPUT_IDENTITY,
            node_execution_id=self._node_execution_id,
            value=build_segment(self._DUMMY_OUTPUT_VALUE),
            visible=False,
            editable=False,
        )

    def _should_save_output_variables_for_draft(self) -> bool:
        if self._enclosing_node_id is not None and self._node_type != BuiltinNodeTypes.VARIABLE_ASSIGNER:
            # Currently we do not save output variables for nodes inside loop or iteration.
            return False
        return True

    def _build_from_variable_assigner_mapping(self, process_data: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars: list[WorkflowDraftVariable] = []
        updated_variables = get_updated_variables(process_data) or []

        for item in updated_variables:
            selector = item.selector
            if len(selector) < SELECTORS_LENGTH:
                raise Exception("selector too short")
            # NOTE(QuantumGhost): only the following two kinds of variable could be updated by
            # VariableAssigner: ConversationVariable and iteration variable.
            # We only save conversation variable here.
            if selector[0] != CONVERSATION_VARIABLE_NODE_ID:
                continue
            # Conversation variables are exposed as NUMBER in the UI even if their
            # persisted type is INTEGER. Allow float updates by loosening the type
            # to NUMBER here so downstream storage infers the precise subtype.
            segment_type = SegmentType.NUMBER if item.value_type == SegmentType.INTEGER else item.value_type
            segment = WorkflowDraftVariable.build_segment_with_type(segment_type=segment_type, value=item.new_value)
            draft_vars.append(
                WorkflowDraftVariable.new_conversation_variable(
                    app_id=self._app_id,
                    user_id=self._user.id,
                    name=item.name,
                    value=segment,
                )
            )
        # Add a dummy output variable to indicate that this node is executed.
        draft_vars.append(self._create_dummy_output_variable())
        return draft_vars

    def _build_variables_from_start_mapping(self, output: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars = []
        has_non_sys_variables = False
        for name, value in output.items():
            value_seg = _build_segment_for_serialized_values(value)
            node_id, name = self._normalize_variable_for_start_node(name)
            if node_id == SYSTEM_VARIABLE_NODE_ID:
                if name == SystemVariableKey.FILES:
                    # Here we know the type of variable must be `array[file]`, we
                    # just rebuild files from the serialized payload.
                    files = [
                        self._file_inputs.restore(
                            mapping=v,
                            tenant_id=self._tenant_id,
                        )
                        for v in value
                    ]
                    if files:
                        value_seg = WorkflowDraftVariable.build_segment_with_type(SegmentType.ARRAY_FILE, files)
                    else:
                        value_seg = ArrayFileSegment(value=[])

                draft_vars.append(
                    WorkflowDraftVariable.new_sys_variable(
                        app_id=self._app_id,
                        user_id=self._user.id,
                        name=name,
                        node_execution_id=self._node_execution_id,
                        value=value_seg,
                        editable=self._should_variable_be_editable(node_id, name),
                    )
                )
            elif node_id == CONVERSATION_VARIABLE_NODE_ID:
                draft_vars.append(
                    WorkflowDraftVariable.new_conversation_variable(
                        app_id=self._app_id,
                        user_id=self._user.id,
                        name=name,
                        value=value_seg,
                    )
                )
                has_non_sys_variables = True
            else:
                draft_vars.append(
                    WorkflowDraftVariable.new_node_variable(
                        app_id=self._app_id,
                        user_id=self._user.id,
                        node_id=node_id,
                        name=name,
                        node_execution_id=self._node_execution_id,
                        value=value_seg,
                        visible=self._should_variable_be_visible(node_id, self._node_type, name),
                        editable=self._should_variable_be_editable(node_id, name),
                    )
                )
                has_non_sys_variables = True
        if not has_non_sys_variables:
            draft_vars.append(self._create_dummy_output_variable())
        return draft_vars

    def _normalize_variable_for_start_node(self, name: str) -> tuple[str, str]:
        for reserved_node_id in (
            SYSTEM_VARIABLE_NODE_ID,
            ENVIRONMENT_VARIABLE_NODE_ID,
            CONVERSATION_VARIABLE_NODE_ID,
            RAG_PIPELINE_VARIABLE_NODE_ID,
        ):
            prefix = f"{reserved_node_id}."
            if name.startswith(prefix):
                _, name_ = name.split(".", maxsplit=1)
                return reserved_node_id, name_

        return self._node_id, name

    def _build_variables_from_mapping(self, output: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars = []
        for name, value in output.items():
            if not self._should_variable_be_saved(name):
                logger.debug(
                    "Skip saving variable as it has been excluded by its node_type, name=%s, node_type=%s",
                    name,
                    self._node_type,
                )
                continue
            if isinstance(value, Segment):
                value_seg = value
            else:
                value_seg = _build_segment_for_serialized_values(value)
            draft_vars.append(
                self._create_draft_variable(
                    name=name,
                    value=value_seg,
                    visible=True,
                    editable=True,
                ),
                # WorkflowDraftVariable.new_node_variable(
                #     app_id=self._app_id,
                #     node_id=self._node_id,
                #     name=name,
                #     node_execution_id=self._node_execution_id,
                #     value=value_seg,
                #     visible=self._should_variable_be_visible(self._node_id, self._node_type, name),
                # )
            )
        return draft_vars

    def _generate_filename(self, name: str):
        node_id_escaped = self._node_id.translate(_FILENAME_TRANS_TABLE)
        return f"{node_id_escaped}-{name}"

    def _try_offload_large_variable(
        self,
        name: str,
        value_seg: Segment,
    ) -> tuple[Segment, WorkflowDraftVariableFile] | None:
        # This logic is closely tied to `DraftVarLoader._load_offloaded_variable` and must remain
        # synchronized with it.
        # Ideally, these should be co-located for better maintainability.
        # However, due to the current code structure, this is not straightforward.
        truncator = VariableTruncator(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )
        truncation_result = truncator.truncate(value_seg)
        if not truncation_result.truncated:
            return None

        original_length = None
        if isinstance(value_seg.value, (list, dict)):
            original_length = len(value_seg.value)

        # Prepare content for storage
        original_content_serialized: str
        if isinstance(value_seg, StringSegment):
            # For string types, store as plain text
            original_content_serialized = cast(str, value_seg.value)
            content_type = "text/plain"
            filename = f"{self._generate_filename(name)}.txt"
        else:
            # For other types, store as JSON
            original_content_serialized = dumps_with_segments(value_seg.value)
            content_type = "application/json"
            filename = f"{self._generate_filename(name)}.json"

        original_size = len(original_content_serialized.encode("utf-8"))

        upload_file = self._files.upload_file(
            filename=filename,
            content=original_content_serialized.encode(),
            mimetype=content_type,
            user=self._user,
            tenant_id=self._tenant_id,
        )
        self._uploaded_file_ids.append(upload_file.id)
        # Create WorkflowDraftVariableFile record
        variable_file = WorkflowDraftVariableFile(
            upload_file_id=upload_file.id,
            size=original_size,
            length=original_length,
            value_type=value_seg.value_type,
            app_id=self._app_id,
            tenant_id=self._tenant_id,
            user_id=self._user.id,
        )
        variable_file.id = str(uuidv7())
        self._variable_files.append(variable_file)

        return truncation_result.result, variable_file

    def _create_draft_variable(
        self,
        *,
        name: str,
        value: Segment,
        visible: bool = True,
        editable: bool = True,
    ) -> WorkflowDraftVariable:
        """Create a draft variable with large variable handling and truncation."""
        # Handle Segment values

        offload_result = self._try_offload_large_variable(name, value)

        if offload_result is None:
            # Create the draft variable
            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id=self._app_id,
                user_id=self._user.id,
                node_id=self._node_id,
                name=name,
                node_execution_id=self._node_execution_id,
                value=value,
                visible=visible,
                editable=editable,
            )
            return draft_var
        else:
            truncated, var_file = offload_result
            # Create the draft variable
            draft_var = WorkflowDraftVariable.new_node_variable(
                app_id=self._app_id,
                user_id=self._user.id,
                node_id=self._node_id,
                name=name,
                node_execution_id=self._node_execution_id,
                value=truncated,
                visible=visible,
                editable=False,
                file_id=var_file.id,
            )
            return draft_var

    def save(
        self,
        process_data: Mapping[str, Any] | None = None,
        outputs: Mapping[str, Any] | None = None,
    ):
        self._variable_files = []
        self._uploaded_file_ids = []
        draft_vars: list[WorkflowDraftVariable] = []
        if outputs is None:
            outputs = {}
        if process_data is None:
            process_data = {}
        if not self._should_save_output_variables_for_draft():
            return
        try:
            if self._node_type == BuiltinNodeTypes.VARIABLE_ASSIGNER:
                draft_vars = self._build_from_variable_assigner_mapping(process_data=process_data)
            elif self._node_type == BuiltinNodeTypes.START or is_trigger_node_type(self._node_type):
                draft_vars = self._build_variables_from_start_mapping(outputs)
            else:
                draft_vars = self._build_variables_from_mapping(outputs)
            self._repository.save(draft_vars, self._variable_files)
        except Exception:
            # Uploads commit independently. Retain their orphan metadata after
            # rollback so periodic recovery can find them if storage and broker fail.
            try:
                if self._variable_files:
                    self._repository.retain_files_for_cleanup(self._variable_files)
            except Exception:
                logger.exception("Failed to retain draft upload metadata, upload_file_ids=%s", self._uploaded_file_ids)
            try:
                if self._uploaded_file_ids:
                    self._cleanup_files(self._uploaded_file_ids)
            except Exception:
                logger.exception("Failed to queue draft upload cleanup, upload_file_ids=%s", self._uploaded_file_ids)
            raise

    @staticmethod
    def _should_variable_be_editable(node_id: str, name: str) -> bool:
        if node_id in (CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID):
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    @staticmethod
    def _should_variable_be_visible(node_id: str, node_type: NodeType, name: str) -> bool:
        if node_type == BuiltinNodeTypes.IF_ELSE:
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    def _should_variable_be_saved(self, name: str) -> bool:
        exclude_var_names = self._EXCLUDE_VARIABLE_NAMES_MAPPING.get(self._node_type)
        if exclude_var_names is None:
            return True
        return name not in exclude_var_names
