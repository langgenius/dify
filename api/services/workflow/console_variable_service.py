"""Draft-variable use cases shared by App, Pipeline and Snippet consoles."""

from __future__ import annotations

import json
from collections.abc import Sequence, Set
from typing import TYPE_CHECKING, Any, Protocol

from core.workflow.llm_environment_variable import LLMEnvironmentVariable, environment_variable_value_type
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from factories import variable_factory
from graphon.file import File
from graphon.variables import Segment, SegmentType, VariableBase
from machinery.context import RequestContext
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.workflow.contracts import DraftWorkflowMissingError, WorkflowOwner, WorkflowSnapshot
from services.workflow.environment_variable_service import environment_patch_is_mergeable, prepare_environment_variables
from services.workflow.variable_contracts import (
    ConsoleVariableList,
    DraftVariableContext,
    DraftVariableFileInfo,
    DraftVariableNotFoundError,
    DraftVariableOwnerNotFoundError,
    DraftVariableView,
    InvalidDraftVariableError,
    WorkflowDraftVariableList,
)

if TYPE_CHECKING:
    from models.workflow import Workflow, WorkflowDraftVariable

_SPECIAL_NODES = frozenset({CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID})


class ConsoleVariableDefinitions(Protocol):
    def variable_context(
        self, context: RequestContext, owner: WorkflowOwner, *, include_draft: bool
    ) -> DraftVariableContext: ...

    def update_draft_variables(
        self,
        context: RequestContext,
        app_id: str,
        *,
        expected: WorkflowSnapshot,
        environment_variables: str | None,
        conversation_variables: Sequence[VariableBase] | None,
    ) -> None: ...


class VariableFileInputs(Protocol):
    def build(self, *, tenant_id: str, mapping: dict[str, Any]) -> File: ...
    def restore(self, *, tenant_id: str, mapping: dict[str, Any]) -> File: ...


class ConsoleVariableOperations(Protocol):
    def get_variable(self, variable_id: str, *, app_id: str, user_id: str) -> WorkflowDraftVariable | None: ...
    def list_variables_without_values(
        self, app_id: str, page: int, limit: int, user_id: str, *, exclude_node_ids: Set[str] | None
    ) -> WorkflowDraftVariableList: ...
    def list_node_variables(self, app_id: str, node_id: str, user_id: str) -> WorkflowDraftVariableList: ...
    def list_conversation_variables(self, app_id: str, user_id: str) -> WorkflowDraftVariableList: ...
    def list_system_variables(self, app_id: str, user_id: str) -> WorkflowDraftVariableList: ...
    def update_variable(
        self, variable: WorkflowDraftVariable, name: str | None = None, value: Segment | None = None
    ) -> WorkflowDraftVariable: ...
    def delete_user_workflow_variables(self, app_id: str, user_id: str) -> None: ...
    def delete_node_variables(self, app_id: str, node_id: str, user_id: str) -> None: ...
    def delete_variable(self, variable: WorkflowDraftVariable) -> None: ...
    def reset_variable(self, workflow: Workflow, variable: WorkflowDraftVariable) -> WorkflowDraftVariable | None: ...
    def prefill_conversation_variable_default_values(self, workflow: Workflow, user_id: str) -> None: ...


