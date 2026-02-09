import json

from sqlalchemy import select

from core.helper import encrypter
from extensions.ext_database import db
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_factory import ApiKeyAuthFactory


class ApiKeyAuthService:
    @staticmethod
    def get_provider_auth_list(tenant_id: str):
        data_source_api_key_bindings = db.session.scalars(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.disabled.is_(False)
            )
        ).all()
        return data_source_api_key_bindings

    @staticmethod
    def create_provider_auth(tenant_id: str, args: dict):
        auth_result = ApiKeyAuthFactory(args["provider"], args["credentials"]).validate_credentials()
        if auth_result:
            # Encrypt the api key
            api_key = encrypter.encrypt_token(tenant_id, args["credentials"]["config"]["api_key"])
            args["credentials"]["config"]["api_key"] = api_key

            data_source_api_key_binding = DataSourceApiKeyAuthBinding(
                tenant_id=tenant_id, category=args["category"], provider=args["provider"]
            )
            data_source_api_key_binding.credentials = json.dumps(args["credentials"], ensure_ascii=False)
            db.session.add(data_source_api_key_binding)
            db.session.commit()

    @staticmethod
    def get_auth_credentials(tenant_id: str, category: str, provider: str):
        data_source_api_key_bindings = (
            db.session.query(DataSourceApiKeyAuthBinding)
            .where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
                DataSourceApiKeyAuthBinding.category == category,
                DataSourceApiKeyAuthBinding.provider == provider,
                DataSourceApiKeyAuthBinding.disabled.is_(False),
            )
            .first()
        )
        if not data_source_api_key_bindings:
            return None
        if not data_source_api_key_bindings.credentials:
            return None
        credentials = json.loads(data_source_api_key_bindings.credentials)
        return credentials

    @staticmethod
    def delete_provider_auth(tenant_id: str, binding_id: str):
        data_source_api_key_binding = (
            db.session.query(DataSourceApiKeyAuthBinding)
            .where(DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.id == binding_id)
            .first()
        )
        if data_source_api_key_binding:
            db.session.delete(data_source_api_key_binding)
            db.session.commit()

    @classmethod
    def validate_api_key_auth_args(cls, args):
        if "category" not in args or not args["category"]:
            raise ValueError("类别为必填项")
        if "provider" not in args or not args["provider"]:
            raise ValueError("提供商为必填项")
        if "credentials" not in args or not args["credentials"]:
            raise ValueError("凭据为必填项")
        if not isinstance(args["credentials"], dict):
            raise ValueError("凭据必须为字典类型")
        if "auth_type" not in args["credentials"] or not args["credentials"]["auth_type"]:
            raise ValueError("auth_type 为必填项")
