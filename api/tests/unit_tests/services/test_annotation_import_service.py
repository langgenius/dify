"""Exercise annotation CSV validation with real streams and the production parser."""

from io import BytesIO
from typing import Literal

import pytest

from services.annotation_import_service import (
    AnnotationImportJob,
    AnnotationImportLimits,
    AnnotationImportRecord,
    AnnotationImportService,
    AnnotationImportValidationError,
    parse_annotation_csv,
)
from services.entities.feature_entities import LimitationModel


def test_preserves_literal_na_and_other_non_nan_text() -> None:
    stream = BytesIO(b"question,answer\nNA,valid answer\nvalid question,NA\nN/A,NULL\nnull,#N/A\n")

    assert parse_annotation_csv(stream, min_records=1, max_records=5) == [
        {"question": "NA", "answer": "valid answer"},
        {"question": "valid question", "answer": "NA"},
        {"question": "N/A", "answer": "NULL"},
        {"question": "null", "answer": "#N/A"},
    ]


def test_parses_quoted_commas_newlines_and_unicode_and_strips_fields() -> None:
    stream = BytesIO('question,answer\r\n" 问题, 一 "," 答案\n第二行 "\r\n'.encode())

    assert parse_annotation_csv(stream, min_records=1, max_records=5) == [
        {"question": "问题, 一", "answer": "答案\n第二行"}
    ]


def test_rewinds_stream_and_uses_first_two_columns() -> None:
    stream = BytesIO(b"prompt,response,ignored\nq,a,extra\n")
    stream.seek(10)

    assert parse_annotation_csv(stream, min_records=1, max_records=5) == [{"question": "q", "answer": "a"}]


@pytest.mark.parametrize("content", [b"", b"question,answer", b"x" * 8192 + b"\nq,a\n"])
def test_requires_a_newline_in_first_chunk(content: bytes) -> None:
    with pytest.raises(AnnotationImportValidationError, match="empty or invalid"):
        parse_annotation_csv(BytesIO(content), min_records=1, max_records=5)


def test_rejects_one_column_csv() -> None:
    with pytest.raises(AnnotationImportValidationError, match="at least 2 columns"):
        parse_annotation_csv(BytesIO(b"question\nonly question\n"), min_records=1, max_records=5)


@pytest.mark.parametrize("content", [b"question,answer\n", b"question,answer\n  , \nnan,answer\nquestion,NaN\n"])
def test_rejects_csv_without_valid_records(content: bytes) -> None:
    with pytest.raises(AnnotationImportValidationError, match=r"at least 1 valid.*Found 0 valid"):
        parse_annotation_csv(BytesIO(content), min_records=1, max_records=5)


def test_skips_blank_nan_and_missing_fields() -> None:
    stream = BytesIO(
        b"question,answer\n,empty question\nempty answer,\n  ,answer\nquestion, \n"
        b"NaN,answer\nquestion,nAn\nmissing answer\nvalid,kept\n"
    )

    assert parse_annotation_csv(stream, min_records=1, max_records=10) == [{"question": "valid", "answer": "kept"}]


def test_skips_malformed_rows_with_extra_columns() -> None:
    stream = BytesIO(b"question,answer\nfirst,one\nbroken,row,extra\nsecond,two\n")

    assert parse_annotation_csv(stream, min_records=1, max_records=5) == [
        {"question": "first", "answer": "one"},
        {"question": "second", "answer": "two"},
    ]


def test_enforces_minimum_valid_record_count() -> None:
    with pytest.raises(AnnotationImportValidationError, match=r"at least 2 valid.*Found 1 valid"):
        parse_annotation_csv(BytesIO(b"question,answer\nq,a\n,\n"), min_records=2, max_records=5)


def test_accepts_exact_maximum_record_count() -> None:
    assert parse_annotation_csv(BytesIO(b"question,answer\nq1,a1\nq2,a2\n"), min_records=1, max_records=2) == [
        {"question": "q1", "answer": "a1"},
        {"question": "q2", "answer": "a2"},
    ]


def test_rejects_record_count_over_maximum() -> None:
    with pytest.raises(AnnotationImportValidationError, match="Maximum 2 records"):
        parse_annotation_csv(BytesIO(b"question,answer\nq1,a1\nq2,a2\nq3,a3\n"), min_records=1, max_records=2)


