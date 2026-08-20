"""Data-source API-key authentication binding application service and ports."""

from collections.abc import Sequence
from dataclasses import replace
from typing import Protocol

from machinery.context import RequestContext
from machinery.errors import ActiveWorkspaceRequiredError
from services.entities.data_source_api_key_auth_entities import (
    DataSourceApiKeyAuthBindingCreate,
    DataSourceApiKeyAuthBindingRecord,
    DataSourceApiKeyAuthCredentials,
)


class DataSourceApiKeyAuthBindingRepository(Protocol):
    def list_enabled(self, workspace_id: str) -> Sequence[DataSourceApiKeyAuthBindingRecord]: ...

    def create(
        self,
        workspace_id: str,
        category: str,
        provider: str,
        credentials: DataSourceApiKeyAuthCredentials,
    ) -> None: ...

    def delete(self, workspace_id: str, binding_id: str) -> None: ...


class ApiKeyAuthCredentialValidator(Protocol):
    def validate(self, provider: str, credentials: DataSourceApiKeyAuthCredentials) -> bool: ...


class ApiKeyAuthCredentialEncryptor(Protocol):
    def encrypt(self, workspace_id: str, token: str) -> str: ...


class DataSourceApiKeyAuthService:
    def __init__(
        self,
        *,
        bindings: DataSourceApiKeyAuthBindingRepository,
        validator: ApiKeyAuthCredentialValidator,
        encryptor: ApiKeyAuthCredentialEncryptor,
    ) -> None:
        self._bindings = bindings
        self._validator = validator
        self._encryptor = encryptor

    def list_bindings(self, context: RequestContext) -> tuple[DataSourceApiKeyAuthBindingRecord, ...]:
        return tuple(self._bindings.list_enabled(self._require_workspace(context)))

    def create_binding(self, context: RequestContext, command: DataSourceApiKeyAuthBindingCreate) -> None:
        workspace_id = self._require_workspace(context)
        if not self._validator.validate(command.provider, command.credentials):
            return

        encrypted_credentials = replace(
            command.credentials,
            api_key=self._encryptor.encrypt(workspace_id, command.credentials.api_key),
        )

        self._bindings.create(
            workspace_id,
            command.category,
            command.provider,
            encrypted_credentials,
        )

    def delete_binding(self, context: RequestContext, binding_id: str) -> None:
        self._bindings.delete(self._require_workspace(context), binding_id)

    @staticmethod
    def _require_workspace(context: RequestContext) -> str:
        if context.active_workspace_id is None:
            raise ActiveWorkspaceRequiredError()
        return context.active_workspace_id
