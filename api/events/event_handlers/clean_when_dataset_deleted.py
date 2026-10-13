from events.dataset_event import dataset_was_deleted
from extensions.ext_database import db
from models import Dataset
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form
from tasks.clean_dataset_task import clean_dataset_task


@dataset_was_deleted.connect
def handle(sender: Dataset, **kwargs):
    dataset = sender
    # Always schedule cleanup: empty datasets (no chunk structure, no documents) and
    # datasets without an indexing technique still own rows such as process rules,
    # queries, metadata and the knowledge pipeline. clean_dataset_task falls back to
    # the paragraph index when doc_form is missing.
    doc_form = get_dataset_doc_form(dataset, session=db.session())
    clean_dataset_task.delay(
        dataset.id,
        dataset.tenant_id,
        dataset.indexing_technique,
        dataset.index_struct,
        dataset.collection_binding_id,
        doc_form,
        dataset.pipeline_id,
    )
