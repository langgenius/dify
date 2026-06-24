import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import scoped_session
from sqlalchemy.orm import Session

from core.helper import encrypter
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_factory import ApiKeyAuthFactory


class ApiKeyAuthService:
    @staticmethod
    def get_provider_auth_list(session: Session, tenant_id: str):
        data_source_api_key_bindings = session.scalars(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.disabled.is_(False)
            )
        ).all()
        return data_source_api_key_bindings

    @staticmethod
    def create_provider_auth(session: Session, tenant_id: str, args: dict[str, Any]):
        auth_result = ApiKeyAuthFactory(args["provider"], args["credentials"]).validate_credentials()
        if auth_result:
            # Encrypt the api key
            api_key = encrypter.encrypt_token(tenant_id, args["credentials"]["config"]["api_key"])
            args["credentials"]["config"]["api_key"] = api_key

            data_source_api_key_binding = DataSourceApiKeyAuthBinding(
                tenant_id=tenant_id, category=args["category"], provider=args["provider"]
            )
            data_source_api_key_binding.credentials = json.dumps(args["credentials"], ensure_ascii=False)
            session.add(data_source_api_key_binding)
            session.commit()

    @staticmethod
    def get_auth_credentials(session: Session, tenant_id: str, category: str, provider: str):
        data_source_api_key_bindings = session.scalar(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
                DataSourceApiKeyAuthBinding.category == category,
                DataSourceApiKeyAuthBinding.provider == provider,
                DataSourceApiKeyAuthBinding.disabled.is_(False),
            )
        )
        if not data_source_api_key_bindings:
            return None
        if not data_source_api_key_bindings.credentials:
            return None
        credentials = json.loads(data_source_api_key_bindings.credentials)
        return credentials

    @staticmethod
    def delete_provider_auth(session: Session, tenant_id: str, binding_id: str):
        data_source_api_key_binding = session.scalar(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
                DataSourceApiKeyAuthBinding.id == binding_id,
            )
        )
        if data_source_api_key_binding:
            session.delete(data_source_api_key_binding)
            session.commit()

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
