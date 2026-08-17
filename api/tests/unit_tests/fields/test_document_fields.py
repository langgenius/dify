from unittest.mock import MagicMock

from fields.document_fields import DocumentWithSession
from fields.document_response_prefetch import DocumentResponsePrefetch
from models.dataset import DocMetadataDetailItem


def test_document_with_session_uses_explicit_getters() -> None:
    session = MagicMock()
    document = MagicMock()
    document.get_data_source_detail_dict.return_value = {"source": "detail"}
    document.get_hit_count.return_value = 3
    document.get_doc_metadata_details.return_value = [{"name": "author"}]
    source = DocumentWithSession(document=document, session=session)

    assert source.data_source_detail_dict == {"source": "detail"}
    assert source.hit_count == 3
    assert source.doc_metadata_details == [{"name": "author"}]
    document.get_data_source_detail_dict.assert_called_once_with(session=session)
    document.get_hit_count.assert_called_once_with(session=session)
    document.get_doc_metadata_details.assert_called_once_with(session=session)


def test_document_with_session_uses_prefetched_values_without_queries() -> None:
    session = MagicMock()
    document = MagicMock(id="document-1")
    metadata_details: list[DocMetadataDetailItem] = [
        {"id": "metadata-1", "name": "author", "type": "string", "value": "Ada"}
    ]
    prefetch = DocumentResponsePrefetch(
        data_source_details={"document-1": {"source": "prefetched"}},
        hit_counts={"document-1": 7},
        metadata_details={"document-1": metadata_details},
        process_rule_dicts={"document-1": None},
        completed_segment_counts={"document-1": 2},
        total_segment_counts={"document-1": 3},
        include_segment_counts=True,
    )
    source = DocumentWithSession(document=document, session=session, prefetch=prefetch)

    assert source.data_source_detail_dict == {"source": "prefetched"}
    assert source.hit_count == 7
    assert source.doc_metadata_details == metadata_details
    document.get_data_source_detail_dict.assert_not_called()
    document.get_hit_count.assert_not_called()
    document.get_doc_metadata_details.assert_not_called()
