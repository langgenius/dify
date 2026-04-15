import json
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import select

from core.helper import encrypter
from extensions.ext_database import db
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

    @classmethod
    def from_dict(cls, args: dict[str, Any] | None) -> None:
        """Validate a raw dict and raise ValueError with backward-compatible messages."""
        if not args or not isinstance(args, dict):
            raise ValueError("category is required")

        category = args.get("category")
        if not category:
            raise ValueError("category is required")

        provider = args.get("provider")
        if not provider:
            raise ValueError("provider is required")

        credentials = args.get("credentials")
        if not credentials:
            raise ValueError("credentials is required")

        if not isinstance(credentials, dict):
            raise ValueError("credentials must be a dictionary")

        auth_type = credentials.get("auth_type")
        if not auth_type:
            raise ValueError("auth_type is required")


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
    def create_provider_auth(tenant_id: str, args: dict[str, Any]):
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
        data_source_api_key_bindings = db.session.scalar(
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
    def delete_provider_auth(tenant_id: str, binding_id: str):
        data_source_api_key_binding = db.session.scalar(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id,
                DataSourceApiKeyAuthBinding.id == binding_id,
            )
        )
        if data_source_api_key_binding:
            db.session.delete(data_source_api_key_binding)
            db.session.commit()

    @classmethod
    def validate_api_key_auth_args(cls, args: dict[str, Any] | None) -> None:
        """Validate API key auth args using Pydantic for type-safe validation."""
        ApiKeyAuthArgs.from_dict(args)
