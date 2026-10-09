"""Behavioral and architecture regressions for explicit knowledge reads."""

import ast
from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access.scope import FileAccessScope, bind_file_access_scope, grant_upload_file_access
from core.tools.signature import verify_tool_file_signature
from extensions.storage.storage_type import StorageType
from fields.document_fields import DocumentResponse
from graphon.file import helpers as file_helpers
from models import dataset as dataset_module
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetQuery,
    Document,
    DocumentSegment,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.tools import ToolFile
from repositories.knowledge.dataset_read_repository import get_external_api_bindings_batch
from repositories.knowledge.segment_read_adapter import sign_segment_content
from services.knowledge.dataset_read_service import (
    get_dataset_queries,
    get_document_metadata_details,
    load_document_details,
)


def _dataset() -> Dataset:
    return Dataset(
        id="dataset-1", tenant_id="tenant-1", name="Knowledge", created_by="account-1", built_in_field_enabled=False
    )


def _document(index: int = 1) -> Document:
    return Document(
        id=f"document-{index}",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=index,
        data_source_type="upload_file",
        batch="batch-1",
        name="source.txt",
        created_from="web",
        created_by="account-1",
    )


def _segment(content: str) -> DocumentSegment:
    return DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content=content,
        word_count=1,
        tokens=1,
        created_by="account-1",
    )


def _upload(tenant_id: str = "tenant-1") -> UploadFile:
    return UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="image.png",
        name="image.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2024, 1, 1),
        used=True,
    )


@contextmanager
def _queries(session: Session) -> Generator[list[str]]:
    statements: list[str] = []

    def count(
        _conn: object, _cursor: object, statement: str, _parameters: object, _context: object, _executemany: bool
    ) -> None:
        statements.append(statement)

    engine = session.get_bind()
    event.listen(engine, "before_cursor_execute", count)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", count)


def test_mixed_links_are_signed_in_place_and_old_parameters_are_replaced(sqlite_session: Session) -> None:
    upload = _upload()
    tool = ToolFile(
        user_id="account-1", tenant_id="tenant-1", conversation_id=None, file_key="tool.png", mimetype="image/png"
    )
    sqlite_session.add_all([upload, tool])
    sqlite_session.flush()
    paths = [f"/files/tools/{tool.id}.png", f"/files/{upload.id}/image-preview", f"/files/{upload.id}/file-preview"]
    segment = _segment(
        " BEFORE " + " MIDDLE ".join(path + "?timestamp=1&nonce=old&sign=old" for path in paths) + " AFTER "
    )
    signed = sign_segment_content(segment, session=sqlite_session)
    assert signed.startswith(" BEFORE ")
    assert signed.endswith(" AFTER ")
    urls = signed.removeprefix(" BEFORE ").removesuffix(" AFTER ").split(" MIDDLE ")
    assert [urlsplit(url).path for url in urls] == paths
    for index, url in enumerate(urls):
        params = parse_qs(urlsplit(url).query)
        assert all(len(value) == 1 for value in params.values())
        values = {key: value[0] for key, value in params.items()}
        assert values["nonce"] != "old"
        if index == 0:
            assert verify_tool_file_signature(tool.id, **values)
        elif index == 1:
            assert file_helpers.verify_image_signature(upload_file_id=upload.id, **values)
        else:
            assert file_helpers.verify_file_signature(upload_file_id=upload.id, **values)
    # A second pass must also yield valid URLs rather than appending stale parameters.
    segment.content = signed
    resigned = sign_segment_content(segment, session=sqlite_session)
    assert resigned.count("?timestamp=") == 3
    for url in resigned.removeprefix(" BEFORE ").removesuffix(" AFTER ").split(" MIDDLE "):
        params = parse_qs(urlsplit(url).query)
        assert all(len(values) == 1 for values in params.values())
        assert params["nonce"] != ["old"]
        assert params["sign"] != ["old"]


def test_foreign_file_reference_never_receives_a_signature(sqlite_session: Session) -> None:
    foreign = _upload("tenant-2")
    foreign_tool = ToolFile(
        user_id="account-2", tenant_id="tenant-2", conversation_id=None, file_key="tool.png", mimetype="image/png"
    )
    sqlite_session.add_all([foreign, foreign_tool])
    sqlite_session.flush()
    path = f"/files/{foreign.id}/file-preview"
    segment = _segment(path + "?timestamp=1&nonce=old&sign=old")
    assert sign_segment_content(segment, session=sqlite_session) == path
    tool_path = f"/files/tools/{foreign_tool.id}.png"
    assert sign_segment_content(_segment(tool_path + "?nonce=old&sign=old"), session=sqlite_session) == tool_path


def test_signing_respects_end_user_ownership_in_same_tenant(sqlite_session: Session) -> None:
    upload = _upload()
    sqlite_session.add(upload)
    sqlite_session.flush()
    path = f"/files/{upload.id}/file-preview"
    scope = FileAccessScope(
        tenant_id="tenant-1", user_id="end-user-1", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.WEB_APP
    )
    with bind_file_access_scope(scope):
        assert sign_segment_content(_segment(path), session=sqlite_session) == path
        grant_upload_file_access([upload.id])
        assert "?timestamp=" in sign_segment_content(_segment(path), session=sqlite_session)