def test_accepts_fields_at_length_limits() -> None:
    question = "问" * 2000
    answer = "答" * 10000
    stream = BytesIO(f"question,answer\n{question},{answer}\n".encode())

    assert parse_annotation_csv(stream, min_records=1, max_records=5) == [{"question": question, "answer": answer}]


@pytest.mark.parametrize(
    ("question", "answer", "message"),
    [
        ("q" * 2001, "a", "Question at row 3 is too long. Maximum 2000 characters allowed."),
        ("q", "a" * 10001, "Answer at row 3 is too long. Maximum 10000 characters allowed."),
    ],
)
def test_rejects_oversized_fields_with_csv_row_number(question: str, answer: str, message: str) -> None:
    stream = BytesIO(f"question,answer\nvalid,answer\n{question},{answer}\n".encode())

    with pytest.raises(AnnotationImportValidationError) as exc_info:
        parse_annotation_csv(stream, min_records=1, max_records=5)

    assert str(exc_info.value) == message


@pytest.mark.parametrize(
    "content",
    [b'"question,answer\n', b'question,answer\n,\n,\n"unclosed,answer\n', b"question,answer\nq,\xff\n"],
)
def test_parser_and_encoding_errors_are_validation_errors(content: bytes) -> None:
    with pytest.raises(AnnotationImportValidationError):
        parse_annotation_csv(BytesIO(content), min_records=1, max_records=5)


class _Apps:
    def __init__(self) -> None:
        self.required: list[tuple[str, str]] = []

    def require_app(self, *, tenant_id: str, app_id: str) -> None:
        self.required.append((tenant_id, app_id))


class _Jobs:
    def __init__(self) -> None:
        self.requests: list[tuple[str, int, int]] = []
        self.created: list[tuple[str, str, str, int]] = []
        self.released: list[tuple[str, str, str]] = []

    def record_request(self, *, tenant_id: str, window_seconds: Literal[60, 3600], now_ms: int) -> int:
        self.requests.append((tenant_id, window_seconds, now_ms))
        return 1

    def count_active(self, *, tenant_id: str, now_ms: int) -> int:
        return sum(1 for job in self.created if job[0] == tenant_id and job[3] <= now_ms)

    def create(self, *, tenant_id: str, app_id: str, job_id: str, now_ms: int) -> None:
        self.created.append((tenant_id, app_id, job_id, now_ms))

    def release(self, *, tenant_id: str, app_id: str, job_id: str) -> None:
        self.released.append((tenant_id, app_id, job_id))

    def get(self, *, tenant_id: str, app_id: str, job_id: str) -> AnnotationImportJob | None:
        owned = any(job[:3] == (tenant_id, app_id, job_id) for job in self.created)
        return AnnotationImportJob(job_id=job_id, job_status="waiting") if owned else None


def _import_two_records(quota: LimitationModel | None) -> list[list[AnnotationImportRecord]]:
    published: list[list[AnnotationImportRecord]] = []

    def publish(*, content_list: list[AnnotationImportRecord], **_kwargs: str) -> None:
        published.append(content_list)

    service = AnnotationImportService(
        apps=_Apps(),
        jobs=_Jobs(),
        publish=publish,
        quota=lambda **_kwargs: quota,
        limits=AnnotationImportLimits(
            min_records=1, max_records=5, requests_per_minute=10, requests_per_hour=10, max_concurrent=1
        ),
    )
    service.import_csv(tenant_id="tenant", app_id="app", account_id="account", stream=BytesIO(b"q,a\nq1,a1\nq2,a2\n"))
    return published


@pytest.mark.parametrize("quota", [None, LimitationModel(size=10, limit=None), LimitationModel(size=3, limit=5)])
def test_import_accepts_unlimited_and_available_quota(quota: LimitationModel | None) -> None:
    assert len(_import_two_records(quota)) == 1


@pytest.mark.parametrize(("size", "limit"), [(4, 5), (5, 5), (0, 0)])
def test_import_rejects_quota_overflow(size: int, limit: int) -> None:
    with pytest.raises(AnnotationImportValidationError, match="exceeds the limit of your subscription"):
        _import_two_records(LimitationModel(size=size, limit=limit))
