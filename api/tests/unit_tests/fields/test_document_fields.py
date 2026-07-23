from unittest.mock import MagicMock

from fields.document_fields import DocumentWithSession


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
