import json
import random
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Union, Optional

import httpx

from core.helper import ssrf_proxy
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.account import Account, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetCollectionBinding,
    DatasetPermission,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment, ExternalApiTemplates, ExternalKnowledgeBindings,
)
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.entities.external_knowledge_entities.external_knowledge_entities import Authorization, ApiTemplateSetting
from services.errors.dataset import DatasetNameDuplicateError
from tasks.external_document_indexing_task import external_document_indexing_task


class ExternalDatasetService:

    @staticmethod
    def get_external_api_templates(page, per_page, tenant_id, search=None) -> tuple[list[ExternalApiTemplates], int]:
        query = ExternalApiTemplates.query.filter(ExternalApiTemplates.tenant_id == tenant_id).order_by(
            ExternalApiTemplates.created_at.desc()
        )
        if search:
            query = query.filter(ExternalApiTemplates.name.ilike(f'%{search}%'))

        api_templates = query.paginate(
            page=page,
            per_page=per_page,
            max_per_page=100,
            error_out=False
        )

        return api_templates.items, api_templates.total

    @classmethod
    def validate_api_list(cls, api_settings: dict):
        if not api_settings:
            raise ValueError('api list is empty')
        if 'endpoint' not in api_settings and not api_settings['endpoint']:
            raise ValueError('endpoint is required')
        if 'api_key' not in api_settings and not api_settings['api_key']:
            raise ValueError('api_key is required')

    @staticmethod
    def create_api_template(tenant_id: str, user_id: str, args: dict) -> ExternalApiTemplates:
        api_template = ExternalApiTemplates(
            tenant_id=tenant_id,
            created_by=user_id,
            updated_by=user_id,
            name=args.get('name'),
            description=args.get('description', ''),
            settings=json.dumps(args.get('settings'), ensure_ascii=False),
        )

        db.session.add(api_template)
        db.session.commit()
        return api_template

    @staticmethod
    def get_api_template(api_template_id: str) -> ExternalApiTemplates:
        return ExternalApiTemplates.query.filter_by(
            id=api_template_id
        ).first()

    @staticmethod
    def update_api_template(tenant_id, user_id, api_template_id, args) -> ExternalApiTemplates:
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')

        api_template.name = args.get('name')
        api_template.description = args.get('description', '')
        api_template.settings = json.dumps(args.get('settings'), ensure_ascii=False)
        api_template.updated_by = user_id
        api_template.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.session.commit()

        return api_template

    @staticmethod
    def delete_api_template(tenant_id: str, api_template_id: str):
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')

        db.session.delete(api_template)
        db.session.commit()

    @staticmethod
    def external_api_template_use_check(api_template_id: str) -> bool:
        count = ExternalKnowledgeBindings.query.filter_by(
            external_api_template_id=api_template_id
        ).count()
        if count > 0:
            return True
        return False

    @staticmethod
    def get_external_knowledge_binding_with_dataset_id(tenant_id: str, dataset_id: str) -> ExternalKnowledgeBindings:
        external_knowledge_binding = ExternalKnowledgeBindings.query.filter_by(
            dataset_id=dataset_id,
            tenant_id=tenant_id
        ).first()
        if not external_knowledge_binding:
            raise ValueError('external knowledge binding not found')
        return external_knowledge_binding

    @staticmethod
    def document_create_args_validate(tenant_id: str, api_template_id: str, process_parameter: dict):
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')
        settings = json.loads(api_template.settings)
        for settings in settings:
            custom_parameters = settings.get('document_process_setting')
            if custom_parameters:
                for parameter in custom_parameters:
                    if parameter.get('required', False) and not process_parameter.get(parameter.get('name')):
                        raise ValueError(f'{parameter.get("name")} is required')

    @staticmethod
    def init_external_dataset(tenant_id: str, user_id: str, args: dict, created_from: str = 'web'):
        api_template_id = args.get('api_template_id')

        data_source = args.get('data_source')
        if data_source is None:
            raise ValueError('data source is required')

        process_parameter = args.get('process_parameter')
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')

        dataset = Dataset(
            tenant_id=tenant_id,
            name=args.get('name'),
            description=args.get('description', ''),
            provider='external',
            created_by=user_id,
        )

        db.session.add(dataset)
        db.session.flush()

        position = DocumentService.get_documents_position(dataset.id)
        batch = time.strftime('%Y%m%d%H%M%S') + str(random.randint(100000, 999999))
        document_ids = []
        if data_source["type"] == "upload_file":
            upload_file_list = data_source["info_list"]['file_info_list']['file_ids']
            for file_id in upload_file_list:
                file = db.session.query(UploadFile).filter(
                    UploadFile.tenant_id == dataset.tenant_id,
                    UploadFile.id == file_id
                ).first()
                if file:
                    data_source_info = {
                        "upload_file_id": file_id,
                    }
                    document = Document(
                        tenant_id=dataset.tenant_id,
                        dataset_id=dataset.id,
                        position=position,
                        data_source_type=data_source["type"],
                        data_source_info=json.dumps(data_source_info),
                        batch=batch,
                        name=file.name,
                        created_from=created_from,
                        created_by=user_id,
                    )
                    position += 1
                    db.session.add(document)
                    db.session.flush()
                    document_ids.append(document.id)
        db.session.commit()
        external_document_indexing_task.delay(dataset.id, api_template_id, data_source, process_parameter)

        return dataset

    @staticmethod
    def process_external_api(settings: ApiTemplateSetting,
                             files: Union[None, dict[str, Any]]) -> httpx.Response:
        """
        do http request depending on api bundle
        """

        kwargs = {
            'url': settings.url,
            'headers': settings.headers,
            'follow_redirects': True,
        }

        response = getattr(ssrf_proxy, settings.request_method)(data=settings.params, files=files, **kwargs)

        return response

    @staticmethod
    def assembling_headers(authorization: Authorization, headers: Optional[dict] = None) -> dict[str, Any]:
        authorization = deepcopy(authorization)
        if headers:
            headers = deepcopy(headers)
        else:
            headers = {}
        if authorization.type == 'api-key':
            if authorization.config is None:
                raise ValueError('authorization config is required')

            if authorization.config.api_key is None:
                raise ValueError('api_key is required')

            if not authorization.config.header:
                authorization.config.header = 'Authorization'

            if authorization.config.type == 'bearer':
                headers[authorization.config.header] = f'Bearer {authorization.config.api_key}'
            elif authorization.config.type == 'basic':
                headers[authorization.config.header] = f'Basic {authorization.config.api_key}'
            elif authorization.config.type == 'custom':
                headers[authorization.config.header] = authorization.config.api_key

        return headers

    @staticmethod
    def get_api_template_settings(settings: dict) -> ApiTemplateSetting:
        return ApiTemplateSetting.parse_obj(settings)

    @staticmethod
    def create_external_dataset(tenant_id: str, user_id: str, args: dict) -> Dataset:
        # check if dataset name already exists
        if Dataset.query.filter_by(name=args.get('name'), tenant_id=tenant_id).first():
            raise DatasetNameDuplicateError(f"Dataset with name {args.get('name')} already exists.")
        api_template = ExternalApiTemplates.query.filter_by(
            id=args.get('api_template_id'),
            tenant_id=tenant_id
        ).first()

        if api_template is None:
            raise ValueError('api template not found')

        dataset = Dataset(
            tenant_id=tenant_id,
            name=args.get('name'),
            description=args.get('description', ''),
            provider='external',
            created_by=user_id,
        )

        db.session.add(dataset)
        db.session.flush()

        external_knowledge_binding = ExternalKnowledgeBindings(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            external_api_template_id=args.get('api_template_id'),
            external_knowledge_id=args.get('external_knowledge_id'),
            created_by=user_id,
        )
        db.session.add(external_knowledge_binding)

        db.session.commit()

        return dataset

    @staticmethod
    def fetch_external_knowledge_retrival(tenant_id: str,
                                          dataset_id: str,
                                          query: str,
                                          external_retrival_parameters: dict):
        external_knowledge_binding = ExternalKnowledgeBindings.query.filter_by(
            dataset_id=dataset_id,
            tenant_id=tenant_id
        ).first()
        if not external_knowledge_binding:
            raise ValueError('external knowledge binding not found')

        external_api_template = ExternalApiTemplates.query.filter_by(
            id=external_knowledge_binding.external_api_template_id
        ).first()
        if not external_api_template:
            raise ValueError('external api template not found')

        settings = json.loads(external_api_template.settings)
        headers = {}
        if settings.get('api_token'):
            headers['Authorization'] = f"Bearer {settings.get('api_token')}"

        external_retrival_parameters['query'] = query

        api_template_setting = {
            'url': f"{settings.get('endpoint')}/dify/external-knowledge/retrival-documents",
            'request_method': 'post',
            'headers': settings.get('headers'),
            'params': external_retrival_parameters
        }
        response = ExternalDatasetService.process_external_api(
            ApiTemplateSetting(**api_template_setting), None
        )
