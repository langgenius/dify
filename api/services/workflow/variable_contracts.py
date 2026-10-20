"""Shared workflow-variable persistence results."""

import dataclasses
import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.workflow.environment_variables import load_environment_variables
from factories import variable_factory
from graphon.variable_loader import VariableLoader
from graphon.variables import Segment
from graphon.variables.variables import Variable
from models import Account, App
from models.workflow import Workflow, WorkflowDraftVariable, WorkflowNodeExecutionModel
from services.workflow.contracts import WorkflowBindingScope, WorkflowSnapshot


def environment_variable_values(workflow: WorkflowSnapshot) -> Sequence[Variable]:
    return cast(
        Sequence[Variable],
        load_environment_variables(tenant_id=workflow.tenant_id, serialized_variables=workflow.environment_variables),
    )


def conversation_variable_values(workflow: WorkflowSnapshot) -> Sequence[Variable]:
    variables = cast(dict[str, dict[str, Any]], json.loads(workflow.conversation_variables or "{}"))
    return cast(
        Sequence[Variable],
        [variable_factory.build_conversation_variable_from_mapping(value) for value in variables.values()],
    )


class WorkflowExecutionVariables(Protocol):
    def workflow_loader(self, workflow: WorkflowSnapshot, user_id: str) -> VariableLoader: ...
    def saver_factory(self, tenant_id: str, account: Account) -> DraftVariableSaverFactory: ...
    def get_or_create_conversation(self, account_id: str, app: App, workflow: WorkflowBindingScope) -> str: ...
    def load_execution_outputs(self, execution: WorkflowNodeExecutionModel) -> Mapping[str, Any] | None: ...


@dataclasses.dataclass(frozen=True)
class WorkflowDraftVariableList:
    variables: list[WorkflowDraftVariable]
    total: int | None = None


class DraftVariableChangedError(Exception):
    """A concurrent edit invalidated a draft-variable mutation's source snapshot."""


@dataclasses.dataclass(frozen=True)
class DraftVariableContext:
    """Loaded owner and optional draft; no live persistence resources escape the read."""

    mode: str | None
    workflow: Workflow | None
    snapshot: WorkflowSnapshot | None


@dataclasses.dataclass(frozen=True)
class DraftVariableFileInfo:
    upload_file_id: str
    size: int | None
    value_type: str
    length: int | None


@dataclasses.dataclass(frozen=True)
class DraftVariableView:
    id: str
    type: str
    name: str
    description: str
    selector: list[str]
    value_type: str
    edited: bool
    visible: bool
    is_truncated: bool
    value: Segment | None
    full_content: DraftVariableFileInfo | None


@dataclasses.dataclass(frozen=True)
class ConsoleVariableList:
    variables: list[DraftVariableView]
    total: int | None = None


class DraftVariableNotFoundError(Exception):
    """The variable is not visible in the admitted owner and account scope."""


class InvalidDraftVariableError(ValueError):
    """The requested variable mutation or selector is invalid."""


class DraftVariableOwnerNotFoundError(Exception):
    """The variable owner is unavailable or has an unsupported application mode."""

    def __init__(self, kind: str):
        self.kind = kind
        super().__init__(f"{kind.capitalize()} not found")
