"""The openapi DSL import rules; the console import uses none of them.

Before an import: refuse a stale overwrite (draft_hash), refuse a graph with errors, fill the
defaults the editor needs, and keep the secrets the draft already stores (an export blanks them).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import yaml
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.db.session_factory import session_factory
from factories import variable_factory
from graphon.variables import SecretVariable, SegmentType, VariableBase
from graphon.variables.exc import VariableError
from machinery.context import RequestContext
from models import App, AppMode, Workflow
from repositories.app.console_repository import require_console_app
from services.workflow.graph_check import (
    GRAPH_MODES,
    GraphIssue,
    IssueSeverity,
    check_graph,
    credential_check,
)
from services.workflow.graph_diff import draft_token
from services.workflow.node_defaults import fill_graph
from services.workflow_service import WorkflowService


class DslNotCheckableError(ValueError):
    pass


class DraftChangedError(Exception):
    """The draft changed after the export the import is based on."""


class DslRefusedError(Exception):
    def __init__(self, issues: Sequence[GraphIssue]) -> None:
        super().__init__("The DSL has errors the import refuses")
        self.issues = list(issues)


def stored_secret_ids(draft: Workflow) -> set[str]:
    return {variable.id for variable in draft.environment_variables if isinstance(variable, SecretVariable)}


def _parse(yaml_content: str) -> dict[str, Any]:
    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as error:
        raise DslNotCheckableError(f"Invalid YAML: {error}") from error
    if not isinstance(data, dict):
        raise DslNotCheckableError("The DSL must be a YAML mapping")
    return data


def _section(data: Mapping[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def _graph(workflow: Mapping[str, Any]) -> Mapping[str, Any]:
    graph = workflow.get("graph")
    return graph if isinstance(graph, Mapping) else {}


def _graph_mode(data: Mapping[str, Any], app: App | None) -> AppMode:
    """The mode the graph must fit: the overwritten app's, else the DSL's own."""
    target = app.mode if app is not None else _section(data, "app").get("mode")
    if target not in GRAPH_MODES:
        raise DslNotCheckableError("Only workflow or advanced-chat DSLs can be checked")
    return AppMode(target)


def _target_app(session: Session, context: RequestContext, app_id: str | None) -> App | None:
    return require_console_app(session, context, app_id) if app_id else None


def _environment(workflow: Mapping[str, Any]) -> dict[str, VariableBase]:
    try:
        variables = [
            variable_factory.build_environment_variable_from_mapping(item)
            for item in workflow.get("environment_variables") or []
        ]
    except VariableError as error:
        raise DslNotCheckableError(str(error)) from error
    return {variable.name: variable for variable in variables}


def check_dsl(context: RequestContext, yaml_content: str, app_id: str | None) -> list[GraphIssue]:
    """Every issue, errors and credential warnings alike.

    Raises DslNotCheckableError for a DSL that is not a workflow graph or has a bad environment
    variable, ConsoleAppNotFoundError for an `app_id` outside the workspace.
    """
    data = _parse(yaml_content)
    workflow = _section(data, "workflow")
    with session_factory.create_session() as session:
        mode = _graph_mode(data, _target_app(session, context, app_id))
        resources = credential_check(context.active_workspace_id, _environment(workflow), session)
        return check_graph(_graph(workflow), mode=mode, resources=resources)


def _keep_stored_secrets(workflow: Mapping[str, Any], draft: Workflow) -> None:
    stored = stored_secret_ids(draft)
    for variable in workflow.get("environment_variables") or []:
        if (
            isinstance(variable, dict)
            and variable.get("value_type") == SegmentType.SECRET
            and variable.get("value") == ""
            and variable.get("id") in stored
        ):
            variable["value"] = HIDDEN_VALUE


def prepare_import(context: RequestContext, *, yaml_content: str, app_id: str | None, draft_hash: str | None) -> str:
    """The YAML to hand the import. A DSL the check can't read goes through unchanged, for the import to judge.

    Raises DraftChangedError, DslRefusedError, or ConsoleAppNotFoundError for an `app_id` outside the workspace.
    """
    with session_factory.create_session() as session:
        app = _target_app(session, context, app_id)
        draft = WorkflowService().get_draft_workflow(app_model=app, session=session) if app else None
        if draft_hash is not None and (draft is None or draft_token(draft) != draft_hash):
            raise DraftChangedError()
        try:
            data = _parse(yaml_content)
            mode = _graph_mode(data, app)
        except DslNotCheckableError:
            return yaml_content
        workflow = _section(data, "workflow")
        errors = [i for i in check_graph(_graph(workflow), mode=mode) if i.code.severity is IssueSeverity.ERROR]
        if errors:
            raise DslRefusedError(errors)
        if "graph" in workflow:
            workflow["graph"] = fill_graph(_graph(workflow))
        if draft is not None:
            _keep_stored_secrets(workflow, draft)
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
