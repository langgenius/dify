import json
from collections.abc import Mapping
from typing import Annotated, TypeVar

from pydantic import StringConstraints, TypeAdapter
from sqlalchemy import select
from typing_extensions import TypedDict

from core.helper import encrypter
from extensions.ext_database import db
from models.source import DataSourceApiKeyAuthBinding
from services.auth.api_key_auth_base import ApiKeyAuthCredentials
from services.auth.api_key_auth_factory import ApiKeyAuthFactory
from services.auth.auth_type import AuthProvider

NonEmptyString = Annotated[str, StringConstraints(min_length=1)]
ValidatedPayload = TypeVar("ValidatedPayload")


class ApiKeyAuthCreateArgs(TypedDict):
    category: NonEmptyString
    provider: NonEmptyString
    credentials: ApiKeyAuthCredentials


AUTH_CREDENTIALS_ADAPTER = TypeAdapter(ApiKeyAuthCredentials)
AUTH_CREATE_ARGS_ADAPTER = TypeAdapter(ApiKeyAuthCreateArgs)


class ApiKeyAuthService:
    @staticmethod
    def get_provider_auth_list(tenant_id: str) -> list[DataSourceApiKeyAuthBinding]:
        data_source_api_key_bindings = db.session.scalars(
            select(DataSourceApiKeyAuthBinding).where(
                DataSourceApiKeyAuthBinding.tenant_id == tenant_id, DataSourceApiKeyAuthBinding.disabled.is_(False)
            )
        ).all()
        return list(data_source_api_key_bindings)

    @classmethod
    def create_provider_auth(cls, tenant_id: str, args: Mapping[str, object] | ApiKeyAuthCreateArgs) -> None:
        validated_args = cls.validate_api_key_auth_args(args)
        auth_result = ApiKeyAuthFactory(
            validated_args["provider"], validated_args["credentials"]
        ).validate_credentials()
        if auth_result:
            api_key_value = validated_args["credentials"]["config"].get("api_key")
            if api_key_value is None:
                raise ValueError("credentials config api_key is required")
            encrypted_api_key = encrypter.encrypt_token(tenant_id, api_key_value)
            validated_args["credentials"]["config"]["api_key"] = encrypted_api_key

            data_source_api_key_binding = DataSourceApiKeyAuthBinding(
                tenant_id=tenant_id,
                category=validated_args["category"],
                provider=validated_args["provider"],
            )
            data_source_api_key_binding.credentials = json.dumps(validated_args["credentials"], ensure_ascii=False)
            db.session.add(data_source_api_key_binding)
            db.session.commit()

    @staticmethod
    def get_auth_credentials(tenant_id: str, category: str, provider: AuthProvider) -> ApiKeyAuthCredentials | None:
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
        raw_credentials = json.loads(data_source_api_key_bindings.credentials)
        return ApiKeyAuthService._validate_credentials_payload(raw_credentials)

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

    @classmethod
    def validate_api_key_auth_args(cls, args: Mapping[str, object] | None) -> ApiKeyAuthCreateArgs:
        return cls._validate_payload(AUTH_CREATE_ARGS_ADAPTER, args)

    @staticmethod
    def _validate_credentials_payload(raw_credentials: object) -> ApiKeyAuthCredentials:
        return ApiKeyAuthService._validate_payload(AUTH_CREDENTIALS_ADAPTER, raw_credentials)

    @staticmethod
    def _validate_payload(adapter: TypeAdapter[ValidatedPayload], payload: object) -> ValidatedPayload:
        return adapter.validate_python(payload)
