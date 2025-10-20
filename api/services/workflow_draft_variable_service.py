import dataclasses
import json
import logging
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from enum import StrEnum
from typing import Any, ClassVar

from sqlalchemy import Engine, orm, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.expression import and_, or_

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.models import File
from core.variables import Segment, StringSegment, Variable
from core.variables.consts import SELECTORS_LENGTH
from core.variables.segments import (
    ArrayFileSegment,
    FileSegment,
)
from core.variables.types import SegmentType
from core.variables.utils import dumps_with_segments
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes import NodeType
from core.workflow.nodes.variable_assigner.common.helpers import get_updated_variables
from core.workflow.variable_loader import VariableLoader
from extensions.ext_storage import storage
from factories.file_factory import StorageKeyLoader
from factories.variable_factory import build_segment, segment_to_variable
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models import Account, App, Conversation
from models.enums import DraftVariableType
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowDraftVariableFile, is_system_variable_editable
from repositories.factory import DifyAPIRepositoryFactory
from services.file_service import FileService
from services.variable_truncator import VariableTruncator

logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class WorkflowDraftVariableList:
    variables: list[WorkflowDraftVariable]
    total: int | None = None


@dataclasses.dataclass(frozen=True)
class DraftVarFileDeletion:
    draft_var_id: str
    draft_var_file_id: str


class WorkflowDraftVariableError(Exception):
    pass


class VariableResetError(WorkflowDraftVariableError):
    pass


class UpdateNotSupportedError(WorkflowDraftVariableError):
    pass


class DraftVarLoader(VariableLoader):
    # This implements the VariableLoader interface for loading draft variables.
    #
    # ref: core.workflow.variable_loader.VariableLoader

    # Database engine used for loading variables.
    _engine: Engine
    # Application ID for which variables are being loaded.
    _app_id: str
    _tenant_id: str
    _fallback_variables: Sequence[Variable]

    def __init__(
        self,
        engine: Engine,
        app_id: str,
        tenant_id: str,
        fallback_variables: Sequence[Variable] | None = None,
    ):
        self._engine = engine
        self._app_id = app_id
        self._tenant_id = tenant_id
        self._fallback_variables = fallback_variables or []

    def _selector_to_tuple(self, selector: Sequence[str]) -> tuple[str, str]:
        return (selector[0], selector[1])

    def load_variables(self, selectors: list[list[str]]) -> list[Variable]:
        if not selectors:
            return []

        # Map each selector (as a tuple via `_selector_to_tuple`) to its corresponding Variable instance.
        variable_by_selector: dict[tuple[str, str], Variable] = {}

        with Session(bind=self._engine, expire_on_commit=False) as session:
            srv = WorkflowDraftVariableService(session)
            draft_vars = srv.get_draft_variables_by_selectors(self._app_id, selectors)

        # Important:
        files: list[File] = []
        # FileSegment and ArrayFileSegment are not subject to offloading, so their values
        # can be safely accessed before any offloading logic is applied.
        for draft_var in draft_vars:
            value = draft_var.get_value()
            if isinstance(value, FileSegment):
                files.append(value.value)
            elif isinstance(value, ArrayFileSegment):
                files.extend(value.value)
        with Session(bind=self._engine) as session:
            storage_key_loader = StorageKeyLoader(session, tenant_id=self._tenant_id)
            storage_key_loader.load_storage_keys(files)

        offloaded_draft_vars = []
        for draft_var in draft_vars:
            if draft_var.is_truncated():
                offloaded_draft_vars.append(draft_var)
                continue

            segment = draft_var.get_value()
            variable = segment_to_variable(
                segment=segment,
                selector=draft_var.get_selector(),
                id=draft_var.id,
                name=draft_var.name,
                description=draft_var.description,
            )
            selector_tuple = self._selector_to_tuple(variable.selector)
            variable_by_selector[selector_tuple] = variable

        # Load offloaded variables using multithreading.
        # This approach reduces loading time by querying external systems concurrently.
        with ThreadPoolExecutor(max_workers=10) as executor:
            offloaded_variables = executor.map(self._load_offloaded_variable, offloaded_draft_vars)
            for selector, variable in offloaded_variables:
                variable_by_selector[selector] = variable

        return list(variable_by_selector.values())

    def _load_offloaded_variable(self, draft_var: WorkflowDraftVariable) -> tuple[tuple[str, str], Variable]:
        # This logic is closely tied to `WorkflowDraftVaribleService._try_offload_large_variable`
        # and must remain synchronized with it.
        # Ideally, these should be co-located for better maintainability.
        # However, due to the current code structure, this is not straightforward.

        variable_file = draft_var.variable_file
        assert variable_file is not None
        upload_file = variable_file.upload_file
        assert upload_file is not None
        content = storage.load(upload_file.key)
        if variable_file.value_type == SegmentType.STRING:
            # The inferenced type is StringSegment, which is not correct inside this function.
            segment: Segment = StringSegment(value=content.decode())

            variable = segment_to_variable(
                segment=segment,
                selector=draft_var.get_selector(),
                id=draft_var.id,
                name=draft_var.name,
                description=draft_var.description,
            )
            return (draft_var.node_id, draft_var.name), variable

        deserialized = json.loads(content)
        segment = WorkflowDraftVariable.build_segment_with_type(variable_file.value_type, deserialized)
        variable = segment_to_variable(
            segment=segment,
            selector=draft_var.get_selector(),
            id=draft_var.id,
            name=draft_var.name,
            description=draft_var.description,
        )
        # No special handling needed for  ArrayFileSegment, as we do not offload ArrayFileSegment
        return (draft_var.node_id, draft_var.name), variable


