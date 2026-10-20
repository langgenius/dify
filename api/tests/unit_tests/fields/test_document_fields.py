import json
from datetime import datetime

from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from fields.document_fields import DocumentResponse
from models.dataset import Document, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom
from models.model import UploadFile
from services.knowledge.dataset_read_service import load_document_details


def test_document_detail_serializes_after_session_closes(sqlite_session: Session) -> None:
    upload = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key="documents/source.txt",
        name="source.txt",
        size=12,
        extension=".txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2024, 1, 1),
        used=True,
    )
    document = Document(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps({"upload_file_id": upload.id}),
        batch="batch-1",
        name="source.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        doc_metadata=None,
    )
    segment = DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="hello world",
        word_count=2,
        tokens=2,
        created_by="account-1",
        hit_count=3,
    )
    sqlite_session.add_all([upload, document, segment])
    sqlite_session.flush()
    source = load_document_details([document], session=sqlite_session)[0]
    sqlite_session.expire_all()
    sqlite_session.close()
    response = DocumentResponse.model_validate(source).model_dump(mode="json")

    assert response["data_source_detail_dict"]["upload_file"]["name"] == "source.txt"
    assert response["hit_count"] == 3
    assert response["doc_metadata"] == []
