"""Console routes of Tidy: how list queries are admitted before anything is forwarded."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from types import SimpleNamespace

import pytest
from flask import Flask

import controllers.console.knowledge_fs.tidy as module
from controllers.console.knowledge_fs import resources
from controllers.console.knowledge_fs.error import KnowledgeFSInvalidRequestHTTPError
from services.knowledge_fs.tidy_dto import KnowledgeFSTidyFindingQuery, KnowledgeFSTidyScanQuery

SCAN_CURSOR = "0193a5b0-7c1e-7d3a-8f4e-2b6c9d1e0f3a"
FINDING_CURSOR = "a" * 64


class RecordingFacade:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def list_tidy_findings(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(("list_tidy_findings", kwargs))
        return {"items": [], "nextCursor": None}

    def list_tidy_scans(self, **kwargs: object) -> dict[str, object]:
        self.calls.append(("list_tidy_scans", kwargs))
        return {"items": [], "nextCursor": None}


@pytest.fixture
def facade(monkeypatch: pytest.MonkeyPatch) -> RecordingFacade:
    recording = RecordingFacade()
    monkeypatch.setattr(resources, "get_knowledge_fs_features", lambda: SimpleNamespace(enabled=True))
    monkeypatch.setattr(module, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(module, "_console_services", lambda: SimpleNamespace(facade=recording))
    return recording


# The route bodies with the KnowledgeFS error translation, without the login decorators.
_findings = resources._knowledge_fs_errors(inspect.unwrap(module.KnowledgeFSTidyFindingsApi.get))
_scans = resources._knowledge_fs_errors(inspect.unwrap(module.KnowledgeFSTidyScansApi.get))


def _get(app: Flask, view: Callable[..., object], resource: object, query: str) -> object:
    with app.test_request_context(f"/console/api/knowledge-fs/spaces/space-1/tidy/list?{query}"):
        return view(resource, "space-1")


def test_known_query_parameters_are_forwarded_as_validated_models(app: Flask, facade: RecordingFacade) -> None:
    _get(app, _findings, module.KnowledgeFSTidyFindingsApi(), f"status=open&kind=similar&cursor={FINDING_CURSOR}")
    _get(app, _scans, module.KnowledgeFSTidyScansApi(), f"state=failed&cursor={SCAN_CURSOR}")
    _get(app, _scans, module.KnowledgeFSTidyScansApi(), "")
    assert [name for name, _ in facade.calls] == ["list_tidy_findings", "list_tidy_scans", "list_tidy_scans"]
    assert facade.calls[0][1]["query"] == KnowledgeFSTidyFindingQuery(
        status="open", kind="similar", cursor=FINDING_CURSOR
    )
    assert facade.calls[1][1]["query"] == KnowledgeFSTidyScanQuery(state="failed", cursor=SCAN_CURSOR)
    assert facade.calls[2][1]["query"] == KnowledgeFSTidyScanQuery()
    assert facade.calls[1][1]["control_space_id"] == "space-1"


@pytest.mark.parametrize(
    ("resource", "query"),
    [
        ("findings", "limit=500"),
        ("findings", "status=open&state=failed"),
        ("findings", "cursor=not-a-cursor"),
        ("findings", "status=everything"),
        ("scans", "limit=500"),
        ("scans", "kind=similar"),
        ("scans", "cursor=not-a-uuid"),
        ("scans", f"cursor={SCAN_CURSOR}0"),
        ("scans", f"cursor={FINDING_CURSOR}"),
        ("scans", "state=unknown"),
    ],
)
def test_unknown_parameters_and_malformed_cursors_are_a_400_and_nothing_is_forwarded(
    app: Flask, facade: RecordingFacade, resource: str, query: str
) -> None:
    """With extra keys forbidden, a stray query parameter must be the invalid-request answer, never a 500."""
    view, api = (
        (_findings, module.KnowledgeFSTidyFindingsApi())
        if resource == "findings"
        else (_scans, module.KnowledgeFSTidyScansApi())
    )
    with pytest.raises(KnowledgeFSInvalidRequestHTTPError) as error:
        _get(app, view, api, query)
    assert error.value.code == 400
    assert facade.calls == []


def test_every_tidy_endpoint_says_what_it_does() -> None:
    """Regression: all seven handlers shared one sentence, which is what the API reference showed."""
    handlers = [
        module.KnowledgeFSTidySettingsApi.get,
        module.KnowledgeFSTidySettingsApi.patch,
        module.KnowledgeFSTidySummaryApi.get,
        module.KnowledgeFSTidyFindingsApi.get,
        module.KnowledgeFSTidyScansApi.get,
        module.KnowledgeFSTidyActionApi.post,
        module.KnowledgeFSTidyRetryApi.post,
    ]
    summaries = [(inspect.getdoc(handler) or "").splitlines()[0] for handler in handlers]
    assert all(summaries)
    assert len(set(summaries)) == len(handlers)