class WorkflowDraftVariableService:
    _session: Session

    def __init__(self, session: Session):
        """
        Initialize the WorkflowDraftVariableService with a SQLAlchemy session.

        Args:
            session (Session): The SQLAlchemy session used to execute database queries.
            The provided session must be bound to an `Engine` object, not a specific `Connection`.

        Raises:
            AssertionError: If the provided session is not bound to an `Engine` object.
        """
        self._session = session
        engine = session.get_bind()
        # Ensure the session is bound to a engine.
        assert isinstance(engine, Engine)
        session_maker = sessionmaker(bind=engine, expire_on_commit=False)
        self._api_node_execution_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )

    def get_variable(self, variable_id: str) -> WorkflowDraftVariable | None:
        return (
            self._session.query(WorkflowDraftVariable)
            .options(orm.selectinload(WorkflowDraftVariable.variable_file))
            .where(WorkflowDraftVariable.id == variable_id)
            .first()
        )

    def get_draft_variables_by_selectors(
        self,
        app_id: str,
        selectors: Sequence[list[str]],
    ) -> list[WorkflowDraftVariable]:
        """
        Retrieve WorkflowDraftVariable instances based on app_id and selectors.

        The returned WorkflowDraftVariable objects are guaranteed to have their
        associated variable_file and variable_file.upload_file relationships preloaded.
        """
        ors = []
        for selector in selectors:
            assert len(selector) >= SELECTORS_LENGTH, f"Invalid selector to get: {selector}"
            node_id, name = selector[:2]
            ors.append(and_(WorkflowDraftVariable.node_id == node_id, WorkflowDraftVariable.name == name))

        # NOTE(QuantumGhost): Although the number of `or` expressions may be large, as long as
        # each expression includes conditions on both `node_id` and `name` (which are covered by the unique index),
        # PostgreSQL can efficiently retrieve the results using a bitmap index scan.
        #
        # Alternatively, a `SELECT` statement could be constructed for each selector and
        # combined using `UNION` to fetch all rows.
        # Benchmarking indicates that both approaches yield comparable performance.
        variables = (
            self._session.query(WorkflowDraftVariable)
            .options(
                orm.selectinload(WorkflowDraftVariable.variable_file).selectinload(
                    WorkflowDraftVariableFile.upload_file
                )
            )
            .where(WorkflowDraftVariable.app_id == app_id, or_(*ors))
            .all()
        )
        return variables

    def list_variables_without_values(self, app_id: str, page: int, limit: int) -> WorkflowDraftVariableList:
        criteria = WorkflowDraftVariable.app_id == app_id
        total = None
        query = self._session.query(WorkflowDraftVariable).where(criteria)
        if page == 1:
            total = query.count()
        variables = (
            # Do not load the `value` field
            query.options(
                orm.defer(WorkflowDraftVariable.value, raiseload=True),
            )
            .order_by(WorkflowDraftVariable.created_at.desc())
            .limit(limit)
            .offset((page - 1) * limit)
            .all()
        )

        return WorkflowDraftVariableList(variables=variables, total=total)

    def _list_node_variables(self, app_id: str, node_id: str) -> WorkflowDraftVariableList:
        criteria = (
            WorkflowDraftVariable.app_id == app_id,
            WorkflowDraftVariable.node_id == node_id,
        )
        query = self._session.query(WorkflowDraftVariable).where(*criteria)
        variables = (
            query.options(orm.selectinload(WorkflowDraftVariable.variable_file))
            .order_by(WorkflowDraftVariable.created_at.desc())
            .all()
        )
        return WorkflowDraftVariableList(variables=variables)

    def list_node_variables(self, app_id: str, node_id: str) -> WorkflowDraftVariableList:
        return self._list_node_variables(app_id, node_id)

    def list_conversation_variables(self, app_id: str) -> WorkflowDraftVariableList:
        return self._list_node_variables(app_id, CONVERSATION_VARIABLE_NODE_ID)

    def list_system_variables(self, app_id: str) -> WorkflowDraftVariableList:
        return self._list_node_variables(app_id, SYSTEM_VARIABLE_NODE_ID)

    def get_conversation_variable(self, app_id: str, name: str) -> WorkflowDraftVariable | None:
        return self._get_variable(app_id=app_id, node_id=CONVERSATION_VARIABLE_NODE_ID, name=name)

    def get_system_variable(self, app_id: str, name: str) -> WorkflowDraftVariable | None:
        return self._get_variable(app_id=app_id, node_id=SYSTEM_VARIABLE_NODE_ID, name=name)

    def get_node_variable(self, app_id: str, node_id: str, name: str) -> WorkflowDraftVariable | None:
        return self._get_variable(app_id, node_id, name)

    def _get_variable(self, app_id: str, node_id: str, name: str) -> WorkflowDraftVariable | None:
        variable = (
            self._session.query(WorkflowDraftVariable)
            .options(orm.selectinload(WorkflowDraftVariable.variable_file))
            .where(
                WorkflowDraftVariable.app_id == app_id,
                WorkflowDraftVariable.node_id == node_id,
                WorkflowDraftVariable.name == name,
            )
            .first()
        )
        return variable

    def update_variable(
        self,
        variable: WorkflowDraftVariable,
        name: str | None = None,
        value: Segment | None = None,
    ) -> WorkflowDraftVariable:
        if not variable.editable:
            raise UpdateNotSupportedError(f"variable not support updating, id={variable.id}")
        if name is not None:
            variable.set_name(name)
        if value is not None:
            variable.set_value(value)
        variable.last_edited_at = naive_utc_now()
        self._session.flush()
        return variable

    def _reset_conv_var(self, workflow: Workflow, variable: WorkflowDraftVariable) -> WorkflowDraftVariable | None:
        conv_var_by_name = {i.name: i for i in workflow.conversation_variables}
        conv_var = conv_var_by_name.get(variable.name)

        if conv_var is None:
            self._session.delete(instance=variable)
            self._session.flush()
            logger.warning(
                "Conversation variable not found for draft variable, id=%s, name=%s", variable.id, variable.name
            )
            return None

        variable.set_value(conv_var)
        variable.last_edited_at = None
        self._session.add(variable)
        self._session.flush()
        return variable

    def _reset_node_var_or_sys_var(
        self, workflow: Workflow, variable: WorkflowDraftVariable
    ) -> WorkflowDraftVariable | None:
        # If a variable does not allow updating, it makes no sense to reset it.
        if not variable.editable:
            return variable
        # No execution record for this variable, delete the variable instead.
        if variable.node_execution_id is None:
            self._session.delete(instance=variable)
            self._session.flush()
            logger.warning("draft variable has no node_execution_id, id=%s, name=%s", variable.id, variable.name)
            return None

        node_exec = self._api_node_execution_repo.get_execution_by_id(variable.node_execution_id)
        if node_exec is None:
            logger.warning(
                "Node exectution not found for draft variable, id=%s, name=%s, node_execution_id=%s",
                variable.id,
                variable.name,
                variable.node_execution_id,
            )
            self._session.delete(instance=variable)
            self._session.flush()
            return None

        outputs_dict = node_exec.load_full_outputs(self._session, storage) or {}
        # a sentinel value used to check the absent of the output variable key.
        absent = object()

        if variable.get_variable_type() == DraftVariableType.NODE:
            # Get node type for proper value extraction
            node_config = workflow.get_node_config_by_id(variable.node_id)
            node_type = workflow.get_node_type_from_node_config(node_config)

            # Note: Based on the implementation in `_build_from_variable_assigner_mapping`,
            # VariableAssignerNode (both v1 and v2) can only create conversation draft variables.
            # For consistency, we should simply return when processing VARIABLE_ASSIGNER nodes.
            #
            # This implementation must remain synchronized with the `_build_from_variable_assigner_mapping`
            # and `save` methods.
            if node_type == NodeType.VARIABLE_ASSIGNER:
                return variable
            output_value = outputs_dict.get(variable.name, absent)
        else:
            output_value = outputs_dict.get(f"sys.{variable.name}", absent)

        # We cannot use `is None` to check the existence of an output variable here as
        # the value of the output may be `None`.
        if output_value is absent:
            # If variable not found in execution data, delete the variable
            self._session.delete(instance=variable)
            self._session.flush()
            return None
        value_seg = WorkflowDraftVariable.build_segment_with_type(variable.value_type, output_value)
        # Extract variable value using unified logic
        variable.set_value(value_seg)
        variable.last_edited_at = None  # Reset to indicate this is a reset operation
        self._session.flush()
        return variable

    def reset_variable(self, workflow: Workflow, variable: WorkflowDraftVariable) -> WorkflowDraftVariable | None:
        variable_type = variable.get_variable_type()
        if variable_type == DraftVariableType.SYS and not is_system_variable_editable(variable.name):
            raise VariableResetError(f"cannot reset system variable, variable_id={variable.id}")
        if variable_type == DraftVariableType.CONVERSATION:
            return self._reset_conv_var(workflow, variable)
        else:
            return self._reset_node_var_or_sys_var(workflow, variable)

    def delete_variable(self, variable: WorkflowDraftVariable):
        if not variable.is_truncated():
            self._session.delete(variable)
            return

        variable_query = (
            select(WorkflowDraftVariable)
            .options(
                orm.selectinload(WorkflowDraftVariable.variable_file).selectinload(
                    WorkflowDraftVariableFile.upload_file
                ),
            )
            .where(WorkflowDraftVariable.id == variable.id)
        )
        variable_reloaded = self._session.execute(variable_query).scalars().first()
        if variable_reloaded is None:
            logger.warning("Associated WorkflowDraftVariable not found, draft_var_id=%s", variable.id)
            self._session.delete(variable)
            return
        variable_file = variable_reloaded.variable_file
        if variable_file is None:
            logger.warning(
                "Associated WorkflowDraftVariableFile not found, draft_var_id=%s, file_id=%s",
                variable_reloaded.id,
                variable_reloaded.file_id,
            )
            self._session.delete(variable)
            return

        upload_file = variable_file.upload_file
        if upload_file is None:
            logger.warning(
                "Associated UploadFile not found, draft_var_id=%s, file_id=%s, upload_file_id=%s",
                variable_reloaded.id,
                variable_reloaded.file_id,
                variable_file.upload_file_id,
            )
            self._session.delete(variable)
            self._session.delete(variable_file)
            return

        storage.delete(upload_file.key)
        self._session.delete(upload_file)
        self._session.delete(upload_file)
        self._session.delete(variable)

    def delete_workflow_variables(self, app_id: str):
        (
            self._session.query(WorkflowDraftVariable)
            .where(WorkflowDraftVariable.app_id == app_id)
            .delete(synchronize_session=False)
        )

    def delete_workflow_draft_variable_file(self, deletions: list[DraftVarFileDeletion]):
        variable_files_query = (
            select(WorkflowDraftVariableFile)
            .options(orm.selectinload(WorkflowDraftVariableFile.upload_file))
            .where(WorkflowDraftVariableFile.id.in_([i.draft_var_file_id for i in deletions]))
        )
        variable_files = self._session.execute(variable_files_query).scalars().all()
        variable_files_by_id = {i.id: i for i in variable_files}
        for i in deletions:
            variable_file = variable_files_by_id.get(i.draft_var_file_id)
            if variable_file is None:
                logger.warning(
                    "Associated WorkflowDraftVariableFile not found, draft_var_id=%s, file_id=%s",
                    i.draft_var_id,
                    i.draft_var_file_id,
                )
                continue

            upload_file = variable_file.upload_file
            if upload_file is None:
                logger.warning(
                    "Associated UploadFile not found, draft_var_id=%s, file_id=%s, upload_file_id=%s",
                    i.draft_var_id,
                    i.draft_var_file_id,
                    variable_file.upload_file_id,
                )
                self._session.delete(variable_file)
            else:
                storage.delete(upload_file.key)
                self._session.delete(upload_file)
                self._session.delete(variable_file)

    def delete_node_variables(self, app_id: str, node_id: str):
        return self._delete_node_variables(app_id, node_id)

    def _delete_node_variables(self, app_id: str, node_id: str):
        self._session.query(WorkflowDraftVariable).where(
            WorkflowDraftVariable.app_id == app_id,
            WorkflowDraftVariable.node_id == node_id,
        ).delete()

    def _get_conversation_id_from_draft_variable(self, app_id: str) -> str | None:
        draft_var = self._get_variable(
            app_id=app_id,
            node_id=SYSTEM_VARIABLE_NODE_ID,
            name=str(SystemVariableKey.CONVERSATION_ID),
        )
        if draft_var is None:
            return None
        segment = draft_var.get_value()
        if not isinstance(segment, StringSegment):
            logger.warning(
                "sys.conversation_id variable is not a string: app_id=%s, id=%s",
                app_id,
                draft_var.id,
            )
            return None
        return segment.value

    def get_or_create_conversation(
        self,
        account_id: str,
        app: App,
        workflow: Workflow,
    ) -> str:
        """
        get_or_create_conversation creates and returns the ID of a conversation for debugging.

        If a conversation already exists, as determined by the following criteria, its ID is returned:
        - The system variable `sys.conversation_id` exists in the draft variable table, and
        - A corresponding conversation record is found in the database.

        If no such conversation exists, a new conversation is created and its ID is returned.
        """
        conv_id = self._get_conversation_id_from_draft_variable(workflow.app_id)

        if conv_id is not None:
            conversation = (
                self._session.query(Conversation)
                .where(
                    Conversation.id == conv_id,
                    Conversation.app_id == workflow.app_id,
                )
                .first()
            )
            # Only return the conversation ID if it exists and is valid (has a correspond conversation record in DB).
            if conversation is not None:
                return conv_id
        conversation = Conversation(
            app_id=workflow.app_id,
            app_model_config_id=app.app_model_config_id,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=app.mode,
            name="Draft Debugging Conversation",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from=InvokeFrom.DEBUGGER,
            from_source="console",
            from_end_user_id=None,
            from_account_id=account_id,
        )

        self._session.add(conversation)
        self._session.flush()
        return conversation.id

    def prefill_conversation_variable_default_values(self, workflow: Workflow):
        """"""
        draft_conv_vars: list[WorkflowDraftVariable] = []
        for conv_var in workflow.conversation_variables:
            draft_var = WorkflowDraftVariable.new_conversation_variable(
                app_id=workflow.app_id,
                name=conv_var.name,
                value=conv_var,
                description=conv_var.description,
            )
            draft_conv_vars.append(draft_var)
        _batch_upsert_draft_variable(
            self._session,
            draft_conv_vars,
            policy=_UpsertPolicy.IGNORE,
        )


