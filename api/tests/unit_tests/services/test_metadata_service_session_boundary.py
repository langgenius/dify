"""Metadata operations persist through scoped, independently owned transactions."""

from datetime import datetime
from typing import Literal, cast
from unittest.mock import create_autospec

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import Select

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.dataset import Dataset, DatasetMetadataBinding, Document, build_built_in_field_values
from models.enums import DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.metadata_repository import (
    SQLAlchemyMetadataRepository,
    lock_metadata_dataset,
    lock_metadata_document,
)
from services.errors.metadata import InvalidMetadataValueError, MetadataResourceNotFoundError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.metadata.application import MetadataService
from tests.helpers.unit.model_factories import make_account, make_dataset, make_document

REF = DatasetRef("tenant-1", "dataset-1")
DOCUMENT_ID = "11111111-1111-1111-1111-111111111111"
FOREIGN_ID = "22222222-2222-2222-2222-222222222222"


class _StatementRecordingSession:
    def __init__(self) -> None:
        self.statements: list[Select[tuple[object]]] = []

    def scalar(self, statement: Select[tuple[object]]) -> None:
        self.statements.append(statement)


def test_metadata_owner_lock_queries_refresh_for_update() -> None:
    recorder = _StatementRecordingSession()
    session = cast(Session, recorder)

    lock_metadata_dataset(session, REF)
    lock_metadata_document(session, REF, DOCUMENT_ID)

    dataset_query, document_query = recorder.statements
    assert dataset_query._for_update_arg is not None
    assert document_query._for_update_arg is not None
    assert dataset_query.get_execution_options()["populate_existing"] is True
    assert document_query.get_execution_options()["populate_existing"] is True


@pytest.fixture
def metadata_service(sqlite_session_factory: sessionmaker[Session]) -> MetadataService:
    with sqlite_session_factory.begin() as session:
        account = make_account(account_id="actor", name="User", email="metadata@example.com")
        session.add(account)
        for ref, document_id in [(REF, DOCUMENT_ID), (DatasetRef("tenant-2", "dataset-2"), FOREIGN_ID)]:
            session.add(
                make_dataset(dataset_id=ref.dataset_id, tenant_id=ref.tenant_id, name="Dataset", created_by="actor")
            )
            document = make_document(
                document_id=document_id,
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                batch="batch",
                created_from=DocumentCreatedFrom.API,
                created_by="actor",
                created_at=datetime(2026, 1, 1),
                updated_at=datetime(2026, 1, 2),
            )
            document.enabled = True
            document.archived = False
            document.indexing_status = IndexingStatus.COMPLETED
            session.add(document)
    return MetadataService(
        store=SQLAlchemyMetadataRepository(session_factory=sqlite_session_factory),
        dataset_access=create_autospec(DatasetAccess, instance=True),
    )


def test_create_commits_through_owned_session(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    fields = metadata_service.get_dataset_metadatas(REF)
    assert fields["doc_metadata"] == [{"id": result.id, "type": "string", "name": "author", "count": 0}]
    with sqlite_session_factory() as session:
        assert session.scalar(select(DatasetMetadataBinding)) is None


@pytest.mark.parametrize("name", ["x" * 256, "document_name", "uploader", "upload_date", "last_update_date", "source"])
def test_invalid_name_is_rejected(metadata_service: MetadataService, name: str) -> None:
    with pytest.raises(
        ValueError,
        match=(
            "(?:Metadata name already exists in Built\\-in fields\\.|Metadata name cannot exceed 255 characters\\.)"
        ),
    ):
        metadata_service.create_metadata(REF, MetadataArgs(type="string", name=name), actor_id="actor")
    assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == []


def test_duplicate_name_is_rejected(metadata_service: MetadataService) -> None:
    metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    with pytest.raises(ValueError, match="already exists"):
        metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")


def _operation(
    document_id: str,
    metadata_id: str,
    *,
    value: str | int | float | None = "Alice",
    partial: bool = False,
    bypass_input_validation: bool = False,
) -> MetadataOperationData:
    detail = (
        MetadataDetail.model_construct(id=metadata_id, name="spoofed", value=value)
        if bypass_input_validation
        else MetadataDetail(id=metadata_id, name="spoofed", value=value)
    )
    return MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=document_id,
                metadata_list=[detail],
                partial_update=partial,
            )
        ]
    )


