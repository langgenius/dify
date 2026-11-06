from collections.abc import Mapping, Sequence

import pytest
from sqlalchemy.orm import Session

from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.workflow.graph_diff import WorkflowSnapshot, current_draft_token, diff_workflows, draft_token
from services.workflow.node_defaults import fill_graph


def _snap(
    nodes: Sequence[Mapping[str, object]],
    edges: Sequence[Mapping[str, object]] = (),
    *,
    features: Mapping[str, object] | None = None,
    env: frozenset[str] = frozenset(),
) -> WorkflowSnapshot:
    return WorkflowSnapshot(
        graph={"nodes": list(nodes), "edges": list(edges)},
        features=features or {},
        environment_variable_names=env,
    )


A: dict[str, object] = {"id": "a", "position": {"x": 0}, "data": {"type": "llm", "title": "A", "prompt": "x"}}
B: dict[str, object] = {"id": "b", "data": {"type": "end", "title": "B"}}


def test_diff_without_published() -> None:
    diff = diff_workflows(None, _snap([A]))
    assert diff.published is False
    assert [n.id for n in diff.nodes_added] == ["a"]


def test_layout_changes_are_ignored() -> None:
    moved = {**A, "position": {"x": 99}, "width": 10, "selected": True}
    assert diff_workflows(_snap([A]), _snap([moved])) == diff_workflows(_snap([A]), _snap([A]))


def test_added_removed_changed() -> None:
    changed = {**A, "data": {"type": "llm", "title": "A", "prompt": "y"}}
    diff = diff_workflows(_snap([A, B]), _snap([changed]))
    assert [n.id for n in diff.nodes_removed] == ["b"]
    assert [(n.id, n.fields) for n in diff.nodes_changed] == [("a", ["prompt"])]


def test_edges_features_and_env() -> None:
    edge = {"id": "e", "source": "a", "target": "b", "sourceHandle": "source"}
    diff = diff_workflows(
        _snap([A, B], features={"x": 1}, env=frozenset({"K"})),
        _snap([A, B], [edge], env=frozenset({"K", "J"})),
    )
    assert diff.edges_added == ["a → b (source)"]
    assert diff.features_changed is True
    assert diff.env_added == ["J"]


def test_defaults_filled_by_import_are_not_changes() -> None:
    start = {"id": "s", "data": {"type": "start", "title": "Start"}}
    http = {"id": "h", "data": {"type": "http-request", "title": "H", "method": "get", "url": "https://x"}}
    published = _snap([start, http])
    draft = WorkflowSnapshot(graph=fill_graph(published.graph), features={}, environment_variable_names=frozenset())
    assert diff_workflows(published, draft) == diff_workflows(published, published)
    assert diff_workflows(draft, published) == diff_workflows(draft, draft)


def _workflow(version: str) -> Workflow:
    return Workflow(
        tenant_id="tenant-1",
        app_id="app-1",
        type=WorkflowType.WORKFLOW,
        version=version,
        graph='{"nodes": [], "edges": []}',
        _features="{}",
        created_by="account-1",
    )


def test_current_draft_token_hashes_the_stored_draft(sqlite_session: Session) -> None:
    sqlite_session.add(
        App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    )
    draft = _workflow(Workflow.VERSION_DRAFT)
    sqlite_session.add_all([draft, _workflow("2026-10-14 00:00:00")])
    sqlite_session.commit()

    assert current_draft_token("tenant-1", "app-1") == draft_token(draft)


@pytest.mark.parametrize(("tenant_id", "with_draft"), [("tenant-1", False), ("tenant-2", True)])
def test_current_draft_token_is_none_without_a_draft_in_the_workspace(
    sqlite_session: Session, tenant_id: str, with_draft: bool
) -> None:
    sqlite_session.add(
        App(id="app-1", tenant_id="tenant-1", name="a", mode=AppMode.WORKFLOW, enable_site=True, enable_api=True)
    )
    if with_draft:
        sqlite_session.add(_workflow(Workflow.VERSION_DRAFT))
    sqlite_session.commit()

    assert current_draft_token(tenant_id, "app-1") is None
    assert current_draft_token(tenant_id, "missing-app") is None
