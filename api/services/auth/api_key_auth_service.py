import json

from sqlalchemy import select

from core.db.session_factory import session_factory
from core.helper import encrypter
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_factory import ApiKeyAuthFactory


class ApiKeyAuthService:
    @staticmethod
    def get_provider_auth_list(tenant_id: str):
        with session_factory.create_session() as session:
            data_source_api_key_bindings = session.scalars(
                select(DataSourceApiKeyAuthBinding).where(
                    DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.disabled.is_(False)
                )
            ).all()
            return data_source_api_key_bindings

    @staticmethod
    def create_provider_auth(tenant_id: str, args: dict):
        auth_result = ApiKeyAuthFactory(args["provider"], args["credentials"]).validate_credentials()
        if auth_result:
            with session_factory.create_session() as session, session.begin():
                # Encrypt the api key
                api_key = encrypter.encrypt_token(tenant_id, args["credentials"]["config"]["api_key"])
                args["credentials"]["config"]["api_key"] = api_key

                data_source_api_key_binding = DataSourceApiKeyAuthBinding(
                    tenant_id=tenant_id, category=args["category"], provider=args["provider"]
                )
                data_source_api_key_binding.credentials = json.dumps(args["credentials"], ensure_ascii=False)
                session.add(data_source_api_key_binding)

    @staticmethod
    def get_auth_credentials(tenant_id: str, category: str, provider: str):
        with session_factory.create_session() as session:
            data_source_api_key_bindings = (
                session.query(DataSourceApiKeyAuthBinding)
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
        with session_factory.create_session() as session, session.begin():
            data_source_api_key_binding = (
                session.query(DataSourceApiKeyAuthBinding)
                .where(DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.id == binding_id)
                .first()
            )
            if data_source_api_key_binding:
                session.delete(data_source_api_key_binding)

    @classmethod
    def validate_api_key_auth_args(cls, args):
        if "category" not in args or not args["category"]:
            raise ValueError("category is required")
        if "provider" not in args or not args["provider"]:
            raise ValueError("provider is required")
        if "credentials" not in args or not args["credentials"]:
            raise ValueError("credentials is required")
        if not isinstance(args["credentials"], dict):
            raise ValueError("credentials must be a dictionary")
        if "auth_type" not in args["credentials"] or not args["credentials"]["auth_type"]:
            raise ValueError("auth_type is required")
