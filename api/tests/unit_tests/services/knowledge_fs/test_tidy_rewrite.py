"""Rewriting one passage of a stored document to resolve a Tidy conflict."""

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from services.knowledge_fs.product_dto import KnowledgeFSDocumentDownloadDescriptor
from services.knowledge_fs.tidy_rewrite import (
    TIDY_REWRITE_MAX_BYTES,
    KnowledgeFSTidyRewriteError,
    prepare_tidy_rewrite,
)

SOURCE = "# 周会\n\n本月进行报销15000元\n\n议程 50 分钟。\n"


def _document(**overrides):
    document = {
        "id": "doc-1",
        "source_id": None,
        "status": "ready",
        "active_revision": 3,
        "row_version": 7,
        "latest_task": None,
        "active": SimpleNamespace(mime_type="text/markdown; charset=utf-8", size_bytes=len(SOURCE.encode())),
    }
    return SimpleNamespace(**{**document, **overrides})


class _Facade:
    def __init__(self, document, body: bytes = SOURCE.encode()) -> None:
        self.document = document
        self.body = body
        self.downloaded = False

    def get_logical_document(self, **_):
        return self.document

    def prepare_logical_document_download(self, **_):
        self.downloaded = True
        return KnowledgeFSDocumentDownloadDescriptor(
            document_id="doc-1",
            filename="周会.md",
            mime_type="text/markdown",
            object_key="key",
            sha256="0" * 64,
            size_bytes=len(self.body),
        )


class _Downloads:
    def __init__(self, facade: _Facade) -> None:
        self.facade = facade

    def load_stream(self, _descriptor):
        yield self.facade.body[:5]
        yield self.facade.body[5:]


def _prepare(facade: _Facade, passage="本月进行报销15000元", replacement="本月进行报销5000元"):
    return prepare_tidy_rewrite(
        facade=facade,
        downloads=_Downloads(facade),
        tenant_id="tenant",
        account_id="account",
        control_space_id="space",
        document_id="doc-1",
        passage=passage,
        replacement=replacement,
    )


def test_replaces_only_the_passage_and_targets_the_revision_that_was_read():
    upload, target = _prepare(_Facade(_document()))

    assert upload.body.decode() == SOURCE.replace("15000", "5000")
    assert (upload.filename, upload.content_type) == ("周会.md", "text/markdown")
    assert target == ("doc-1", 3, 7)


def test_matches_a_multi_line_passage_in_a_crlf_source_and_keeps_its_line_endings():
    facade = _Facade(_document(), "第一行\r\n第二行\r\n结尾\r\n".encode())

    upload, _ = _prepare(facade, passage="第一行\n第二行", replacement="新一行\n新二行")

    assert upload.body.decode() == "新一行\r\n新二行\r\n结尾\r\n"


@pytest.mark.parametrize(
    ("document", "code"),
    [
        (_document(source_id="source-1"), "tidy_rewrite_source_managed"),
        (_document(status="pending"), "tidy_rewrite_document_busy"),
        (_document(active=None), "tidy_rewrite_document_busy"),
        (
            _document(latest_task=SimpleNamespace(state="running", created_at=datetime.now(UTC))),
            "tidy_rewrite_document_busy",
        ),
        (
            _document(active=SimpleNamespace(mime_type="application/pdf", size_bytes=10)),
            "tidy_rewrite_unsupported_document",
        ),
        (
            _document(active=SimpleNamespace(mime_type="text/plain", size_bytes=TIDY_REWRITE_MAX_BYTES + 1)),
            "tidy_rewrite_unsupported_document",
        ),
    ],
)
def test_refuses_documents_that_cannot_be_edited_before_reading_them(document, code):
    facade = _Facade(document)

    with pytest.raises(KnowledgeFSTidyRewriteError) as raised:
        _prepare(facade)

    assert raised.value.code == code
    assert facade.downloaded is False


@pytest.mark.parametrize(
    ("body", "passage", "replacement", "code"),
    [
        (SOURCE.encode(), "本月进行报销9元", "x", "tidy_rewrite_passage_not_found"),
        ((SOURCE + SOURCE).encode(), "本月进行报销15000元", "x", "tidy_rewrite_passage_ambiguous"),
        (SOURCE.encode(), "本月进行报销15000元", "本月进行报销15000元", "tidy_rewrite_no_change"),
        (b"\xff\xfe\x00bad", "x", "y", "tidy_rewrite_unsupported_document"),
    ],
)
def test_refuses_a_passage_it_cannot_place_exactly_once(body, passage, replacement, code):
    with pytest.raises(KnowledgeFSTidyRewriteError) as raised:
        _prepare(_Facade(_document(), body), passage=passage, replacement=replacement)

    assert raised.value.code == code