class ConsoleWorkflowVariableService:
    def __init__(
        self,
        *,
        definitions: ConsoleVariableDefinitions,
        variables: ConsoleVariableOperations,
        files: VariableFileInputs,
    ) -> None:
        self._definitions = definitions
        self._variables = variables
        self._files = files

    def _context(self, context: RequestContext, owner: WorkflowOwner, *, include_draft: bool = False):
        source = self._definitions.variable_context(context, owner, include_draft=include_draft)
        if owner.kind == "app" and source.mode not in {"workflow", "advanced-chat"}:
            raise DraftVariableOwnerNotFoundError(owner.kind)
        return source

    def _draft(self, context: RequestContext, owner: WorkflowOwner):
        source = self._context(context, owner, include_draft=True)
        if source.workflow is None:
            raise DraftWorkflowMissingError("No draft workflow found.")
        return source.workflow

    @staticmethod
    def _node(node_id: str) -> None:
        if node_id in _SPECIAL_NODES:
            raise InvalidDraftVariableError(
                f"invalid node_id, please use correspond api for conversation and system variables, node_id={node_id}"
            )

    def _variable(self, context: RequestContext, owner: WorkflowOwner, variable_id: str):
        variable = self._variables.get_variable(variable_id, app_id=owner.id, user_id=context.account_id)
        if variable is None or (owner.kind == "snippet" and variable.node_id in _SPECIAL_NODES):
            raise DraftVariableNotFoundError(f"variable not found, id={variable_id}")
        return variable

    def _view(self, context: RequestContext, variable: WorkflowDraftVariable, *, include_value: bool = True):
        value = None
        metadata = None
        if include_value:
            raw = json.loads(variable.value)
            if variable.value_type == SegmentType.FILE:
                raw = self._files.restore(tenant_id=context.active_workspace_id, mapping=raw)
            elif variable.value_type == SegmentType.ARRAY_FILE:
                raw = [self._files.restore(tenant_id=context.active_workspace_id, mapping=item) for item in raw]
            value = variable_factory.build_segment_with_type(variable.value_type, raw)
            if variable.is_truncated():
                file = variable.variable_file
                assert file is not None
                metadata = DraftVariableFileInfo(
                    file.upload_file_id, file.size, str(file.value_type.exposed_type()), file.length
                )
        return DraftVariableView(
            id=variable.id,
            type=str(variable.get_variable_type()),
            name=variable.name,
            description=variable.description,
            selector=variable.get_selector(),
            value_type=str(variable.value_type.exposed_type()),
            edited=variable.edited,
            visible=variable.visible,
            is_truncated=variable.is_truncated(),
            value=value,
            full_content=metadata,
        )

    def _list(self, context: RequestContext, variables: WorkflowDraftVariableList, *, include_value: bool = True):
        return ConsoleVariableList(
            [self._view(context, variable, include_value=include_value) for variable in variables.variables],
            variables.total,
        )

    def list_variables(self, context: RequestContext, owner: WorkflowOwner, *, page: int, limit: int):
        self._draft(context, owner)
        return self._list(
            context,
            self._variables.list_variables_without_values(
                owner.id,
                page,
                limit,
                context.account_id,
                exclude_node_ids=_SPECIAL_NODES if owner.kind == "snippet" else None,
            ),
            include_value=False,
        )

    def delete_all(self, context: RequestContext, owner: WorkflowOwner) -> None:
        self._context(context, owner)
        self._variables.delete_user_workflow_variables(owner.id, context.account_id)

    def node(self, context: RequestContext, owner: WorkflowOwner, node_id: str):
        self._context(context, owner)
        self._node(node_id)
        return self._list(context, self._variables.list_node_variables(owner.id, node_id, context.account_id))

    def delete_node(self, context: RequestContext, owner: WorkflowOwner, node_id: str) -> None:
        self._context(context, owner)
        self._node(node_id)
        self._variables.delete_node_variables(owner.id, node_id, context.account_id)

    def get(self, context: RequestContext, owner: WorkflowOwner, variable_id: str):
        self._context(context, owner)
        return self._view(context, self._variable(context, owner, variable_id))

    def patch(self, context: RequestContext, owner: WorkflowOwner, variable_id: str, *, name: str | None, value: Any):
        self._context(context, owner)
        variable = self._variable(context, owner, variable_id)
        if name is None and value is None:
            return self._view(context, variable)
        new_value = None
        if value is not None:
            if variable.value_type == SegmentType.FILE:
                if not isinstance(value, dict):
                    raise InvalidDraftVariableError(f"expected dict for file, got {type(value)}")
                value = self._files.build(tenant_id=context.active_workspace_id, mapping=value)
            elif variable.value_type == SegmentType.ARRAY_FILE:
                if not isinstance(value, list):
                    raise InvalidDraftVariableError(f"expected list for files, got {type(value)}")
                if any(not isinstance(item, dict) for item in value):
                    raise InvalidDraftVariableError("expected dict for each file")
                value = [self._files.build(tenant_id=context.active_workspace_id, mapping=item) for item in value]
            new_value = variable_factory.build_segment_with_type(variable.value_type, value)
        return self._view(context, self._variables.update_variable(variable, name=name, value=new_value))

    def delete(self, context: RequestContext, owner: WorkflowOwner, variable_id: str) -> None:
        self._context(context, owner)
        self._variables.delete_variable(self._variable(context, owner, variable_id))

    def reset(self, context: RequestContext, owner: WorkflowOwner, variable_id: str):
        try:
            workflow = self._draft(context, owner)
        except DraftWorkflowMissingError as error:
            raise WorkflowNotFoundError(f"Draft workflow not found, {owner.kind}_id={owner.id}") from error
        variable = self._variable(context, owner, variable_id)
        result = self._variables.reset_variable(workflow, variable)
        return self._view(context, result) if result is not None else None

    def conversation(self, context: RequestContext, owner: WorkflowOwner):
        if owner.kind == "snippet":
            self._context(context, owner)
            return ConsoleVariableList(variables=[])
        try:
            workflow = self._draft(context, owner)
        except DraftWorkflowMissingError as error:
            raise WorkflowNotFoundError(f"draft workflow not found, id={owner.id}") from error
        self._variables.prefill_conversation_variable_default_values(workflow, context.account_id)
        return self._list(context, self._variables.list_conversation_variables(owner.id, context.account_id))

    def system(self, context: RequestContext, owner: WorkflowOwner):
        self._context(context, owner)
        if owner.kind == "snippet":
            return ConsoleVariableList(variables=[])
        return self._list(context, self._variables.list_system_variables(owner.id, context.account_id))

    def environment(self, context: RequestContext, owner: WorkflowOwner) -> list[dict[str, Any]]:
        workflow = self._draft(context, owner)
        return [
            {
                "id": variable.id,
                "type": "env",
                "name": variable.name,
                "description": variable.description,
                "selector": variable.selector,
                "value_type": (
                    str(variable.value_type)
                    if owner.kind == "pipeline" and not isinstance(variable, LLMEnvironmentVariable)
                    else environment_variable_value_type(variable)
                ),
                "value": variable.value,
                "edited": False,
                "visible": True,
                "editable": True,
            }
            for variable in workflow.environment_variables
        ]

    def update_conversation(self, context: RequestContext, app_id: str, values: Sequence[dict[str, Any]]) -> None:
        source = self._context(context, WorkflowOwner(app_id), include_draft=True)
        if source.mode != "advanced-chat":
            raise DraftVariableOwnerNotFoundError("app")
        if source.snapshot is None:
            raise DraftWorkflowMissingError("No draft workflow found.")
        self._definitions.update_draft_variables(
            context,
            app_id,
            expected=source.snapshot,
            environment_variables=None,
            conversation_variables=[
                variable_factory.build_conversation_variable_from_mapping(value) for value in values
            ],
        )

    def update_environment(
        self,
        context: RequestContext,
        app_id: str,
        values: Sequence[dict[str, Any]],
        *,
        deleted_ids: Sequence[str] | None,
    ) -> None:
        owner = WorkflowOwner(app_id)
        snapshot = self._context(context, owner, include_draft=True).snapshot
        if snapshot is None:
            raise DraftWorkflowMissingError("No draft workflow found.")
        original = snapshot
        variables = [variable_factory.build_environment_variable_from_mapping(value) for value in values]
        for attempt in range(3):
            environment = prepare_environment_variables(
                tenant_id=context.active_workspace_id, source=snapshot, variables=variables, deleted_ids=deleted_ids
            )
            try:
                self._definitions.update_draft_variables(
                    context,
                    app_id,
                    expected=snapshot,
                    environment_variables=environment.value,
                    conversation_variables=None,
                )
                return
            except WorkflowHashNotEqualError:
                if deleted_ids is None or attempt == 2:
                    raise
                current = self._context(context, owner, include_draft=True).snapshot
                if current is None or not environment_patch_is_mergeable(
                    original, current, {variable.id for variable in variables} | set(deleted_ids)
                ):
                    raise
                snapshot = current
