import datetime
import json
import logging
import time

import click
from celery import shared_task

from configs import dify_config
from core.indexing_runner import DocumentIsPausedException, IndexingRunner
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import Dataset, Document, ExternalApiTemplates
from models.model import UploadFile
from services.external_knowledge_service import ExternalDatasetService
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
    files = {}
    if data_source["type"] == "upload_file":
        upload_file_list = data_source["info_list"]['file_info_list']['file_ids']
        for file_id in upload_file_list:
            file = db.session.query(UploadFile).filter(
                UploadFile.tenant_id == dataset.tenant_id,
                UploadFile.id == file_id
            ).first()
            if file:
                files[file.id] = (file.name, storage.load_once(file.key), file.mime_type)
    try:
        settings = ExternalDatasetService.get_api_template_settings(json.loads(api_template.settings))
        # assemble headers
        headers = ExternalDatasetService.assembling_headers(settings.authorization, settings.headers)

        # do http request
        response = ExternalDatasetService.process_external_api(settings, headers, process_parameter, files)
        job_id = response.json().get('job_id')
        if job_id:
            # save job_id to dataset
            dataset.job_id = job_id
            db.session.commit()

        end_at = time.perf_counter()
        logging.info(
            click.style('Processed external dataset: {} successful, latency: {}'.format(dataset.id, end_at - start_at), fg='green'))
    except DocumentIsPausedException as ex:
        logging.info(click.style(str(ex), fg='yellow'))

    except Exception:
        pass
