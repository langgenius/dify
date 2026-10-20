"""The openapi DSL import rules; the console import uses none of them.

Before an import: refuse a stale overwrite (draft_hash), refuse a graph with errors, fill the
defaults the editor needs, and keep the secrets the draft already stores (an export blanks them).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

import yaml

from constants import HIDDEN_VALUE
from core.file import remote_fetcher
from factories import variable_factory
from graphon.variables import SecretVariable, SegmentType, VariableBase
from graphon.variables.exc import VariableError
from machinery.context import RequestContext
from models import AppMode, Workflow
from services.dsl_content import DSL_MAX_SIZE, dsl_content_size
from services.entities.dsl_entities import ImportMode
from services.errors.app import DraftChangedError
from services.workflow.contracts import WorkflowRecord
from services.workflow.graph_check import (
    GRAPH_MODES,
    GraphIssue,
    IssueSeverity,
    ResourceCheck,
    check_graph,
)
from services.workflow.node_defaults import fill_graph


class DslNotCheckableError(ValueError):
    pass


class YamlUrlFetchError(ValueError):
    pass


class DslRefusedError(Exception):
    def __init__(self, issues: Sequence[GraphIssue]) -> None:
        super().__init__("The DSL has errors the import refuses")
        self.issues = list(issues)


def stored_secret_ids(draft: Workflow | WorkflowRecord) -> set[str]:
    return {variable.id for variable in draft.environment_variables if isinstance(variable, SecretVariable)}


@dataclass(frozen=True)
class DslImportTarget:
    """What the import rules read from the app a DSL overwrites."""

    mode: str
    draft_token: str | None
    stored_secret_ids: frozenset[str]


class DslImportStore(Protocol):
    def load_target(self, context: RequestContext, app_id: str) -> DslImportTarget:
        """Raises ConsoleAppNotFoundError for an app outside the workspace."""
        ...

    def credential_check(
        self, workspace_id: str, environment: Mapping[str, VariableBase]
    ) -> AbstractContextManager[ResourceCheck]:
        """Publish's credential check, usable until the context exits."""
        ...


def fetch_yaml_url(yaml_url: str) -> str:
    """The YAML text at a URL, fetched as AppDslService.import_app does; a GitHub blob link reads its raw file."""
    try:
        parsed_url = urlparse(yaml_url)
        if (
            parsed_url.scheme == "https"
            and parsed_url.netloc == "github.com"
            and parsed_url.path.endswith((".yml", ".yaml"))
            and "/blob/" in parsed_url.path
        ):
            yaml_url = yaml_url.replace("https://github.com", "https://raw.githubusercontent.com")
            yaml_url = yaml_url.replace("/blob/", "/")
        response = remote_fetcher.make_request("GET", yaml_url.strip(), follow_redirects=True, timeout=(10, 10))
        response.raise_for_status()
        raw_content = response.content
        if dsl_content_size(raw_content) > DSL_MAX_SIZE:
            raise YamlUrlFetchError("File size exceeds the limit of 10MB")
        content = raw_content.decode("utf-8")
    except YamlUrlFetchError:
        raise
    except Exception as e:
        raise YamlUrlFetchError(f"Error fetching YAML from URL: {str(e)}") from e
    if not content:
        raise YamlUrlFetchError("Empty content from url")
    return content


def _parse(yaml_content: str) -> dict[str, Any]:
    # Measured before parsing: re-dumping drops comments, so a padded DSL could shrink under the import's limit.
    if dsl_content_size(yaml_content) > DSL_MAX_SIZE:
        raise DslNotCheckableError("File size exceeds the limit of 10MB")
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


def _graph_mode(data: Mapping[str, Any], target: DslImportTarget | None) -> AppMode:
    """The mode the graph must fit: the overwritten app's, else the DSL's own."""
    mode = target.mode if target is not None else _section(data, "app").get("mode")
    if mode not in GRAPH_MODES:
        raise DslNotCheckableError("Only workflow or advanced-chat DSLs can be checked")
    return AppMode(mode)


def _environment(workflow: Mapping[str, Any]) -> dict[str, VariableBase]:
    items = workflow.get("environment_variables") or []
    if not isinstance(items, list) or not all(isinstance(item, Mapping) for item in items):
        raise DslNotCheckableError("workflow.environment_variables must be a list of mappings")
    try:
        variables = [variable_factory.build_environment_variable_from_mapping(item) for item in items]
    except VariableError as error:
        raise DslNotCheckableError(str(error)) from error
    return {variable.name: variable for variable in variables}


def _keep_stored_secrets(workflow: Mapping[str, Any], stored: frozenset[str]) -> None:
    for variable in workflow.get("environment_variables") or []:
        if (
            isinstance(variable, dict)
            and variable.get("value_type") == SegmentType.SECRET
            and variable.get("value") == ""
            and variable.get("id") in stored
        ):
            variable["value"] = HIDDEN_VALUE


class DslImportService:
    def __init__(self, *, store: DslImportStore) -> None:
        self._store = store

    def _target(self, context: RequestContext, app_id: str | None) -> DslImportTarget | None:
        return self._store.load_target(context, app_id) if app_id else None

    def check(self, context: RequestContext, yaml_content: str, app_id: str | None) -> list[GraphIssue]:
        """Every issue, errors and credential warnings alike.

        Raises DslNotCheckableError for a DSL that is not a workflow graph or has a bad environment
        variable, ConsoleAppNotFoundError for an `app_id` outside the workspace.
        """
        data = _parse(yaml_content)
        workflow = _section(data, "workflow")
        mode = _graph_mode(data, self._target(context, app_id))
        environment = _environment(workflow)
        with self._store.credential_check(context.active_workspace_id, environment) as resources:
            return check_graph(_graph(workflow), mode=mode, resources=resources)

    def prepare(
        self, context: RequestContext, *, mode: ImportMode, source: str, app_id: str | None, draft_hash: str | None
    ) -> str:
        """The YAML to hand the import. A DSL the check can't read goes through unchanged, for the import to judge.

        A URL is fetched only after the target app and draft pass. Raises DraftChangedError, DslRefusedError,
        YamlUrlFetchError, or ConsoleAppNotFoundError for an `app_id` outside the workspace.
        """
        target = self._target(context, app_id)
        if draft_hash is not None and (target is None or target.draft_token != draft_hash):
            raise DraftChangedError()
        yaml_content = fetch_yaml_url(source) if mode == ImportMode.YAML_URL else source
        try:
            data = _parse(yaml_content)
            app_mode = _graph_mode(data, target)
        except DslNotCheckableError:
            return yaml_content
        workflow = _section(data, "workflow")
        errors = [i for i in check_graph(_graph(workflow), mode=app_mode) if i.code.severity is IssueSeverity.ERROR]
        if errors:
            raise DslRefusedError(errors)
        if "graph" in workflow:
            workflow["graph"] = fill_graph(_graph(workflow))
        if target is not None:
            _keep_stored_secrets(workflow, target.stored_secret_ids)
        return yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
