from unittest.mock import Mock, patch

from services.hit_testing_service import HitTestingService


def _retrieval_record(payload: dict):
    record = Mock()
    record.model_dump.return_value = payload
    return record


def _dataset_document(
    document_id: str = "document-1",
    name: str = "guide.md",
    data_source_type: str = "upload_file",
    doc_type: str | None = None,
    doc_metadata: dict | None = None,
):
    document = Mock()
    document.id = document_id
    document.name = name
    document.data_source_type = data_source_type
    document.doc_type = doc_type
    document.doc_metadata = doc_metadata
    return document


class TestHitTestingServiceDumpRecords:
    def test_dump_dataset_document_returns_frontend_required_fields(self):
        document = _dataset_document(doc_metadata={"source": "manual"})

        assert HitTestingService._dump_dataset_document(document) == {
            "id": "document-1",
            "data_source_type": "upload_file",
            "name": "guide.md",
            "doc_type": None,
            "doc_metadata": {"source": "manual"},
        }

    def test_dump_retrieval_records_returns_dumped_records_without_document_ids(self):
        record = _retrieval_record({"segment": None, "score": 0.95})

        assert HitTestingService._dump_retrieval_records([record]) == [{"segment": None, "score": 0.95}]

    def test_dump_retrieval_records_injects_documents_and_keeps_non_segment_records(self):
        record_without_segment = _retrieval_record({"segment": None, "score": 0.95})
        record_with_document = _retrieval_record(
            {
                "segment": {
                    "id": "segment-1",
                    "document_id": "document-1",
                },
                "score": 0.9,
            }
        )
        scalars_result = Mock()
        scalars_result.all.return_value = [_dataset_document()]

        with patch("services.hit_testing_service.db.session.scalars", return_value=scalars_result):
            result = HitTestingService._dump_retrieval_records([record_without_segment, record_with_document])

        assert result[0] == {"segment": None, "score": 0.95}
        assert result[1]["segment"]["document"] == {
            "id": "document-1",
            "data_source_type": "upload_file",
            "name": "guide.md",
            "doc_type": None,
            "doc_metadata": None,
        }

    def test_dump_retrieval_records_skips_records_with_missing_documents(self, caplog):
        record = _retrieval_record(
            {
                "segment": {
                    "id": "segment-1",
                    "document_id": "missing-document",
                },
                "score": 0.95,
            }
        )
        scalars_result = Mock()
        scalars_result.all.return_value = []

        with patch("services.hit_testing_service.db.session.scalars", return_value=scalars_result):
            result = HitTestingService._dump_retrieval_records([record])

        assert result == []
        assert "Skipping hit-testing records with missing documents" in caplog.text
