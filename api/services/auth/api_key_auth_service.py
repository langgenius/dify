import json
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper import encrypter
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_factory import ApiKeyAuthFactory


class ApiKeyAuthCredentials(BaseModel):
    """Credentials payload for API key authentication."""

    auth_type: str = Field(..., min_length=1)


class ApiKeyAuthArgs(BaseModel):
    """Validated arguments for creating an API key auth provider."""

    category: str = Field(..., min_length=1)
    provider: str = Field(..., min_length=1)
    credentials: ApiKeyAuthCredentials


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
    def validate_api_key_auth_args(cls, args: dict[str, Any] | None) -> None:
        """Validate API key auth args using Pydantic model_validate."""
        ApiKeyAuthArgs.model_validate(args)
