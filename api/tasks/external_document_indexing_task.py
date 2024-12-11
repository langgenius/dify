import json
import logging
import time

import click
from celery import shared_task

from core.indexing_runner import DocumentIsPausedError
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset, ExternalKnowledgeApis
from models.model import UploadFile
from services.external_knowledge_service import ExternalDatasetService


@shared_task(queue="dataset")
def external_document_indexing_task(
    dataset_id: str, external_knowledge_api_id: str, data_source: dict, process_parameter: dict
):
    """
    Async process document
    :param dataset_id:
    :param external_knowledge_api_id:
    :param data_source:
    :param process_parameter:
    Usage: external_document_indexing_task.delay(dataset_id, document_id)
    """
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        logging.info(
            click.style("Processed external dataset: {} failed, dataset not exit.".format(dataset_id), fg="red")
        )
        return

    # get external api template
    external_knowledge_api = (
        db.session.query(ExternalKnowledgeApis)
        .filter(
            ExternalKnowledgeApis.id == external_knowledge_api_id, ExternalKnowledgeApis.tenant_id == dataset.tenant_id
        )
        .first()
    )

    if not external_knowledge_api:
        logging.info(
            click.style(
                "Processed external dataset: {} failed, api template: {} not exit.".format(
                    dataset_id, external_knowledge_api_id
                ),
                fg="red",
            )
        )
        return
    files = {}
    if data_source["type"] == "upload_file":
        upload_file_list = data_source["info_list"]["file_info_list"]["file_ids"]
        for file_id in upload_file_list:
            file = (
                db.session.query(UploadFile)
                .filter(UploadFile.tenant_id == dataset.tenant_id, UploadFile.id == file_id)
                .first()
            )
            if file:
                files[file.id] = (file.name, storage.load_once(file.key), file.mime_type)
    try:
        settings = ExternalDatasetService.get_external_knowledge_api_settings(
            json.loads(external_knowledge_api.settings)
        )
        # assemble headers
        headers = ExternalDatasetService.assembling_headers(settings.authorization, settings.headers)

        # do http request
        response = ExternalDatasetService.process_external_api(settings, headers, process_parameter, files)
        job_id = response.json().get("job_id")
        if job_id:
            # save job_id to dataset
            dataset.job_id = job_id
            db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Processed external dataset: {} successful, latency: {}".format(dataset.id, end_at - start_at),
                fg="green",
            )
        )
    except DocumentIsPausedError as ex:
        logging.info(click.style(str(ex), fg="yellow"))

    except Exception:
        pass
