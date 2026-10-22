from sqlalchemy import select
from sqlalchemy.orm import Session

from extensions.ext_redis import redis_client
from models.dataset import Dataset


def dataset_operation_lock(dataset_id: str):
    """Serialize dataset deletion with document creation and indexing admission."""
    return redis_client.lock(f"add_document_lock_dataset_id_{dataset_id}", timeout=600)


def lock_dataset_row(session: Session, dataset_id: str) -> Dataset | None:
    """Lock a dataset row while changing state that can race with deletion."""
    return session.scalar(select(Dataset).where(Dataset.id == dataset_id).with_for_update())
