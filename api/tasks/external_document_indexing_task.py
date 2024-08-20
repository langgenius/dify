import datetime
import logging
import time

import click
from celery import shared_task

from configs import dify_config
from core.indexing_runner import DocumentIsPausedException, IndexingRunner
from extensions.ext_database import db
from models.dataset import Dataset, Document, ExternalApiTemplates
from models.model import UploadFile
from services.feature_service import FeatureService


@shared_task(queue='dataset')
def external_document_indexing_task(dataset_id: str, api_template_id: str, data_source: dict, process_parameter: dict):
    """
    Async process document
    :param dataset_id:
    :param api_template_id:
    :param data_source:
    :param process_parameter:
    Usage: external_document_indexing_task.delay(dataset_id, document_id)
    """
    documents = []
    start_at = time.perf_counter()

    dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        logging.info(click.style('Processed external dataset: {} failed, dataset not exit.'.format(dataset_id), fg='red'))
        return

    # get external api template
    api_template = db.session.query(ExternalApiTemplates).filter(
        ExternalApiTemplates.id == api_template_id,
        ExternalApiTemplates.tenant_id == dataset.tenant_id
    ).first()

    if not api_template:
        logging.info(click.style('Processed external dataset: {} failed, api template: {} not exit.'.format(dataset_id, api_template_id), fg='red'))
        return
    file_resource = []
    if data_source["type"] == "upload_file":
        upload_file_list = data_source["info_list"]['file_info_list']['file_ids']
        for file_id in upload_file_list:
            file = db.session.query(UploadFile).filter(
                UploadFile.tenant_id == dataset.tenant_id,
                UploadFile.id == file_id
            ).first()
            if file:
                file_resource.append(file)
    try:
        # assemble headers
        headers = self._assembling_headers()

        # do http request
        response = self._do_http_request(headers)
    except DocumentIsPausedException as ex:
        logging.info(click.style(str(ex), fg='yellow'))
    except Exception:
        pass
