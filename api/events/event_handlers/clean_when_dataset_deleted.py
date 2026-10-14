from events.dataset_event import dataset_was_deleted
from extensions.ext_database import db
from models import Dataset
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from tasks.clean_dataset_task import clean_dataset_task


@dataset_was_deleted.connect
def handle(sender: Dataset, **kwargs):
    dataset = sender
    doc_form = get_dataset_doc_form(dataset, session=db.session())
    if not doc_form or not dataset.indexing_technique:
        return
    clean_dataset_task.delay(
        dataset.id,
        dataset.tenant_id,
        dataset.indexing_technique,
        dataset.index_struct,
        dataset.collection_binding_id,
        doc_form,
        dataset.pipeline_id,
    )