def test_signing_handles_uppercase_ids_and_ignores_malformed_links(sqlite_session: Session) -> None:
    upload = _upload()
    sqlite_session.add(upload)
    sqlite_session.flush()
    path = f"/files/{upload.id.upper()}/file-preview"
    signed = sign_segment_content(_segment(path), session=sqlite_session)
    params = {key: values[0] for key, values in parse_qs(urlsplit(signed).query).items()}
    assert file_helpers.verify_file_signature(upload_file_id=upload.id, **params)

    malformed = "/files/not-a-uuid/file-preview"
    with _queries(sqlite_session) as queries:
        assert sign_segment_content(_segment(malformed), session=sqlite_session) == malformed
    assert queries == []


@pytest.mark.parametrize("content", ["123", "null", "[1]", '{"a":1}', '"text"', "[]", "plain text"])
def test_plain_text_query_is_not_confused_with_json_records(sqlite_session: Session, content: str) -> None:
    query = DatasetQuery(
        dataset_id="dataset-1",
        content=content,
        source="hit_testing",
        source_app_id=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    assert get_dataset_queries(query, session=sqlite_session) == [
        {"content_type": "text_query", "content": content, "file_info": None}
    ]


@pytest.mark.parametrize("enabled", [False, True])
def test_document_metadata_respects_dataset_builtin_flag(sqlite_session: Session, enabled: bool) -> None:
    dataset = _dataset()
    dataset.built_in_field_enabled = enabled
    document = _document()
    document.doc_metadata = {"custom": "value"}
    metadata = DatasetMetadata(
        tenant_id=dataset.tenant_id, dataset_id=dataset.id, type="string", name="custom", created_by="account-1"
    )
    binding = DatasetMetadataBinding(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        metadata_id=metadata.id,
        created_by="account-1",
    )
    sqlite_session.add_all([dataset, document, metadata, binding])
    sqlite_session.flush()
    details = get_document_metadata_details(document, session=sqlite_session)
    assert details is not None
    assert details[0]["value"] == "value"
    assert len([item for item in details if item["id"] == "built-in"]) == (5 if enabled else 0)


def test_waiting_document_reports_paused_until_resumed() -> None:
    document = _document()
    document.indexing_status = "waiting"
    document.is_paused = True
    assert document.display_status == "paused"
    document.is_paused = False
    assert document.display_status == "queuing"


def test_document_page_load_is_bounded_and_serialization_performs_no_queries(sqlite_session: Session) -> None:
    documents = [_document(i) for i in range(1, 21)]
    sqlite_session.add_all([_dataset(), *documents])
    sqlite_session.flush()
    with _queries(sqlite_session) as single_queries:
        load_document_details(documents[:1], session=sqlite_session)
    with _queries(sqlite_session) as page_queries:
        sources = load_document_details(documents, session=sqlite_session)
    assert len(page_queries) == len(single_queries)
    with _queries(sqlite_session) as serialization_queries:
        responses = [DocumentResponse.model_validate(source, from_attributes=True).model_dump() for source in sources]
    assert len(responses) == 20
    assert serialization_queries == []


def test_external_api_bindings_are_batched_and_tenant_scoped(sqlite_session: Session) -> None:
    dataset = _dataset()
    apis = [
        ExternalKnowledgeApis(
            tenant_id="tenant-1",
            name=f"API {i}",
            description="",
            settings="{}",
            created_by="account-1",
            updated_by=None,
        )
        for i in range(20)
    ]
    foreign_dataset = Dataset(id="dataset-foreign", tenant_id="tenant-2", name="Private", created_by="account-2")
    bindings = [
        ExternalKnowledgeBindings(
            tenant_id="tenant-1",
            external_knowledge_api_id=api.id,
            dataset_id=dataset.id,
            external_knowledge_id="knowledge",
            created_by="account-1",
        )
        for api in apis
    ]
    bindings.append(
        ExternalKnowledgeBindings(
            tenant_id="tenant-2",
            external_knowledge_api_id=apis[0].id,
            dataset_id=foreign_dataset.id,
            external_knowledge_id="foreign",
            created_by="account-2",
        )
    )
    sqlite_session.add_all([dataset, foreign_dataset, *apis, *bindings])
    sqlite_session.flush()
    with _queries(sqlite_session) as queries:
        result = get_external_api_bindings_batch(apis, session=sqlite_session)
    assert len(queries) == 1
    assert result == {api.id: [{"id": dataset.id, "name": dataset.name}] for api in apis}


def test_dataset_models_have_no_infrastructure_dependencies_or_relative_imports() -> None:
    tree = ast.parse(Path(dataset_module.__file__).read_text())
    forbidden = ("repositories", "services", "extensions", "core.tools", "models.engine")
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert node.level == 0
            assert not (node.module or "").startswith(forbidden)
            assert not any(alias.name in {"Session", "scoped_session"} for alias in node.names)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            assert ast.unparse(node.func.value) not in {"session", "db.session", "storage"}
