import dataclasses
import datetime
import logging
from collections.abc import Mapping, Sequence
from typing import Any, ClassVar

from sqlalchemy import Engine, orm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from sqlalchemy.sql.expression import and_, or_

from core.app.entities.app_invoke_entities import InvokeFrom
from core.variables import Segment, StringSegment, Variable
from core.variables.consts import MIN_SELECTORS_LENGTH
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes import NodeType
from core.workflow.variable_loader import VariableLoader
from factories import variable_factory
from factories.variable_factory import build_segment, segment_to_variable
from models import App, Conversation
from models.workflow import Workflow, WorkflowDraftVariable, is_system_variable_editable

_logger = logging.getLogger(__name__)


@dataclasses.dataclass(frozen=True)
class WorkflowDraftVariableList:
    variables: list[WorkflowDraftVariable]
    total: int | None = None


class DraftVarLoader(VariableLoader):
    # This implements the VariableLoader interface for loading draft variables.
    #
    # ref: core.workflow.variable_loader.VariableLoader

    # Database engine used for loading variables.
    _engine: Engine
    # Application ID for which variables are being loaded.
    _app_id: str
    _fallback_variables: Sequence[Variable]

    def __init__(
        self,
        engine: Engine,
        app_id: str,
        fallback_variables: Sequence[Variable] | None = None,
    ) -> None:
        self._engine = engine
        self._app_id = app_id
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

        for draft_var in draft_vars:
            segment = build_segment(
                draft_var.value,
            )
            variable = segment_to_variable(
                segment=segment,
                selector=draft_var.get_selector(),
                id=draft_var.id,
                name=draft_var.name,
                description=draft_var.description,
            )
            selector_tuple = self._selector_to_tuple(variable.selector)
            variable_by_selector[selector_tuple] = variable

        # If a conversation variable is referenced but not present in the draft variables table,
        # fall back to returning the variable with its default value.

        fallback_var_by_selector = {}
        for variable in self._fallback_variables:
            selector_tuple = self._selector_to_tuple(variable.selector)
            fallback_var_by_selector[selector_tuple] = variable

        for selector in selectors:
            selector_tuple = self._selector_to_tuple(selector)
            if selector_tuple in variable_by_selector:
                continue
            if selector_tuple in fallback_var_by_selector:
                variable_by_selector[selector_tuple] = fallback_var_by_selector[selector_tuple]

        return list(variable_by_selector.values())


