from events.dataset_event import dataset_was_deleted
from models import Dataset
from tasks.clean_dataset_task import clean_dataset_task


@dataset_was_deleted.connect
def handle(sender: Dataset, **kwargs):
    dataset = sender
    # `clean_dataset_task` can recover a missing doc_form before selecting the
    # cleanup processor, so only missing indexing_technique still blocks
    # dispatch here.
    if not dataset.indexing_technique:
        return
    clean_dataset_task.delay(
        dataset.id,
        dataset.tenant_id,
        dataset.indexing_technique,
        dataset.index_struct,
        dataset.collection_binding_id,
        dataset.doc_form,
        dataset.pipeline_id,
    )
