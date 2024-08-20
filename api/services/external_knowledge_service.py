import json
from datetime import datetime, timezone

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
    def validate_api_list(cls, api_settings: list[dict]):
        if not api_settings:
            raise ValueError('api list is empty')
        for api_settings_dict in api_settings:
            if not api_settings_dict.get('method'):
                raise ValueError('api name is required')

            if not api_settings_dict.get('url'):
                raise ValueError('api url is required')

            if api_settings_dict.get('authorization'):
                if not api_settings_dict.get('authorization').get('type'):
                    raise ValueError('authorization type is required')
                if api_settings_dict.get('authorization').get('type') == 'bearer':
                    if not api_settings_dict.get('authorization').get('api_key'):
                        raise ValueError('authorization token is required')
                if api_settings_dict.get('authorization').get('type') == 'custom':
                    if not api_settings_dict.get('authorization').get('header'):
                        raise ValueError('authorization header is required')

            if api_settings_dict.get('method') in ['create', 'update']:
                if not api_settings_dict.get('callback_setting'):
                    raise ValueError('callback_setting is required for create and update method')

    @staticmethod
    def create_api_template(tenant_id: str, user_id: str, args: dict) -> ExternalApiTemplates:
        api_template = ExternalApiTemplates(
            tenant_id=tenant_id,
            created_by=user_id,
            updated_by=user_id,
            name=args.get('name'),
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
    def document_create_args_validate(tenant_id: str, api_template_id: str, process_parameter: dict):
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')
        settings = json.loads(api_template.settings)
        for settings in settings:
            if settings.get('method') == 'create':
                parameters = settings.get('parameters')
                for parameter in parameters:
                    if parameter.get('required') and not process_parameter.get(parameter.get('name')):
                        raise ValueError(f'{parameter.get("name")} is required')

    @staticmethod
    def init_external_dataset(tenant_id: str, user_id: str, args: dict):
        api_template_id = args.get('api_template_id')
        data_source = args.get('data_source')
        process_parameter = args.get('process_parameter')
        api_template = ExternalApiTemplates.query.filter_by(
            id=api_template_id,
            tenant_id=tenant_id
        ).first()
        if api_template is None:
            raise ValueError('api template not found')
        settings = json.loads(api_template.settings)
        for settings in settings:
            if settings.get('method') == 'create':

                ExternalDatasetService.process_external_api(api_template_id, data_source, process_parameter)
                break
        # save dataset
        dataset = Dataset(
            tenant_id=tenant_id,
            name=args.get('name'),
            description=args.get('description', ''),
            provider='external',
            created_by=user_id,
        )

        db.session.add(dataset)
        db.session.commit()

        external_document_indexing_task.delay(dataset.id, api_template_id, data_source, process_parameter)

        return dataset

    @staticmethod
    def process_external_api(self, headers: dict[str, Any]) -> httpx.Response:
        """
        do http request depending on api bundle
        """
        kwargs = {
            'url': self.server_url,
            'headers': headers,
            'params': self.params,
            'timeout': (self.timeout.connect, self.timeout.read, self.timeout.write),
            'follow_redirects': True,
        }

        if self.method in ('get', 'head', 'post', 'put', 'delete', 'patch'):
            response = getattr(ssrf_proxy, self.method)(data=self.body, files=self.files, **kwargs)
        else:
            raise ValueError(f'Invalid http method {self.method}')
        return response