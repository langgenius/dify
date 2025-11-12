import logging

from celery import shared_task

from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def clean_uploaded_files_task(upload_file_ids: list[str]):
    """
    Asynchronously clean uploaded files from storage.
    This task is called after database records have been successfully deleted.

    Args:
        upload_file_ids: List of upload file IDs to delete from storage
    """
    if not upload_file_ids:
        return

    success_count = 0
    failed_count = 0

    for upload_file_id in upload_file_ids:
        try:
            upload_file = db.session.query(UploadFile).where(UploadFile.id == upload_file_id).first()

            if upload_file and upload_file.key:
                storage.delete(upload_file.key)
                success_count += 1

        except Exception:
            logger.exception("Failed to delete upload file %s", upload_file_id)
            failed_count += 1

    return {"total": len(upload_file_ids), "success": success_count, "failed": failed_count}
