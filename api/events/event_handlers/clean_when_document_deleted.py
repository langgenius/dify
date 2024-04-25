from events.document_event import document_was_deleted
from tasks.clean_document_task import clean_document_task


@document_was_deleted.connect
def handle(sender, **kwargs):
    document_id = sender
    dataset_id = kwargs.get('dataset_id')
    doc_form = kwargs.get('doc_form')
    clean_document_task.delay(document_id, dataset_id, doc_form)
