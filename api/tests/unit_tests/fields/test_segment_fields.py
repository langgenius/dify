import json
from datetime import datetime

from sqlalchemy.orm import Session

from extensions.storage.storage_type import StorageType
from fields.segment_fields import SegmentResponse
from models.dataset import ChildChunk, DatasetProcessRule, Document, DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, ProcessRuleMode
from models.model import UploadFile
from services.knowledge.dataset_read_service import load_segment_details


def test_segment_detail_serializes_nested_relations_after_session_closes(sqlite_session: Session) -> None:
    rule = DatasetProcessRule(
        dataset_id="dataset-1",
        mode=ProcessRuleMode.HIERARCHICAL,
        rules=json.dumps({"parent_mode": "paragraph"}),
        created_by="account-1",
    )
    document = Document(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        dataset_process_rule_id=rule.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="source.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
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
    )
    chunk = ChildChunk(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        segment_id=segment.id,
        position=1,
        content="hello",
        word_count=1,
        created_by="account-1",
    )
    attachment = UploadFile(
        tenant_id=document.tenant_id,
        storage_type=StorageType.LOCAL,
        key="documents/image.png",
        name="image.png",
        size=12,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2024, 1, 1),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        segment_id=segment.id,
        attachment_id=attachment.id,
    )
    sqlite_session.add_all([rule, document, segment, chunk, attachment, binding])
    sqlite_session.flush()
    details = load_segment_details([segment], {segment.id: "A summary"}, session=sqlite_session)

    # Expire even nested ORM objects so a retained proxy cannot pass by using cached attributes.
    sqlite_session.expire_all()
    sqlite_session.close()
    response = SegmentResponse.model_validate(details[0]).model_dump(mode="json")

    assert response["summary"] == "A summary"
    assert response["sign_content"] == "hello world"
    assert response["child_chunks"][0]["content"] == "hello"
    assert isinstance(response["child_chunks"][0]["created_at"], int)
    assert response["attachments"][0]["name"] == "image.png"
    assert "&sign=" in response["attachments"][0]["source_url"]
