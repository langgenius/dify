from events.dataset_event import dataset_was_deleted
from models import Dataset
from tasks.clean_dataset_task import clean_dataset_task


@dataset_was_deleted.connect
def handle(sender: Dataset, **kwargs):
    dataset = sender
    # Always dispatch the cleanup task, even when doc_form or indexing_technique
    # is empty. Datasets created in older Dify versions frequently have these
    # fields null, and the cleanup task already handles empty doc_form by
    # falling back to PARAGRAPH_INDEX (see clean_dataset_task.py).
    # The previous early-return skipped vector cleanup for exactly these
    # datasets, leaving orphaned collections in the vector store.
    clean_dataset_task.delay(
        dataset.id,
        dataset.tenant_id,
        dataset.indexing_technique,
        dataset.index_struct,
        dataset.collection_binding_id,
        dataset.doc_form,
        dataset.pipeline_id,
    )
