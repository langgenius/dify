from events.document_event import document_was_deleted
from tasks.clean_document_task import clean_document_task


@document_was_deleted.connect
def handle(sender, **kwargs):
    document_id = sender
    dataset_id = kwargs.get("dataset_id")
    doc_form = kwargs.get("doc_form")
    file_id = kwargs.get("file_id")
    if not dataset_id or not doc_form:
        return
    clean_document_task.delay(document_id, dataset_id, doc_form, file_id)