class _UpsertPolicy(StrEnum):
    IGNORE = "ignore"
    OVERWRITE = "overwrite"


def _batch_upsert_draft_variable(
    session: Session,
    draft_vars: Sequence[WorkflowDraftVariable],
    policy: _UpsertPolicy = _UpsertPolicy.OVERWRITE,
):
    if not draft_vars:
        return None
    # Although we could use SQLAlchemy ORM operations here, we choose not to for several reasons:
    #
    # 1. The variable saving process involves writing multiple rows to the
    #    `workflow_draft_variables` table. Batch insertion significantly improves performance.
    # 2. Using the ORM would require either:
    #
    #    a. Checking for the existence of each variable before insertion,
    #      resulting in 2n SQL statements for n variables and potential concurrency issues.
    #    b. Attempting insertion first, then updating if a unique index violation occurs,
    #      which still results in n to 2n SQL statements.
    #
    #    Both approaches are inefficient and suboptimal.
    # 3. We do not need to retrieve the results of the SQL execution or populate ORM
    #    model instances with the returned values.
    # 4. Batch insertion with `ON CONFLICT DO UPDATE` allows us to insert or update all
    #    variables in a single SQL statement, avoiding the issues above.
    #
    # For these reasons, we use the SQLAlchemy query builder and rely on dialect-specific
    # insert operations instead of the ORM layer.
    stmt = insert(WorkflowDraftVariable).values([_model_to_insertion_dict(v) for v in draft_vars])
    if policy == _UpsertPolicy.OVERWRITE:
        stmt = stmt.on_conflict_do_update(
            index_elements=WorkflowDraftVariable.unique_app_id_node_id_name(),
            set_={
                # Refresh creation timestamp to ensure updated variables
                # appear first in chronologically sorted result sets.
                "created_at": stmt.excluded.created_at,
                "updated_at": stmt.excluded.updated_at,
                "last_edited_at": stmt.excluded.last_edited_at,
                "description": stmt.excluded.description,
                "value_type": stmt.excluded.value_type,
                "value": stmt.excluded.value,
                "visible": stmt.excluded.visible,
                "editable": stmt.excluded.editable,
                "node_execution_id": stmt.excluded.node_execution_id,
                "file_id": stmt.excluded.file_id,
            },
        )
    elif policy == _UpsertPolicy.IGNORE:
        stmt = stmt.on_conflict_do_nothing(index_elements=WorkflowDraftVariable.unique_app_id_node_id_name())
    else:
        raise Exception("Invalid value for update policy.")
    session.execute(stmt)


