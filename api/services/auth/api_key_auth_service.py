import json
from typing import cast

from pydantic import TypeAdapter
from sqlalchemy import select
from typing_extensions import TypedDict

from core.helper import encrypter
from extensions.ext_database import db
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_base import ApiKeyAuthCredentials
from services.auth.api_key_auth_factory import ApiKeyAuthFactory


class ApiKeyAuthCreateArgs(TypedDict):
    category: str
    provider: str
    credentials: ApiKeyAuthCredentials


AUTH_CREATE_ARGS_ADAPTER = TypeAdapter(ApiKeyAuthCreateArgs)
AUTH_CREDENTIALS_ADAPTER = TypeAdapter(dict[str, object])


class ApiKeyAuthService:
    @staticmethod
    def get_provider_auth_list(tenant_id: str) -> list[DataSourceApiKeyAuthBinding]:
        data_source_api_key_bindings = db.session.scalars(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.disabled.is_(False)
            )
        ).all()
        return list(data_source_api_key_bindings)

    @staticmethod
    def create_provider_auth(tenant_id: str, args: dict[str, object]) -> None:
        validated_args = ApiKeyAuthService.validate_api_key_auth_args(args)
        raw_credentials = ApiKeyAuthService._get_credentials_dict(args)
        auth_result = ApiKeyAuthFactory(
            validated_args["provider"], validated_args["credentials"]
        ).validate_credentials()
        if auth_result:
            api_key_value = validated_args["credentials"]["config"].get("api_key")
            if api_key_value is None:
                raise KeyError("api_key")
            api_key = encrypter.encrypt_token(tenant_id, api_key_value)
            raw_config = ApiKeyAuthService._get_config_dict(raw_credentials)
            raw_config["api_key"] = api_key

            data_source_api_key_binding = DataSourceApiKeyAuthBinding(
                tenant_id=tenant_id,
                category=validated_args["category"],
                provider=validated_args["provider"],
            )
            data_source_api_key_binding.credentials = json.dumps(raw_credentials, ensure_ascii=False)
            db.session.add(data_source_api_key_binding)
            db.session.commit()

    @staticmethod
    def get_auth_credentials(tenant_id: str, category: str, provider: str) -> dict[str, object] | None:
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
        return AUTH_CREDENTIALS_ADAPTER.validate_python(credentials)

    @staticmethod
    def delete_provider_auth(tenant_id: str, binding_id: str) -> None:
        data_source_api_key_binding = (
            db.session.query(DataSourceApiKeyAuthBinding)
            .where(DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.id == binding_id)
            .first()
        )
        if data_source_api_key_binding:
            db.session.delete(data_source_api_key_binding)
            db.session.commit()

    @staticmethod
    def validate_api_key_auth_args(args: dict[str, object] | None) -> ApiKeyAuthCreateArgs:
        if args is None:
            raise TypeError("argument of type 'NoneType' is not iterable")
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
        return AUTH_CREATE_ARGS_ADAPTER.validate_python(args)

    @staticmethod
    def _get_credentials_dict(args: dict[str, object]) -> dict[str, object]:
        credentials = args["credentials"]
        if not isinstance(credentials, dict):
            raise ValueError("credentials must be a dictionary")
        return cast(dict[str, object], credentials)

    @staticmethod
    def _get_config_dict(credentials: dict[str, object]) -> dict[str, object]:
        config = credentials["config"]
        if not isinstance(config, dict):
            raise TypeError(f"credentials['config'] must be a dictionary, got {type(config).__name__}")
        return cast(dict[str, object], config)
