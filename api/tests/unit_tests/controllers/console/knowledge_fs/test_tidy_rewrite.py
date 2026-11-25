"""Console route that adopts one side of a Tidy conflict."""

from __future__ import annotations

import inspect
from http import HTTPStatus
from types import SimpleNamespace

import pytest
from flask import Flask

import controllers.console.knowledge_fs.tidy as module
from libs.exception import RelayedHTTPError
from services.knowledge_fs.data_facade import KnowledgeFSDocumentRevisionTarget
from services.knowledge_fs.errors import KnowledgeFSProductRequestRejectedError
from services.knowledge_fs.product_remote import KnowledgeFSRemoteMultipartFile
from services.knowledge_fs.tidy_rewrite import KnowledgeFSTidyRewriteError

EVIDENCE = {"documentId": "d", "revision": 1, "title": "t", "chunkId": "c", "start": 0, "end": 1, "text": "x"}
FINDING = {
    "id": "f" * 64,
    "kind": "conflict",
    "left": EVIDENCE,
    "right": EVIDENCE,
    "reason": "r",
    "similarity": None,
    "status": "reviewed",
    "revision": 2,
    "actionId": "a",
    "createdAt": "2026-11-25",
}
PAYLOAD = {"expectedRevision": 1, "documentId": "doc-1", "passage": "旧", "replacement": "新"}
UPLOAD = KnowledgeFSRemoteMultipartFile(filename="a.md", content_type="text/markdown", body="新".encode())
TARGET = KnowledgeFSDocumentRevisionTarget("doc-1", 3, 7)


class Facade:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.act_error: Exception | None = None

    def create_document(self, *, body_reader, revision_of, **_):
        self.calls.append("upload")
        assert body_reader(1024) is UPLOAD
        assert revision_of is TARGET
        return SimpleNamespace(
            logical_document_id="doc-1", document_revision=4, compilation_job=SimpleNamespace(id="task-1")
        )

    def act_on_tidy_finding(self, *, finding_id, payload, **_):
        self.calls.append(f"act:{payload.action}:{payload.expectedRevision}:{finding_id}")
        if self.act_error:
            raise self.act_error
        return FINDING


@pytest.fixture
def facade(monkeypatch: pytest.MonkeyPatch) -> Facade:
    stub = Facade()
    monkeypatch.setattr(module, "_actor", lambda: ("account", "tenant"))
    monkeypatch.setattr(module, "_console_services", lambda: SimpleNamespace(facade=stub))
    monkeypatch.setattr(module, "KnowledgeFSDownloadService", lambda: object())
    monkeypatch.setattr(module, "prepare_tidy_rewrite", lambda **_: (UPLOAD, TARGET))
    monkeypatch.setattr(
        module,
        "FileScanService",
        lambda: SimpleNamespace(scan_content=lambda **_: SimpleNamespace(allowed=True)),
    )
    return stub


def _post(app: Flask):
    with app.test_request_context(method="POST", json=PAYLOAD):
        return inspect.unwrap(module.KnowledgeFSTidyRewriteApi.post)(
            module.KnowledgeFSTidyRewriteApi(), "space", "f" * 64
        )


def test_uploads_the_rewritten_revision_then_marks_the_finding_reviewed(app: Flask, facade: Facade) -> None:
    body, status = _post(app)

    assert status == HTTPStatus.ACCEPTED
    assert facade.calls == ["upload", f"act:review:1:{'f' * 64}"]
    assert (body["documentId"], body["documentRevision"], body["taskId"]) == ("doc-1", 4, "task-1")
    assert body["finding"]["status"] == "reviewed"


def test_keeps_an_accepted_rewrite_when_the_finding_cannot_be_marked(app: Flask, facade: Facade) -> None:
    facade.act_error = KnowledgeFSProductRequestRejectedError(status_code=409)

    body, status = _post(app)

    assert status == HTTPStatus.ACCEPTED
    assert body["finding"] is None


def test_names_why_a_document_cannot_be_rewritten_and_uploads_nothing(
    app: Flask, facade: Facade, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(**_):
        raise KnowledgeFSTidyRewriteError("tidy_rewrite_passage_ambiguous", "The passage occurs more than once.")

    monkeypatch.setattr(module, "prepare_tidy_rewrite", refuse)

    with pytest.raises(RelayedHTTPError) as raised:
        _post(app)

    assert (raised.value.code, raised.value.error_code) == (409, "tidy_rewrite_passage_ambiguous")
    assert facade.calls == []