def _model_to_insertion_dict(model: WorkflowDraftVariable) -> dict[str, Any]:
    d: dict[str, Any] = {
        "app_id": model.app_id,
        "last_edited_at": None,
        "node_id": model.node_id,
        "name": model.name,
        "selector": model.selector,
        "value_type": model.value_type,
        "value": model.value,
        "node_execution_id": model.node_execution_id,
        "file_id": model.file_id,
    }
    if model.visible is not None:
        d["visible"] = model.visible
    if model.editable is not None:
        d["editable"] = model.editable
    if model.created_at is not None:
        d["created_at"] = model.created_at
    if model.updated_at is not None:
        d["updated_at"] = model.updated_at
    if model.description is not None:
        d["description"] = model.description
    return d


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
        NodeType.LLM: frozenset(["finish_reason"]),
        NodeType.LOOP: frozenset(["loop_round"]),
    }

    # Database session used for persisting draft variables.
    _session: Session

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
        session: Session,
        app_id: str,
        node_id: str,
        node_type: NodeType,
        node_execution_id: str,
        user: Account,
        enclosing_node_id: str | None = None,
    ):
        # Important: `node_execution_id` parameter refers to the primary key (`id`) of the
        # WorkflowNodeExecutionModel/WorkflowNodeExecution, not their `node_execution_id`
        # field. These are distinct database fields with different purposes.
        self._session = session
        self._app_id = app_id
        self._node_id = node_id
        self._node_type = node_type
        self._node_execution_id = node_execution_id
        self._user = user
        self._enclosing_node_id = enclosing_node_id

    def _create_dummy_output_variable(self):
        return WorkflowDraftVariable.new_node_variable(
            app_id=self._app_id,
            node_id=self._node_id,
            name=self._DUMMY_OUTPUT_IDENTITY,
            node_execution_id=self._node_execution_id,
            value=build_segment(self._DUMMY_OUTPUT_VALUE),
            visible=False,
            editable=False,
        )

    def _should_save_output_variables_for_draft(self) -> bool:
        if self._enclosing_node_id is not None and self._node_type != NodeType.VARIABLE_ASSIGNER:
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
            segment = WorkflowDraftVariable.build_segment_with_type(segment_type=item.value_type, value=item.new_value)
            draft_vars.append(
                WorkflowDraftVariable.new_conversation_variable(
                    app_id=self._app_id,
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
            # If node_id is not `sys`, it means that the variable is a user-defined input field
            # in `Start` node.
            if node_id != SYSTEM_VARIABLE_NODE_ID:
                draft_vars.append(
                    WorkflowDraftVariable.new_node_variable(
                        app_id=self._app_id,
                        node_id=self._node_id,
                        name=name,
                        node_execution_id=self._node_execution_id,
                        value=value_seg,
                        visible=True,
                        editable=True,
                    )
                )
                has_non_sys_variables = True
            else:
                if name == SystemVariableKey.FILES:
                    # Here we know the type of variable must be `array[file]`, we
                    # just build files from the value.
                    files = [File.model_validate(v) for v in value]
                    if files:
                        value_seg = WorkflowDraftVariable.build_segment_with_type(SegmentType.ARRAY_FILE, files)
                    else:
                        value_seg = ArrayFileSegment(value=[])

                draft_vars.append(
                    WorkflowDraftVariable.new_sys_variable(
                        app_id=self._app_id,
                        name=name,
                        node_execution_id=self._node_execution_id,
                        value=value_seg,
                        editable=self._should_variable_be_editable(node_id, name),
                    )
                )
        if not has_non_sys_variables:
            draft_vars.append(self._create_dummy_output_variable())
        return draft_vars

    def _normalize_variable_for_start_node(self, name: str) -> tuple[str, str]:
        if not name.startswith(f"{SYSTEM_VARIABLE_NODE_ID}."):
            return self._node_id, name
        _, name_ = name.split(".", maxsplit=1)
        return SYSTEM_VARIABLE_NODE_ID, name_

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
        if isinstance(value_seg, StringSegment):
            # For string types, store as plain text
            original_content_serialized = value_seg.value
            content_type = "text/plain"
            filename = f"{self._generate_filename(name)}.txt"
        else:
            # For other types, store as JSON
            original_content_serialized = dumps_with_segments(value_seg.value, ensure_ascii=False)
            content_type = "application/json"
            filename = f"{self._generate_filename(name)}.json"

        original_size = len(original_content_serialized.encode("utf-8"))

        bind = self._session.get_bind()
        assert isinstance(bind, Engine)
        file_srv = FileService(bind)

        upload_file = file_srv.upload_file(
            filename=filename,
            content=original_content_serialized.encode(),
            mimetype=content_type,
            user=self._user,
        )

        # Create WorkflowDraftVariableFile record
        variable_file = WorkflowDraftVariableFile(
            id=uuidv7(),
            upload_file_id=upload_file.id,
            size=original_size,
            length=original_length,
            value_type=value_seg.value_type,
            app_id=self._app_id,
            tenant_id=self._user.current_tenant_id,
            user_id=self._user.id,
        )
        engine = bind = self._session.get_bind()
        assert isinstance(engine, Engine)
        with Session(bind=engine, expire_on_commit=False) as session:
            session.add(variable_file)
            session.commit()

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
        draft_vars: list[WorkflowDraftVariable] = []
        if outputs is None:
            outputs = {}
        if process_data is None:
            process_data = {}
        if not self._should_save_output_variables_for_draft():
            return
        if self._node_type == NodeType.VARIABLE_ASSIGNER:
            draft_vars = self._build_from_variable_assigner_mapping(process_data=process_data)
        elif self._node_type == NodeType.START:
            draft_vars = self._build_variables_from_start_mapping(outputs)
        else:
            draft_vars = self._build_variables_from_mapping(outputs)
        _batch_upsert_draft_variable(self._session, draft_vars)

    @staticmethod
    def _should_variable_be_editable(node_id: str, name: str) -> bool:
        if node_id in (CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID):
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    @staticmethod
    def _should_variable_be_visible(node_id: str, node_type: NodeType, name: str) -> bool:
        if node_type in NodeType.IF_ELSE:
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    def _should_variable_be_saved(self, name: str) -> bool:
        exclude_var_names = self._EXCLUDE_VARIABLE_NAMES_MAPPING.get(self._node_type)
        if exclude_var_names is None:
            return True
        return name not in exclude_var_names
