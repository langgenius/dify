import uuid
from typing import List

from flask_login import current_user
from sqlalchemy import func
from werkzeug.exceptions import NotFound

from extensions.ext_database import db
from models.dataset import Dataset
from models.model import App, Tag, TagBinding
from models.source import DataSourceApiKeyAuthBinding


class ApiKeyAuthService:

    @staticmethod
    def get_provider_auth_list(tenant_id: str) -> list:
        data_source_api_key_bindings = db.session.query(DataSourceApiKeyAuthBinding).filter(
            DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
            DataSourceApiKeyAuthBinding.disabled.is_(False)
        ).all()
        return data_source_api_key_bindings

    @staticmethod
    def create_provider_auth(tenant_id: str, args: dict) -> DataSourceApiKeyAuthBinding:
        data_source_api_key_binding = DataSourceApiKeyAuthBinding()
        data_source_api_key_binding.tenant_id = tenant_id
        data_source_api_key_binding.category = args['category']
        data_source_api_key_binding.provider = args['provider']
        data_source_api_key_binding.credentials = args['credential']
        db.session.add(data_source_api_key_binding)
        db.session.commit()
        return data_source_api_key_binding
        pass