@pytest.mark.parametrize("partial", [True, False])
def test_update_uses_canonical_names_and_preserves_partial_values(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], partial: bool
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    with sqlite_session_factory.begin() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        document.doc_metadata = {"existing": "kept"}
    metadata_service.update_documents_metadata(
        REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
    )
    metadata_service.update_documents_metadata(
        REF, _operation(DOCUMENT_ID, field.id, partial=partial), actor_id="actor"
    )
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == ({"existing": "kept", "author": "Alice"} if partial else {"author": "Alice"})
        assert len(session.scalars(select(DatasetMetadataBinding)).all()) == 1


@pytest.mark.parametrize(
    ("field_type", "value"),
    [
        ("string", ""),
        ("string", "NaN is still ordinary text"),
        ("number", 0),
        ("number", -1.25),
        ("time", 0),
        ("time", 1792137600.5),
        ("string", None),
        ("number", None),
        ("time", None),
    ],
)
def test_update_accepts_values_matching_the_persisted_field_type(
    metadata_service: MetadataService,
    sqlite_session_factory: sessionmaker[Session],
    field_type: Literal["string", "number", "time"],
    value: str | int | float | None,
) -> None:
    field = metadata_service.create_metadata(
        REF, MetadataArgs(type=field_type, name=f"field_{field_type}"), actor_id="actor"
    )

    metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id, value=value), actor_id="actor")

    with sqlite_session_factory() as session:
        document = session.get_one(Document, DOCUMENT_ID)
        assert document.doc_metadata == {f"field_{field_type}": value}


@pytest.mark.parametrize(
    ("field_type", "value", "bypass_input_validation"),
    [
        ("string", 1, False),
        ("number", "1", False),
        ("number", "not-a-number", False),
        ("number", float("nan"), False),
        ("number", float("inf"), False),
        ("number", float("-inf"), False),
        ("number", True, True),
        ("time", "1792137600", False),
        ("time", False, True),
    ],
)
def test_update_rejects_values_that_do_not_match_the_persisted_field_type(
    metadata_service: MetadataService,
    sqlite_session_factory: sessionmaker[Session],
    field_type: Literal["string", "number", "time"],
    value: object,
    bypass_input_validation: bool,
) -> None:
    field = metadata_service.create_metadata(
        REF, MetadataArgs(type=field_type, name=f"field_{field_type}"), actor_id="actor"
    )

    with pytest.raises(InvalidMetadataValueError, match=f"requires a {field_type} value or null"):
        metadata_service.update_documents_metadata(
            REF,
            _operation(
                DOCUMENT_ID,
                field.id,
                value=value,  # type: ignore[arg-type]
                bypass_input_validation=bypass_input_validation,
            ),
            actor_id="actor",
        )

    with sqlite_session_factory() as session:
        document = session.get_one(Document, DOCUMENT_ID)
        assert document.doc_metadata is None
        assert session.scalar(select(DatasetMetadataBinding)) is None


def test_metadata_detail_rejects_boolean_before_it_can_be_coerced_to_an_integer() -> None:
    with pytest.raises(ValidationError):
        MetadataDetail(id="11111111-1111-1111-1111-111111111111", name="field", value=True)


