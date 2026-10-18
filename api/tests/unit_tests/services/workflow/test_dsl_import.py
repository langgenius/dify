from collections.abc import Generator, Mapping
from contextlib import contextmanager

import pytest
import yaml

from constants import HIDDEN_VALUE
from graphon.variables import VariableBase
from machinery.context import RequestContext
from services.app.console_service import ConsoleAppNotFoundError
from services.dsl_content import DSL_MAX_SIZE
from services.entities.dsl_entities import ImportMode
from services.errors.app import DraftChangedError
from services.workflow import dsl_import
from services.workflow.dsl_import import (
    DslImportService,
    DslImportStore,
    DslImportTarget,
    DslNotCheckableError,
    DslRefusedError,
)
from services.workflow.graph_check import IssueCode, IssueSeverity, ResourceCheck

_CONTEXT = RequestContext("request-1", None, "account-1", "workspace-1")
_START: dict[str, object] = {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}
_END: dict[str, object] = {"id": "end", "data": {"type": "end", "title": "End", "outputs": []}}
_ANSWER: dict[str, object] = {"id": "a", "data": {"type": "answer", "title": "A", "answer": "hi"}}
_TARGET = DslImportTarget(mode="workflow", draft_token="token-1", stored_secret_ids=frozenset({"s-1"}))


class _Store(DslImportStore):
    """Answers with fixed data and records what the service asked for."""

    def __init__(self, target: DslImportTarget | None = None, *, problem: str | None = None) -> None:
        self._target = target
        self._problem = problem
        self.events: list[str] = []

    def load_target(self, context: RequestContext, app_id: str) -> DslImportTarget:
        self.events.append(f"load:{context.active_workspace_id}/{app_id}")
        if self._target is None:
            raise ConsoleAppNotFoundError("App not found")
        return self._target

    @contextmanager
    def credential_check(self, workspace_id: str, environment: Mapping[str, VariableBase]) -> Generator[ResourceCheck]:
        self.events.append(f"open:{workspace_id}:{sorted(environment)}")
        yield lambda _node: self._problem
        self.events.append("close")


def _dsl(mode: str, *nodes: Mapping[str, object], environment: list[dict[str, object]] | None = None) -> str:
    workflow: dict[str, object] = {"graph": {"nodes": list(nodes), "edges": []}}
    if environment is not None:
        workflow["environment_variables"] = environment
    return yaml.safe_dump({"app": {"mode": mode, "name": "x"}, "workflow": workflow})


def _secret(variable_id: str) -> dict[str, object]:
    return {"id": variable_id, "name": variable_id.upper(), "value_type": "secret", "value": ""}


@pytest.fixture
def fetched(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    urls: list[str] = []

    def fetch(url: str) -> str:
        urls.append(url)
        return _dsl("workflow", _START, _END)

    monkeypatch.setattr(dsl_import, "fetch_yaml_url", fetch)
    return urls


def _prepare(store: _Store, *, source: str, app_id: str | None = "app-1", draft_hash: str | None = None) -> str:
    mode = ImportMode.YAML_URL if source.startswith("https://") else ImportMode.YAML_CONTENT
    return DslImportService(store=store).prepare(
        _CONTEXT, mode=mode, source=source, app_id=app_id, draft_hash=draft_hash
    )


@pytest.mark.parametrize(
    ("target", "app_id"),
    [
        pytest.param(_TARGET, "app-1", id="hash-mismatch"),
        pytest.param(DslImportTarget("workflow", None, frozenset()), "app-1", id="no-draft"),
        pytest.param(_TARGET, None, id="no-app"),
    ],
)
def test_prepare_refuses_a_stale_draft_hash_before_fetching(
    fetched: list[str], target: DslImportTarget, app_id: str | None
) -> None:
    with pytest.raises(DraftChangedError):
        _prepare(_Store(target), source="https://example.com/app.yml", app_id=app_id, draft_hash="old")

    assert fetched == []


def test_prepare_fetches_the_url_once_the_draft_hash_matches(fetched: list[str]) -> None:
    _prepare(_Store(_TARGET), source="https://example.com/app.yml", draft_hash="token-1")

    assert fetched == ["https://example.com/app.yml"]


def test_prepare_keeps_only_the_secrets_the_draft_stores() -> None:
    source = _dsl("workflow", _START, _END, environment=[_secret("s-1"), _secret("s-2")])

    prepared = yaml.safe_load(_prepare(_Store(_TARGET), source=source))

    values = {v["id"]: v["value"] for v in prepared["workflow"]["environment_variables"]}
    assert values == {"s-1": HIDDEN_VALUE, "s-2": ""}


def test_prepare_refuses_a_graph_that_does_not_fit_the_target_mode() -> None:
    target = DslImportTarget("advanced-chat", None, frozenset())

    with pytest.raises(DslRefusedError) as exc_info:
        _prepare(_Store(target), source=_dsl("workflow", _START, _END))

    assert [(i.code, i.node_id) for i in exc_info.value.issues] == [(IssueCode.MODE_INCOMPATIBLE, "end")]


@pytest.mark.parametrize("source", [_dsl("chat"), "app: [", _dsl("future-mode", _ANSWER)])
def test_prepare_passes_through_a_dsl_the_check_cannot_read(source: str) -> None:
    assert _prepare(_Store(), source=source, app_id=None) == source


def test_prepare_answers_a_missing_app() -> None:
    with pytest.raises(ConsoleAppNotFoundError):
        _prepare(_Store(), source=_dsl("workflow", _START, _END))


def test_check_reports_credential_problems_inside_the_store_context() -> None:
    store = _Store(_TARGET, problem="no key")

    issues = DslImportService(store=store).check(_CONTEXT, _dsl("workflow", _START, _END), "app-1")

    assert {(i.code, i.code.severity, i.message) for i in issues} == {
        (IssueCode.RESOURCE_UNAVAILABLE, IssueSeverity.WARNING, "no key")
    }
    assert store.events == ["load:workspace-1/app-1", "open:workspace-1:[]", "close"]


def test_check_uses_the_target_apps_mode() -> None:
    store = _Store(DslImportTarget("advanced-chat", None, frozenset()))

    issues = DslImportService(store=store).check(_CONTEXT, _dsl("workflow", _START, _END), "app-1")

    assert [(i.code, i.node_id) for i in issues] == [(IssueCode.MODE_INCOMPATIBLE, "end")]


def test_check_without_an_app_reads_no_target() -> None:
    store = _Store()

    DslImportService(store=store).check(_CONTEXT, _dsl("workflow", _START, _END), None)

    assert store.events == ["open:workspace-1:[]", "close"]


def _padded(yaml_content: str) -> str:
    """A valid DSL over the size limit only because of a trailing comment."""
    return yaml_content + "#" + "x" * DSL_MAX_SIZE + "\n"


def test_check_refuses_a_dsl_over_the_size_limit() -> None:
    with pytest.raises(DslNotCheckableError, match="10MB"):
        DslImportService(store=_Store()).check(_CONTEXT, _padded(_dsl("workflow", _START, _END)), None)


def test_prepare_hands_an_oversized_dsl_to_the_import_unchanged() -> None:
    """Re-dumping drops comments, so a padded DSL must reach the import's own size check as sent."""
    source = _padded(_dsl("workflow", _START, _END))

    assert _prepare(_Store(), source=source, app_id=None) == source
