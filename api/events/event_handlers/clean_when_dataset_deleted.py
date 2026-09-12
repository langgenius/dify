from events.dataset_event import dataset_was_deleted
from extensions.ext_database import db
from models import Dataset
from tasks.clean_dataset_task import clean_dataset_task


@dataset_was_deleted.connect
def handle(sender: Dataset, **kwargs):
    dataset = sender
    doc_form = dataset.get_doc_form(session=db.session())
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
        # The dataset row is gone by the time the task runs, so the graph
        # configuration has to travel with it or the graph cleanup cannot tell
        # which backend to purge.
        graph_index_setting=dataset.graph_index_setting,
    )
