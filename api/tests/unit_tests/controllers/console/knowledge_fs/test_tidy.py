"""Console routes of Tidy: how list queries are admitted before anything is forwarded."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping

import pytest
from flask import Flask
from flask_restx import Resource
from werkzeug.exceptions import NotFound

import controllers.console.knowledge_fs.tidy as module
from controllers.console.knowledge_fs import resources
from controllers.console.knowledge_fs.error import (
    KnowledgeFSAccessDeniedHTTPError,
    KnowledgeFSConflictHTTPError,
    KnowledgeFSInvalidRequestHTTPError,
    KnowledgeFSOperationUnavailableHTTPError,
    KnowledgeFSResourceNotFoundHTTPError,
    KnowledgeFSSpaceNotFoundHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from libs.exception import BaseHTTPException
from services.knowledge_fs.errors import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
from services.knowledge_fs.tidy_dto import (
    KnowledgeFSTidyActionPayload,
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidyFindingResponse,
    KnowledgeFSTidyRetryResponse,
    KnowledgeFSTidyScanListResponse,
    KnowledgeFSTidyScanQuery,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidySettingsResponse,
    KnowledgeFSTidySummaryResponse,
)
from tests.helpers.unit.knowledge_agent import FakeKnowledgeFacade, FakeKnowledgeRuntime, knowledge_fs_features

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
    monkeypatch.setattr(resources, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))
    monkeypatch.setattr(module, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(module, "_console_services", lambda: FakeKnowledgeRuntime(facade=recording))
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


# -- Every endpoint: what it forwards, what it answers, how failures are mapped -----------------------

ACTOR = {"tenant_id": "tenant-1", "account_id": "account-1", "control_space_id": "space-1"}
FINDING_ID = "f" * 64
SETTINGS = {
    "enabled": True,
    "conflicts": False,
    "revision": 4,
    "lastError": None,
    "updatedAt": "2026-11-01T08:00:00Z",
}
SUMMARY = {
    "findings": [{"status": "open", "kind": "duplicate", "count": 3}],
    "documents": {"pending": 1, "scanning": 1, "complete": 7, "failed": 0},
    "modelCalls": 12,
    "current": {"documentId": "doc-1", "title": "Handbook", "passagesDone": 4, "passagesTotal": 9},
}


def _evidence(document_id: str) -> dict[str, object]:
    return {
        "documentId": document_id,
        "revision": 2,
        "title": "Handbook",
        "chunkId": f"chunk-{document_id}",
        "start": 0,
        "end": 7,
        "text": "14 days",
    }


FINDING = {
    "id": FINDING_ID,
    "kind": "duplicate",
    "left": _evidence("doc-1"),
    "right": _evidence("doc-2"),
    "reason": "Same text.",
    "similarity": 1.0,
    "status": "dismissed",
    "revision": 2,
    "actionId": "action-1",
    "createdAt": "2026-11-01T08:00:00Z",
    "stale": False,
}


def _route(resource: type, method: str) -> Callable[..., object]:
    """A route body with the KnowledgeFS error translation, without the login decorators."""
    return resources._knowledge_fs_errors(inspect.unwrap(vars(resource)[method]))


# Each endpoint: its resource, method, facade operation, a valid body, and extra path arguments.
ENDPOINTS: dict[str, tuple[type, str, str, dict[str, object] | None, tuple[str, ...]]] = {
    "settings": (module.KnowledgeFSTidySettingsApi, "get", "get_tidy_settings", None, ()),
    "update-settings": (
        module.KnowledgeFSTidySettingsApi,
        "patch",
        "update_tidy_settings",
        {"enabled": False, "expectedRevision": 3},
        (),
    ),
    "summary": (module.KnowledgeFSTidySummaryApi, "get", "get_tidy_summary", None, ()),
    "findings": (module.KnowledgeFSTidyFindingsApi, "get", "list_tidy_findings", None, ()),
    "scans": (module.KnowledgeFSTidyScansApi, "get", "list_tidy_scans", None, ()),
    "action": (
        module.KnowledgeFSTidyActionApi,
        "post",
        "act_on_tidy_finding",
        {"expectedRevision": 1, "action": "dismiss"},
        (FINDING_ID,),
    ),
    "retry": (module.KnowledgeFSTidyRetryApi, "post", "retry_tidy_scans", None, ()),
}


@pytest.fixture
def tidy(monkeypatch: pytest.MonkeyPatch) -> FakeKnowledgeFacade:
    fake = FakeKnowledgeFacade()
    monkeypatch.setattr(resources, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=True))
    monkeypatch.setattr(module, "_actor", lambda: ("account-1", "tenant-1"))
    monkeypatch.setattr(module, "_console_services", lambda: FakeKnowledgeRuntime(facade=fake))
    return fake


def _send(app: Flask, endpoint: str, body: Mapping[str, object] | None = None) -> object:
    resource, method, _, default_body, path = ENDPOINTS[endpoint]
    payload = default_body if body is None else body
    with app.test_request_context("/console/api/knowledge-fs/spaces/space-1/tidy", method=method.upper(), json=payload):
        if payload is not None:
            module.console_ns.payload  # noqa: B018 - flask-restx reads the JSON body lazily
        return _route(resource, method)(resource(), "space-1", *path)


def test_settings_are_read_for_the_signed_in_member(app: Flask, tidy: FakeKnowledgeFacade) -> None:
    tidy.answers["get_tidy_settings"] = KnowledgeFSTidySettingsResponse.model_validate(SETTINGS)
    assert _send(app, "settings") == SETTINGS
    assert tidy.calls == [("get_tidy_settings", ACTOR)]


def test_settings_are_changed_with_the_validated_payload(app: Flask, tidy: FakeKnowledgeFacade) -> None:
    tidy.answers["update_tidy_settings"] = KnowledgeFSTidySettingsResponse.model_validate(
        {**SETTINGS, "conflicts": True, "revision": 5, "lastError": "model_unavailable"}
    )
    body = {"enabled": True, "conflicts": True, "expectedRevision": 4, "acknowledgeTokenUsage": True}
    assert _send(app, "update-settings", body) == {
        **SETTINGS,
        "conflicts": True,
        "revision": 5,
        "lastError": "model_unavailable",
    }
    assert tidy.calls == [
        ("update_tidy_settings", {**ACTOR, "payload": KnowledgeFSTidySettingsPayload.model_validate(body)})
    ]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"enabled": True, "expectedRevision": 4},
        {"enabled": True, "conflicts": True, "expectedRevision": 4, "acknowledgeTokenUsage": False},
        {"enabled": False, "expectedRevision": -1},
        {"enabled": False, "expectedRevision": 4, "scanNow": True},
    ],
    ids=["empty", "conflicts-default-on", "not-acknowledged", "negative-revision", "unknown-key"],
)
def test_settings_that_do_not_validate_are_a_400_and_change_nothing(
    app: Flask, tidy: FakeKnowledgeFacade, body: dict[str, object]
) -> None:
    with pytest.raises(KnowledgeFSInvalidRequestHTTPError) as error:
        _send(app, "update-settings", body)
    assert error.value.code == 400
    assert tidy.calls == []


def test_duplicate_detection_alone_needs_no_token_acknowledgment(app: Flask, tidy: FakeKnowledgeFacade) -> None:
    tidy.answers["update_tidy_settings"] = KnowledgeFSTidySettingsResponse.model_validate(SETTINGS)
    _send(app, "update-settings", {"enabled": True, "conflicts": False, "expectedRevision": 3})
    payload = tidy.calls[0][1]["payload"]
    assert isinstance(payload, KnowledgeFSTidySettingsPayload)
    assert (payload.enabled, payload.conflicts, payload.acknowledgeTokenUsage) == (True, False, False)


def test_the_summary_reports_counts_progress_and_the_document_being_scanned(
    app: Flask, tidy: FakeKnowledgeFacade
) -> None:
    tidy.answers["get_tidy_summary"] = KnowledgeFSTidySummaryResponse.model_validate(SUMMARY)
    assert _send(app, "summary") == SUMMARY
    assert tidy.calls == [("get_tidy_summary", ACTOR)]
    tidy.answers["get_tidy_summary"] = KnowledgeFSTidySummaryResponse.model_validate({**SUMMARY, "current": None})
    assert _send(app, "summary") == {**SUMMARY, "current": None}


def test_findings_and_scans_are_answered_in_their_response_shape(app: Flask, tidy: FakeKnowledgeFacade) -> None:
    card = {
        "title": "Handbook",
        "mimeType": "text/markdown",
        "sizeBytes": 10,
        "publishedAt": "2026-11-01",
        "enabled": True,
    }
    tidy.answers["list_tidy_findings"] = KnowledgeFSTidyFindingListResponse.model_validate(
        {"items": [FINDING], "nextCursor": FINDING_CURSOR, "documents": {"doc-1": card}}
    )
    scan = {"documentId": "doc-1", "title": "Handbook", "state": "failed", "windows": 3, "modelCalls": 2, "error": "x"}
    tidy.answers["list_tidy_scans"] = KnowledgeFSTidyScanListResponse.model_validate(
        {"items": [scan], "nextCursor": None}
    )
    assert _send(app, "findings") == {"items": [FINDING], "nextCursor": FINDING_CURSOR, "documents": {"doc-1": card}}
    assert _send(app, "scans") == {"items": [scan], "nextCursor": None}


@pytest.mark.parametrize(
    "body",
    [
        {"expectedRevision": 1, "action": "dismiss"},
        {"expectedRevision": 2, "action": "disable_document", "documentId": "doc-2"},
        {"expectedRevision": 2, "action": "adopt", "documentId": "doc-1", "replacement": "Refunds within 14 days."},
        {
            "expectedRevision": 1,
            "action": "disable_document",
            "documentId": "doc-2",
            "also": [{"findingId": "e" * 64, "expectedRevision": 1, "action": "dismiss"}],
        },
        {"expectedRevision": 3, "action": "undo"},
    ],
    ids=["dismiss", "disable", "adopt", "keep-one", "undo"],
)
def test_an_action_is_applied_to_the_finding_in_the_path(
    app: Flask, tidy: FakeKnowledgeFacade, body: dict[str, object]
) -> None:
    tidy.answers["act_on_tidy_finding"] = KnowledgeFSTidyFindingResponse.model_validate(FINDING)
    assert _send(app, "action", body) == FINDING
    assert tidy.calls == [
        (
            "act_on_tidy_finding",
            {**ACTOR, "payload": KnowledgeFSTidyActionPayload.model_validate(body), "finding_id": FINDING_ID},
        )
    ]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"expectedRevision": 0, "action": "dismiss"},
        {"expectedRevision": 1, "action": "delete"},
        {"expectedRevision": 1, "action": "disable_document"},
        {"expectedRevision": 1, "action": "adopt", "documentId": "doc-1"},
        {"expectedRevision": 1, "action": "adopt", "documentId": "doc-1", "replacement": "   "},
        {"expectedRevision": 1, "action": "dismiss", "replacement": "new wording"},
        {
            "expectedRevision": 1,
            "action": "undo",
            "also": [{"findingId": "e" * 64, "expectedRevision": 1, "action": "dismiss"}],
        },
        {
            "expectedRevision": 1,
            "action": "dismiss",
            "also": [{"findingId": "e" * 64, "expectedRevision": 1, "action": "disable_document"}],
        },
    ],
    ids=[
        "empty",
        "revision-zero",
        "unknown-action",
        "disable-without-document",
        "adopt-without-wording",
        "adopt-blank-wording",
        "wording-without-adopt",
        "undo-with-others",
        "further-disable-without-document",
    ],
)
def test_an_action_that_does_not_validate_is_a_400_and_is_not_applied(
    app: Flask, tidy: FakeKnowledgeFacade, body: dict[str, object]
) -> None:
    with pytest.raises(KnowledgeFSInvalidRequestHTTPError) as error:
        _send(app, "action", body)
    assert error.value.code == 400
    assert tidy.calls == []


def test_an_action_on_a_changed_or_missing_finding_is_a_conflict_or_not_found(
    app: Flask, tidy: FakeKnowledgeFacade
) -> None:
    tidy.failures["act_on_tidy_finding"] = KnowledgeFSProductRequestRejectedError(status_code=409)
    with pytest.raises(KnowledgeFSConflictHTTPError) as conflict:
        _send(app, "action")
    assert (conflict.value.code, conflict.value.error_code) == (409, "knowledge_fs_conflict")
    tidy.failures["act_on_tidy_finding"] = KnowledgeFSProductResourceNotFoundError("finding is gone")
    with pytest.raises(KnowledgeFSResourceNotFoundHTTPError) as missing:
        _send(app, "action")
    assert (missing.value.code, missing.value.error_code) == (404, "knowledge_fs_resource_not_found")


def test_retry_reports_how_many_scans_were_resumed(app: Flask, tidy: FakeKnowledgeFacade) -> None:
    tidy.answers["retry_tidy_scans"] = KnowledgeFSTidyRetryResponse(resumed=3)
    assert _send(app, "retry") == {"resumed": 3}
    assert tidy.calls == [("retry_tidy_scans", ACTOR)]


FAILURES: list[tuple[Exception, type[Exception], int, str]] = [
    (
        KnowledgeFSProductNotFoundError("no such space"),
        KnowledgeFSSpaceNotFoundHTTPError,
        404,
        "knowledge_fs_space_not_found",
    ),
    (PermissionError("viewer"), KnowledgeFSAccessDeniedHTTPError, 403, "knowledge_fs_access_denied"),
    (
        KnowledgeFSOperationUnavailableError("tidy is not deployed"),
        KnowledgeFSOperationUnavailableHTTPError,
        503,
        "knowledge_fs_operation_unavailable",
    ),
    (
        KnowledgeFSProductRemoteError("connection reset"),
        KnowledgeFSUpstreamUnavailableHTTPError,
        503,
        "knowledge_fs_upstream_unavailable",
    ),
    (
        KnowledgeFSProductRequestRejectedError(status_code=400),
        KnowledgeFSInvalidRequestHTTPError,
        400,
        "knowledge_fs_invalid_request",
    ),
    (
        KnowledgeFSProductRequestRejectedError(status_code=403),
        KnowledgeFSAccessDeniedHTTPError,
        403,
        "knowledge_fs_access_denied",
    ),
]


@pytest.mark.parametrize("endpoint", sorted(ENDPOINTS))
@pytest.mark.parametrize(
    ("failure", "raised", "status", "code"), FAILURES, ids=[f"{type(row[0]).__name__}-{row[2]}" for row in FAILURES]
)
def test_every_endpoint_maps_knowledge_service_failures_to_the_console_error_contract(
    app: Flask,
    tidy: FakeKnowledgeFacade,
    endpoint: str,
    failure: Exception,
    raised: type[Exception],
    status: int,
    code: str,
) -> None:
    operation = ENDPOINTS[endpoint][2]
    tidy.failures[operation] = failure
    with pytest.raises(raised) as error:
        _send(app, endpoint)
    assert isinstance(error.value, BaseHTTPException)
    assert error.value.code == status
    assert error.value.data is not None
    assert (error.value.data["code"], error.value.data["status"]) == (code, status)
    assert tidy.called() == [operation]


@pytest.mark.parametrize("endpoint", sorted(ENDPOINTS))
def test_every_endpoint_is_a_404_while_agent_knowledge_base_is_off(
    app: Flask, tidy: FakeKnowledgeFacade, monkeypatch: pytest.MonkeyPatch, endpoint: str
) -> None:
    monkeypatch.setattr(resources, "get_knowledge_fs_features", lambda: knowledge_fs_features(enabled=False))
    with pytest.raises(NotFound):
        _send(app, endpoint)
    assert tidy.calls == []


def test_the_endpoint_table_covers_every_tidy_route() -> None:
    routed = {
        (resource, method)
        for resource in vars(module).values()
        if isinstance(resource, type) and resource.__module__ == module.__name__ and issubclass(resource, Resource)
        for method in ("get", "post", "patch", "put", "delete")
        if method in vars(resource)
    }
    assert routed == {(resource, method) for resource, method, _, _, _ in ENDPOINTS.values()}
