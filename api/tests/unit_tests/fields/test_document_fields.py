import json
from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from fields.document_fields import DocumentWithSession
from models.dataset import Document, DocumentSegment
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom
from models.model import UploadFile


@pytest.mark.parametrize("sqlite_session", [(Document, DocumentSegment, UploadFile)], indirect=True)
def test_document_with_session_uses_explicit_getters(sqlite_session: Session) -> None:
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
    source = DocumentWithSession(document=document, session=sqlite_session)

    assert source.data_source_detail_dict["upload_file"]["name"] == "source.txt"
    assert source.hit_count == 3
    assert source.doc_metadata_details is None
