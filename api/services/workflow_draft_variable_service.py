import dataclasses
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import orm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.file.constants import is_dummy_output_variable
from core.variables import Segment
from core.variables.consts import MIN_SELECTORS_LENGTH
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes import NodeType
from factories import variable_factory
from models.workflow import WorkflowDraftVariable, is_system_variable_editable


@dataclasses.dataclass(frozen=True)
class WorkflowDraftVariableList:
    variables: list[WorkflowDraftVariable]
    total: int | None = None


class WorkflowDraftVariableService:
    _session: Session

    def __init__(self, session: Session) -> None:
        self._session = session

    def get_variable(self, variable_id: str) -> WorkflowDraftVariable | None:
        return self._session.query(WorkflowDraftVariable).filter(WorkflowDraftVariable.id == variable_id).first()

    def save_output_variables(self, app_id: str, node_id: str, node_type: NodeType, output: Mapping[str, Any]):
        variable_builder = _DraftVariableBuilder(app_id=app_id)
        variable_builder.build(node_id=node_id, node_type=node_type, output=output)
        draft_variables = variable_builder.get_variables()
        # draft_variables = _build_variables_from_output_mapping(app_id, node_id, node_type, output)
        if not draft_variables:
            return

        # We may use SQLAlchemy ORM operation here. However, considering the fact that:
        #
        # 1. The variable saving process writes multiple rows into one table (`workflow_draft_variables`).
        #   Use batch insertion may increase performance dramatically.
        # 2. If we use ORM operation, we need to either:
        #
        #     a. Check the existence for each variable before insertion.
        #     b. Try insertion first, then do update if insertion fails due to unique index violation.
        #
        #   Neither of the above is satisfactory.
        #
        #   - For implementation "a", we need to issue `2n` sqls for `n` variables in output.
        #     Besides, it's still suffer from concurrency issues.
        #   - For implementation "b", we need to issue `n` - `2n` sqls (depending on the existence of
        #     specific variable), which is lesser than plan "a" but still far from ideal.
        #
        # 3. We do not need the value of SQL execution, nor do we need populate those values back to ORM model
        #    instances.
        # 4. Batch insertion can be combined with `ON CONFLICT DO UPDATE`, allows us to insert or update
        #    all variables in one SQL statement, and avoid all problems above.
        #
        # Given reasons above, we use query builder instead of using ORM layer,
        # and rely on dialect specific insert operations.
        if node_type == NodeType.CODE:
            # Clear existing variable for code node.
            self._session.query(WorkflowDraftVariable).filter(
                WorkflowDraftVariable.app_id == app_id,
                WorkflowDraftVariable.node_id == node_id,
            ).delete(synchronize_session=False)
        stmt = insert(WorkflowDraftVariable).values([_model_to_insertion_dict(v) for v in draft_variables])
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
        self._session.execute(stmt)

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


def should_save_output_variables_for_draft(
    invoke_from: InvokeFrom, loop_id: str | None, iteration_id: str | None
) -> bool:
    # Only save output variables for debugging execution of workflow.
    if invoke_from != InvokeFrom.DEBUGGER:
        return False

    # Currently we do not save output variables for nodes inside loop or iteration.
    if loop_id is not None:
        return False
    if iteration_id is not None:
        return False
    return True


# def should_save_output_variables_for_draft(invoke_from: InvokeFrom, node_exec: WorkflowNodeExecution) -> bool:
#     # Only save output variables for debugging execution of workflow.
#     if invoke_from != InvokeFrom.DEBUGGER:
#         return False
#     exec_metadata = node_exec.execution_metadata_dict
#     if exec_metadata is None:
#         # No execution metadata, assume the node is not in loop or iteration.
#         return True
#
#     # Currently we do not save output variables for nodes inside loop or iteration.
#     loop_id = exec_metadata.get(NodeRunMetadataKey.LOOP_ID)
#     if loop_id is not None:
#         return False
#     iteration_id = exec_metadata.get(NodeRunMetadataKey.ITERATION_ID)
#     if iteration_id is not None:
#         return False
#     return True
#


class _DraftVariableBuilder:
    _app_id: str
    _draft_vars: list[WorkflowDraftVariable]

    def __init__(self, app_id: str):
        self._app_id = app_id
        self._draft_vars: list[WorkflowDraftVariable] = []

    def _build_from_variable_assigner_mapping(self, node_id: str, output: Mapping[str, Any]):
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
            self._draft_vars.append(
                WorkflowDraftVariable.new_conversation_variable(
                    app_id=self._app_id,
                    name=name,
                    value=var_seg,
                )
            )

    def _build_variables_from_start_mapping(
        self,
        node_id: str,
        output: Mapping[str, Any],
    ):
        original_node_id = node_id
        for name, value in output.items():
            value_seg = variable_factory.build_segment(value)
            if is_dummy_output_variable(name):
                self._draft_vars.append(
                    WorkflowDraftVariable.new_node_variable(
                        app_id=self._app_id,
                        node_id=original_node_id,
                        name=name,
                        value=value_seg,
                        visible=False,
                        editable=False,
                    )
                )
            else:
                self._draft_vars.append(
                    WorkflowDraftVariable.new_sys_variable(
                        app_id=self._app_id,
                        name=name,
                        value=value_seg,
                        editable=self._should_variable_be_editable(node_id, name),
                    )
                )

    def _build_variables_from_mapping(
        self,
        node_id: str,
        node_type: NodeType,
        output: Mapping[str, Any],
    ):
        for name, value in output.items():
            value_seg = variable_factory.build_segment(value)
            self._draft_vars.append(
                WorkflowDraftVariable.new_node_variable(
                    app_id=self._app_id,
                    node_id=node_id,
                    name=name,
                    value=value_seg,
                    visible=self._should_variable_be_visible(node_type, node_id, name),
                )
            )

    def build(
        self,
        node_id: str,
        node_type: NodeType,
        output: Mapping[str, Any],
    ):
        if node_type == NodeType.VARIABLE_ASSIGNER:
            self._build_from_variable_assigner_mapping(node_id, output)
        elif node_type == NodeType.START:
            self._build_variables_from_start_mapping(node_id, output)
        else:
            self._build_variables_from_mapping(node_id, node_type, output)

    def get_variables(self) -> Sequence[WorkflowDraftVariable]:
        return self._draft_vars

    @staticmethod
    def _should_variable_be_editable(node_id: str, name: str) -> bool:
        if node_id in (CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID):
            return False
        if node_id == SYSTEM_VARIABLE_NODE_ID and not is_system_variable_editable(name):
            return False
        return True

    @staticmethod
    def _should_variable_be_visible(node_type: NodeType, node_id: str, name: str) -> bool:
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
