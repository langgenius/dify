from unittest.mock import patch

from events.event_handlers.clean_when_document_deleted import handle


def test_handler_dispatches_cleanup_task():
    with patch("events.event_handlers.clean_when_document_deleted.clean_document_task.delay") as delay:
        handle(
            "document-1",
            dataset_id="dataset-1",
            doc_form="paragraph",
            file_id="file-1",
        )

    delay.assert_called_once_with("document-1", "dataset-1", "paragraph", "file-1")