def test_invalid_later_operation_is_rejected_before_any_batch_write(
    metadata_service: MetadataService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    string_field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    number_field = metadata_service.create_metadata(REF, MetadataArgs(type="number", name="rating"), actor_id="actor")
    args = _operation(DOCUMENT_ID, string_field.id, value="Alice")
    args.operation_data.extend(_operation(DOCUMENT_ID, number_field.id, value="not-a-number").operation_data)
    engine = sqlite_session_factory.kw["bind"]
    assert isinstance(engine, Engine)
    writes: list[str] = []

    def record_writes(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            writes.append(statement)

    event.listen(engine, "before_cursor_execute", record_writes)
    try:
        with pytest.raises(InvalidMetadataValueError, match="requires a number value or null"):
            metadata_service.update_documents_metadata(REF, args, actor_id="actor")
    finally:
        event.remove(engine, "before_cursor_execute", record_writes)

    assert writes == []
    with sqlite_session_factory() as session:
        document = session.get_one(Document, DOCUMENT_ID)
        assert document.doc_metadata is None
        assert session.scalar(select(DatasetMetadataBinding)) is None


@pytest.mark.parametrize("foreign", ["dataset", "document", "metadata"])
def test_owner_chain_is_validated_before_any_batch_write(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session], foreign: str
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    other = metadata_service.create_metadata(
        DatasetRef("tenant-2", "dataset-2"), MetadataArgs(type="string", name="foreign"), actor_id="actor"
    )
    args = _operation(DOCUMENT_ID, field.id)
    args.operation_data.extend(
        _operation(
            FOREIGN_ID if foreign == "document" else DOCUMENT_ID, other.id if foreign == "metadata" else field.id
        ).operation_data
    )
    ref = DatasetRef("tenant-2", REF.dataset_id) if foreign == "dataset" else REF
    with pytest.raises(MetadataResourceNotFoundError):
        metadata_service.update_documents_metadata(ref, args, actor_id="actor")
    with sqlite_session_factory() as session:
        assert all(document.doc_metadata is None for document in session.scalars(select(Document)))
        assert not session.scalars(select(DatasetMetadataBinding)).all()


def test_rename_delete_and_counts_share_scoped_bindings(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")
    metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
    renamed = metadata_service.update_metadata_name(REF, field.id, "writer", actor_id="actor")
    assert renamed.name == "writer"
    assert metadata_service.get_dataset_metadatas(REF)["doc_metadata"] == [
        {"id": field.id, "name": "writer", "type": "string", "count": 1}
    ]
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {"writer": "Alice"}
    metadata_service.delete_metadata(REF, field.id)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {}
        assert not session.scalars(select(DatasetMetadataBinding)).all()


def test_builtin_fields_use_owned_document_uploader(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    metadata_service.enable_built_in_field(REF)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        foreign = session.get(Document, FOREIGN_ID)
        assert document is not None
        assert foreign is not None
        assert document.doc_metadata is not None
        assert document.doc_metadata["uploader"] == "User"
        assert foreign.doc_metadata is None
    metadata_service.disable_built_in_field(REF)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata == {}


def test_builtin_fields_batch_uploader_lookup_and_skip_unchanged_documents(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ref = DatasetRef("tenant-1", "batch-metadata-dataset")
    actor_id = "batch-metadata-actor"
    with sqlite_session_factory.begin() as session:
        session.add(make_account(account_id=actor_id, name="User", email="batch-metadata@example.com"))
        session.add(
            make_dataset(
                dataset_id=ref.dataset_id,
                tenant_id=ref.tenant_id,
                name="Batch metadata dataset",
                created_by=actor_id,
                built_in_field_enabled=True,
            )
        )
        for position in range(1, 4):
            document = make_document(
                document_id=f"77777777-7777-7777-7777-77777777777{position}",
                tenant_id=ref.tenant_id,
                dataset_id=ref.dataset_id,
                position=position,
                batch="batch",
                created_from=DocumentCreatedFrom.API,
                created_by=actor_id,
                created_at=datetime(2026, 1, position),
                updated_at=datetime(2026, 2, position),
            )
            document.doc_metadata = build_built_in_field_values(
                document_name=document.name,
                uploader="User",
                upload_date=document.upload_date,
                last_update_date=document.last_update_date,
                data_source_type=document.data_source_type,
            )
            session.add(document)

    engine = cast(Engine, sqlite_session_factory.kw["bind"])
    statements: list[str] = []

    def record_statement(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        SQLAlchemyMetadataRepository(session_factory=sqlite_session_factory).set_built_in(ref, enabled=True)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)

    assert len([statement for statement in statements if "select" in statement and "from accounts" in statement]) == 1
    assert not [statement for statement in statements if statement.lstrip().startswith("update documents")]


def test_builtin_fields_reconcile_every_owned_document_and_restore_metadata_filtering(
    metadata_service: MetadataService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    document_states = {
        "33333333-3333-3333-3333-333333333333": (False, False, IndexingStatus.COMPLETED),
        "44444444-4444-4444-4444-444444444444": (True, True, IndexingStatus.COMPLETED),
        "55555555-5555-5555-5555-555555555555": (True, False, IndexingStatus.WAITING),
        "66666666-6666-6666-6666-666666666666": (True, False, IndexingStatus.ERROR),
    }
    with sqlite_session_factory.begin() as session:
        for position, (document_id, (enabled, archived, status)) in enumerate(document_states.items(), start=2):
            document = make_document(
                document_id=document_id,
                tenant_id=REF.tenant_id,
                dataset_id=REF.dataset_id,
                position=position,
                name=f"Document {position}",
                batch="batch",
                created_from=DocumentCreatedFrom.API,
                created_by="actor",
                created_at=datetime(2026, 1, position),
                updated_at=datetime(2026, 2, position),
                doc_metadata={
                    "custom": document_id,
                    BuiltInField.document_name: "stale name",
                    BuiltInField.source: "stale source",
                },
            )
            document.enabled = enabled
            document.archived = archived
            document.indexing_status = status
            session.add(document)
        foreign = session.get_one(Document, FOREIGN_ID)
        foreign.doc_metadata = {"foreign": "kept", BuiltInField.document_name: "foreign name"}

    # Repeating the current disabled state must repair fields left by older
    # partial synchronization, including documents outside retrieval eligibility.
    metadata_service.disable_built_in_field(REF)
    last_updates: dict[str, datetime] = {}
    with sqlite_session_factory() as session:
        dataset = session.get_one(Dataset, REF.dataset_id)
        assert dataset.built_in_field_enabled is False
        for document_id in document_states:
            document = session.get_one(Document, document_id)
            assert document.doc_metadata == {"custom": document_id}
            last_updates[document_id] = document.updated_at
        foreign = session.get_one(Document, FOREIGN_ID)
        assert foreign.doc_metadata == {"foreign": "kept", BuiltInField.document_name: "foreign name"}

    metadata_service.enable_built_in_field(REF)
    with sqlite_session_factory() as session:
        dataset = session.get_one(Dataset, REF.dataset_id)
        assert dataset.built_in_field_enabled is True
        for document_id in document_states:
            document = session.get_one(Document, document_id)
            assert document.doc_metadata == {
                "custom": document_id,
                **build_built_in_field_values(
                    document_name=document.name,
                    uploader="User",
                    upload_date=document.created_at,
                    last_update_date=last_updates[document_id],
                    data_source_type=document.data_source_type,
                ),
            }

    document_repository = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    source_filter = MetadataFilteringCondition.model_validate(
        {"conditions": [{"name": BuiltInField.source, "comparison_operator": "is", "value": "file_upload"}]}
    )
    assert document_repository.get_hit_testing_document_filter(
        REF,
        source_filter.model_dump(),
    ) == [DOCUMENT_ID]

    metadata_service.disable_built_in_field(REF)
    assert (
        document_repository.get_hit_testing_document_filter(
            REF,
            source_filter.model_dump(),
        )
        == []
    )

    metadata_service.enable_built_in_field(REF)
    assert document_repository.get_hit_testing_document_filter(
        REF,
        source_filter.model_dump(),
    ) == [DOCUMENT_ID]


def test_commit_failure_rolls_back_document_and_bindings(
    metadata_service: MetadataService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    field = metadata_service.create_metadata(REF, MetadataArgs(type="string", name="author"), actor_id="actor")

    def fail(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", fail)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            metadata_service.update_documents_metadata(REF, _operation(DOCUMENT_ID, field.id), actor_id="actor")
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail)
    with sqlite_session_factory() as session:
        document = session.get(Document, DOCUMENT_ID)
        assert document is not None
        assert document.doc_metadata is None
        assert not session.scalars(select(DatasetMetadataBinding)).all()