class WorkflowDraftVariableService:
    _session: Session

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_variable(self, variable_id: str) -> WorkflowDraftVariable | None:
        return self._session.query(WorkflowDraftVariable).filter(WorkflowDraftVariable.id == variable_id).first()

    def get_draft_variables_by_selectors(
        self,
        app_id: str,
        selectors: Sequence[list[str]],
    ) -> list[WorkflowDraftVariable]:
        ors = []
        for selector in selectors:
            node_id, name = selector
            ors.append(and_(WorkflowDraftVariable.node_id == node_id, WorkflowDraftVariable.name == name))

        # NOTE(QuantumGhost): Although the number of `or` expressions may be large, as long as
        # each expression includes conditions on both `node_id` and `name` (which are covered by the unique index),
        # PostgreSQL can efficiently retrieve the results using a bitmap index scan.
        #
        # Alternatively, a `SELECT` statement could be constructed for each selector and
        # combined using `UNION` to fetch all rows.
        # Benchmarking indicates that both approaches yield comparable performance.
        variables = (
            self._session.query(WorkflowDraftVariable).where(WorkflowDraftVariable.app_id == app_id, or_(*ors)).all()
        )
        return variables

    def list_variables_without_values(self, app_id: str, page: int, limit: int) -> WorkflowDraftVariableList:
        criteria = WorkflowDraftVariable.app_id == app_id
        total = None
        query = self._session.query(WorkflowDraftVariable).filter(criteria)
        if page == 1:
            total = query.count()
        variables = (
            # Do not load the `value` field.
            query.options(orm.defer(WorkflowDraftVariable.value))
            .order_by(WorkflowDraftVariable.id.desc())
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
        query = self._session.query(WorkflowDraftVariable).filter(*criteria)
        variables = query.order_by(WorkflowDraftVariable.id.desc()).all()
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
        if name is not None:
            variable.set_name(name)
        if value is not None:
            variable.set_value(value)
        variable.last_edited_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        self._session.flush()
        return variable

    def delete_variable(self, variable: WorkflowDraftVariable):
        self._session.delete(variable)

    def delete_workflow_variables(self, app_id: str):
        (
            self._session.query(WorkflowDraftVariable)
            .filter(WorkflowDraftVariable.app_id == app_id)
            .delete(synchronize_session=False)
        )

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
            _logger.warning(
                "sys.conversation_id variable is not a string: app_id=%s, id=%s",
                app_id,
                draft_var.id,
            )
            return None
        return segment.value

    def create_conversation_and_set_conversation_variables(
        self,
        account_id: str,
        app: App,
        workflow: Workflow,
    ) -> str:
        conv_id = self._get_conversation_id_from_draft_variable(workflow.app_id)

        if conv_id is not None:
            conversation = (
                self._session.query(Conversation)
                .filter(
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
            invoke_from=InvokeFrom.DEBUGGER.value,
            from_source="console",
            from_end_user_id=None,
            from_account_id=account_id,
        )

        self._session.add(conversation)
        self._session.flush()
        draft_conv_vars: list[WorkflowDraftVariable] = []
        for conv_var in workflow.conversation_variables:
            draft_var = WorkflowDraftVariable.new_conversation_variable(
                app_id=workflow.app_id,
                name=conv_var.name,
                value=conv_var,
                description=conv_var.description,
            )
            draft_conv_vars.append(draft_var)

        _batch_upsert_draft_varaible(self._session, draft_conv_vars)
        return conversation.id


def _batch_upsert_draft_varaible(session: Session, draft_vars: Sequence[WorkflowDraftVariable]):
    if not draft_vars:
        return
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
    stmt = stmt.on_conflict_do_update(
        index_elements=WorkflowDraftVariable.unique_app_id_node_id_name(),
        set_={
            "updated_at": stmt.excluded.updated_at,
            "last_edited_at": stmt.excluded.last_edited_at,
            "description": stmt.excluded.description,
            "value_type": stmt.excluded.value_type,
            "value": stmt.excluded.value,
            "visible": stmt.excluded.visible,
            "editable": stmt.excluded.editable,
        },
    )
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


class DraftVariableSaver:
    # _DUMMY_OUTPUT_IDENTITY is a placeholder output for workflow nodes.
    # Its sole possible value is `None`.
    #
    # This is used to signal the execution of a workflow node when it has no other outputs.
    _DUMMY_OUTPUT_IDENTITY: ClassVar[str] = "__dummy__"
    _DUMMY_OUTPUT_VALUE: ClassVar[None] = None

    # Database session used for persisting draft variables.
    _session: Session

    # The application ID associated with the draft variables.
    # This should match the `Workflow.app_id` of the workflow to which the current node belongs.
    _app_id: str

    # The ID of the node for which DraftVariableSaver is saving output variables.
    _node_id: str

    # The type of the current node (see NodeType).
    _node_type: NodeType

    # Indicates how the workflow execution was triggered (see InvokeFrom).
    _invoke_from: InvokeFrom

    # _enclosing_node_id identifies the container node that the current node belongs to.
    # For example, if the current node is an LLM node inside an Iteration node
    # or Loop node, then `_enclosing_node_id` refers to the ID of
    # the containing Iteration or Loop node.
    #
    # If the current node is not nested within another node, `_enclosing_node_id` is
    # `None`.
    _enclosing_node_id: str | None

    # pending variables to save.
    _draft_vars: list[WorkflowDraftVariable]

    def __init__(
        self,
        session: Session,
        app_id: str,
        node_id: str,
        node_type: NodeType,
        invoke_from: InvokeFrom,
        enclosing_node_id: str | None = None,
    ):
        self._session = session
        self._app_id = app_id
        self._node_id = node_id
        self._node_type = node_type
        self._invoke_from = invoke_from
        self._enclosing_node_id = enclosing_node_id

    def _should_save_output_variables_for_draft(self) -> bool:
        # Only save output variables for debugging execution of workflow.
        if self._invoke_from != InvokeFrom.DEBUGGER:
            return False
        if self._enclosing_node_id is not None and self._node_type != NodeType.VARIABLE_ASSIGNER:
            # Currently we do not save output variables for nodes inside loop or iteration.
            return False
        return True

    def _build_from_variable_assigner_mapping(self, output: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars: list[WorkflowDraftVariable] = []
        updated_variables = output.get("updated_variables", [])
        for item in updated_variables:
            selector = item.get("selector")
            if selector is None:
                continue
            if len(selector) < MIN_SELECTORS_LENGTH:
                raise Exception("selector too short")
            # NOTE(QuantumGhost): only the following two kinds of variable could be updated by
            # VariableAssigner: ConversationVariable and iteration variable.
            # We only save conversation variable here.
            if selector[0] != CONVERSATION_VARIABLE_NODE_ID:
                continue
            name = item.get("name")
            if name is None:
                continue
            new_value = item["new_value"]
            value_type = item.get("type")
            if value_type is None:
                continue
            var_seg = variable_factory.build_segment(new_value)
            if var_seg.value_type != value_type:
                raise Exception("value_type mismatch!")
            draft_vars.append(
                WorkflowDraftVariable.new_conversation_variable(
                    app_id=self._app_id,
                    name=name,
                    value=var_seg,
                )
            )
        return draft_vars

    def _build_variables_from_start_mapping(self, output: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars = []
        has_non_sys_variables = False
        for name, value in output.items():
            value_seg = variable_factory.build_segment(value)
            node_id, name = self._normalize_variable_for_start_node(name)
            # If node_id is not `sys`, it means that the variable is a user-defined input field
            # in `Start` node.
            if node_id != SYSTEM_VARIABLE_NODE_ID:
                draft_vars.append(
                    WorkflowDraftVariable.new_node_variable(
                        app_id=self._app_id,
                        node_id=self._node_id,
                        name=name,
                        value=value_seg,
                        visible=True,
                        editable=True,
                    )
                )
                has_non_sys_variables = True
            else:
                draft_vars.append(
                    WorkflowDraftVariable.new_sys_variable(
                        app_id=self._app_id,
                        name=name,
                        value=value_seg,
                        editable=self._should_variable_be_editable(node_id, name),
                    )
                )
        if not has_non_sys_variables:
            draft_vars.append(
                WorkflowDraftVariable.new_node_variable(
                    app_id=self._app_id,
                    node_id=self._node_id,
                    name=self._DUMMY_OUTPUT_IDENTITY,
                    value=build_segment(self._DUMMY_OUTPUT_VALUE),
                    visible=False,
                    editable=False,
                )
            )
        return draft_vars

    def _normalize_variable_for_start_node(self, name: str) -> tuple[str, str]:
        if not name.startswith(f"{SYSTEM_VARIABLE_NODE_ID}."):
            return self._node_id, name
        _, name_ = name.split(".", maxsplit=1)
        return SYSTEM_VARIABLE_NODE_ID, name_

    def _build_variables_from_mapping(self, output: Mapping[str, Any]) -> list[WorkflowDraftVariable]:
        draft_vars = []
        for name, value in output.items():
            value_seg = variable_factory.build_segment(value)
            draft_vars.append(
                WorkflowDraftVariable.new_node_variable(
                    app_id=self._app_id,
                    node_id=self._node_id,
                    name=name,
                    value=value_seg,
                    visible=self._should_variable_be_visible(self._node_id, self._node_type, name),
                )
            )
        return draft_vars

    def save(self, output: Mapping[str, Any] | None):
        draft_vars: list[WorkflowDraftVariable] = []
        if output is None:
            output = {}
        if not self._should_save_output_variables_for_draft():
            return
        if self._node_type == NodeType.VARIABLE_ASSIGNER:
            draft_vars = self._build_from_variable_assigner_mapping(output)
        elif self._node_type == NodeType.START:
            draft_vars = self._build_variables_from_start_mapping(output)
        elif self._node_type == NodeType.LOOP:
            # Do not save output variables for loop node.
            # (since the loop variables are inaccessible outside the loop node.)
            return
        else:
            draft_vars = self._build_variables_from_mapping(output)
        _batch_upsert_draft_varaible(self._session, draft_vars)

    @staticmethod
    def _should_variable_be_editable(node_id: str, name: str) -> bool:
        if node_id in (CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID):
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    @staticmethod
    def _should_variable_be_visible(node_id: str, node_type: NodeType, name: str) -> bool:
        if node_type in (NodeType.IF_ELSE, NodeType.START):
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    # @staticmethod
    # def _normalize_variable(node_type: NodeType, node_id: str, name: str) -> tuple[str, str]:
    #     if node_type != NodeType.START:
    #         return node_id, name
    #
    #     # TODO(QuantumGhost): need special handling for dummy output variable in
    #     # `Start` node.
    #     if not name.startswith(f"{SYSTEM_VARIABLE_NODE_ID}."):
    #         return node_id, name
    #     logging.getLogger(__name__).info(
    #         "Normalizing variable: node_type=%s, node_id=%s, name=%s",
    #         node_type,
    #         node_id,
    #         name,
    #     )
    #     node_id, name_ = name.split(".", maxsplit=1)
    #     return node_id, name_
