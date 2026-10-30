"""Numeric metadata filters tolerate historical non-numeric JSON values."""

import re
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Document
from repositories.knowledge.metadata_filter import process_metadata_filter_func, query_metadata_filter_document_ids
from services.knowledge.entities.metadata import Condition
from tests.unit_tests.model_factories import make_dataset, make_document

TENANT_ID = "tenant-1"
DATASET_ID = "dataset-1"


def test_sqlite_numeric_filter_only_compares_json_numbers(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    metadata_by_document: dict[str, dict[str, object]] = {
        "11111111-1111-1111-1111-111111111111": {"score": 2},
        "22222222-2222-2222-2222-222222222222": {"score": 2.5},
        "33333333-3333-3333-3333-333333333333": {"score": "100"},
        "44444444-4444-4444-4444-444444444444": {"score": "not-a-number"},
        "55555555-5555-5555-5555-555555555555": {"score": "NaN"},
        "66666666-6666-6666-6666-666666666666": {"score": "Infinity"},
        "77777777-7777-7777-7777-777777777777": {"score": True},
        "88888888-8888-8888-8888-888888888888": {"score": None},
        "99999999-9999-9999-9999-999999999999": {},
    }
    with sqlite_session_factory.begin() as session:
        session.add(make_dataset(dataset_id=DATASET_ID, tenant_id=TENANT_ID))
        for position, (document_id, metadata) in enumerate(metadata_by_document.items(), start=1):
            document = make_document(
                document_id=document_id,
                tenant_id=TENANT_ID,
                dataset_id=DATASET_ID,
                position=position,
                doc_metadata=metadata,
            )
            document.enabled = True
            document.archived = False
            document.indexing_status = "completed"
            session.add(document)

    with sqlite_session_factory() as session:
        numeric_result = query_metadata_filter_document_ids(
            session,
            tenant_id=TENANT_ID,
            dataset_ids=[DATASET_ID],
            conditions=[Condition(name="score", comparison_operator=">", value=2)],
        )
        string_result = query_metadata_filter_document_ids(
            session,
            tenant_id=TENANT_ID,
            dataset_ids=[DATASET_ID],
            conditions=[Condition(name="score", comparison_operator="contains", value="0")],
        )

    assert numeric_result == {DATASET_ID: ["22222222-2222-2222-2222-222222222222"]}
    assert string_result == {DATASET_ID: ["33333333-3333-3333-3333-333333333333"]}


def test_postgresql_numeric_filter_guards_json_type_before_casting() -> None:
    filters = process_metadata_filter_func(0, ">", "score", 2.5, [], dialect_name="postgresql")

    statement = select(Document.id).where(*filters)
    bound_sql = str(statement.compile(dialect=postgresql.dialect()))
    bound_params = statement.compile(dialect=postgresql.dialect()).params
    sql = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    normalized_sql = " ".join(sql.split())

    assert re.search(
        r"CASE WHEN \(jsonb_typeof\(.+\) = 'number'\) THEN CAST\(.+ AS NUMERIC\) END > CAST\(2.5 AS NUMERIC\)",
        normalized_sql,
    )
    assert normalized_sql.index("jsonb_typeof") < normalized_sql.index("CAST(")
    assert re.search(r"> CAST\(%\(.+\)s AS NUMERIC\)", bound_sql)
    assert any(value == Decimal("2.5") for value in bound_params.values())


def test_mysql_numeric_filter_guards_json_type_before_coercing() -> None:
    filters = process_metadata_filter_func(0, ">", "score", 2, [], dialect_name="mysql")

    statement = select(Document.id).where(*filters)
    sql = str(statement.compile(dialect=mysql.dialect(), compile_kwargs={"literal_binds": True}))
    normalized_sql = " ".join(sql.split())

    assert "CASE WHEN (json_type(" in normalized_sql
    assert " IN ('INTEGER', 'DOUBLE')" in normalized_sql
    assert normalized_sql.index("json_type") < normalized_sql.index("+0.")
