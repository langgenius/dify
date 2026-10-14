"""Exercise annotation CSV validation with real streams and the production parser."""

from io import BytesIO

import pytest

from services.annotation_import_service import (
    AnnotationImportQuota,
    AnnotationImportValidationError,
    parse_annotation_csv,
)


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


@pytest.mark.parametrize(("limit", "size", "record_count"), [(5, 2, 2), (5, 2, 3), (0, 10, 20), (-1, 10, 20)])
def test_quota_accepts_available_capacity_and_nonpositive_unlimited_limits(
    limit: int, size: int, record_count: int
) -> None:
    AnnotationImportQuota(limit=limit, size=size).validate(record_count=record_count)


@pytest.mark.parametrize(("size", "record_count"), [(0, 6), (4, 2), (5, 1)])
def test_quota_rejects_positive_limit_overflow(size: int, record_count: int) -> None:
    with pytest.raises(AnnotationImportValidationError, match="exceeds the limit of your subscription"):
        AnnotationImportQuota(limit=5, size=size).validate(record_count=record_count)
