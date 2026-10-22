"""Manage persisted trigger subscriptions outside repository transactions."""

import logging
from collections.abc import Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from typing import Any, Protocol

from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import ProviderConfigEncrypter, create_provider_encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import Subscription, UnsubscribeResult
from core.trigger.utils.endpoint import generate_plugin_trigger_endpoint_url
from models.enums import PermissionEnum
from models.provider_ids import TriggerProviderID
from services.trigger.subscription_query_service import TriggerSubscriptionSchemas

logger = logging.getLogger(__name__)


class TriggerSubscriptionError(Exception):
    """A trigger subscription operation could not be completed."""


class TriggerSubscriptionNotFoundError(TriggerSubscriptionError):
    """The subscription does not belong to the requested workspace and provider."""


class TriggerSubscriptionNameConflictError(TriggerSubscriptionError):
    """The provider already has a subscription with the requested name."""


class TriggerSubscriptionChangedError(TriggerSubscriptionError):
    """The persisted subscription changed while an operation was being prepared."""


class TriggerSubscriptionLimitError(TriggerSubscriptionError):
    """The provider has reached its subscription limit."""


class TriggerSubscriptionProviderError(TriggerSubscriptionError):
    """The plugin provider could not complete the requested operation."""


class TriggerSubscriptionInvalidError(TriggerSubscriptionError):
    """The requested operation or credentials are invalid for this subscription."""


@dataclass(frozen=True, slots=True)
class TriggerSubscriptionSnapshot:
    id: str
    name: str
    tenant_id: str
    user_id: str
    provider_id: str
    endpoint_id: str
    credential_type: CredentialType
    parameters: Mapping[str, Any]
    properties: Mapping[str, Any]
    credentials: Mapping[str, str]
    credential_expires_at: int
    expires_at: int
    visibility: PermissionEnum


class TriggerSubscriptionStore(Protocol):
    """Return detached records and complete each write in one bounded transaction."""

    def get(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionSnapshot | None: ...

    def create(self, *, subscription: TriggerSubscriptionSnapshot, max_count: int) -> None: ...

    def update(self, *, expected: TriggerSubscriptionSnapshot, replacement: TriggerSubscriptionSnapshot) -> None: ...

    def delete(self, *, expected: TriggerSubscriptionSnapshot) -> None: ...


class TriggerSubscriptionLocks(Protocol):
    def for_provider(self, *, tenant_id: str, provider_id: TriggerProviderID) -> AbstractContextManager[None]: ...

    def for_subscription(self, *, tenant_id: str, subscription_id: str) -> AbstractContextManager[None]: ...


class TriggerSubscriptionProviderGateway(Protocol):
    def get_schemas(
        self, *, tenant_id: str, provider_id: TriggerProviderID, credential_type: CredentialType
    ) -> TriggerSubscriptionSchemas: ...

    def validate_credentials(
        self, *, tenant_id: str, provider_id: TriggerProviderID, user_id: str, credentials: Mapping[str, Any]
    ) -> None: ...

    def subscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        endpoint: str,
        parameters: Mapping[str, Any],
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> Subscription: ...

    def unsubscribe(
        self,
        *,
        tenant_id: str,
        provider_id: TriggerProviderID,
        user_id: str,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> UnsubscribeResult: ...


class TriggerSubscriptionCacheInvalidator(Protocol):
    def __call__(self, *, tenant_id: str, provider_id: str, subscription_id: str) -> None: ...


class TriggerSubscriptionService:
    """Keep provider calls, credential processing and Redis outside repository transactions.

    TODO: The shared RSA key provider still owns a scoped DB session for encryption;
    remove that dependency when its tenant key reads return detached values.
    """

    def __init__(
        self,
        *,
        subscriptions: TriggerSubscriptionStore,
        providers: TriggerSubscriptionProviderGateway,
        locks: TriggerSubscriptionLocks,
        invalidate_cache: TriggerSubscriptionCacheInvalidator,
    ) -> None:
        self._subscriptions = subscriptions
        self._providers = providers
        self._locks = locks
        self._invalidate_cache = invalidate_cache

    def create(
        self,
        *,
        tenant_id: str,
        user_id: str,
        name: str,
        provider_id: TriggerProviderID,
        endpoint_id: str,
        credential_type: CredentialType,
        parameters: Mapping[str, Any],
        properties: Mapping[str, Any],
        credentials: Mapping[str, str],
        subscription_id: str,
        credential_expires_at: int,
        expires_at: int,
    ) -> Mapping[str, str]:
        schemas = self._providers.get_schemas(
            tenant_id=tenant_id, provider_id=provider_id, credential_type=credential_type
        )
        encrypted_credentials = (
            dict(self._credential_encrypter(tenant_id, schemas, credential_type).encrypt(credentials))
            if credential_type != CredentialType.UNAUTHORIZED
            else {}
        )
        subscription = TriggerSubscriptionSnapshot(
            id=subscription_id,
            name=name,
            tenant_id=tenant_id,
            user_id=user_id,
            provider_id=str(provider_id),
            endpoint_id=endpoint_id,
            credential_type=credential_type,
            parameters=dict(parameters),
            properties=dict(self._properties_encrypter(tenant_id, schemas).encrypt(properties)),
            credentials=encrypted_credentials,
            credential_expires_at=credential_expires_at,
            expires_at=expires_at,
            visibility=PermissionEnum.ALL_TEAM,
        )
        with self._locks.for_provider(tenant_id=tenant_id, provider_id=provider_id):
            self._subscriptions.create(subscription=subscription, max_count=10)
        return {"result": "success", "id": subscription_id}

    def update(
        self,
        *,
        tenant_id: str,
        subscription_id: str,
        name: str | None,
        credentials: Mapping[str, Any] | None,
        parameters: Mapping[str, Any] | None,
        properties: Mapping[str, Any] | None,
    ) -> None:
        snapshot = self._require(tenant_id=tenant_id, subscription_id=subscription_id)
        provider_id = TriggerProviderID(snapshot.provider_id)
        schemas = self._providers.get_schemas(
            tenant_id=tenant_id, provider_id=provider_id, credential_type=snapshot.credential_type
        )
        replacement = replace(snapshot, name=name if name is not None else snapshot.name)
        rename = name is not None and not any((credentials, parameters, properties))
        property_encrypter = self._properties_encrypter(tenant_id, schemas)
        if rename or snapshot.credential_type == CredentialType.UNAUTHORIZED:
            # Manual subscriptions only support name and properties. Empty
            # mappings retain the original rename/partial-update semantics.
            if properties is not None:
                replacement = replace(
                    replacement,
                    properties=dict(
                        property_encrypter.encrypt(
                            self._restore_hidden(properties, property_encrypter.decrypt(snapshot.properties))
                        )
                    ),
                )
        else:
            # TODO: Give remote unsubscribe/subscribe an idempotent operation owner;
            # the final snapshot check protects SQL, not concurrent provider side effects.
            credential_encrypter = self._credential_encrypter(tenant_id, schemas, snapshot.credential_type)
            original_credentials = credential_encrypter.decrypt(snapshot.credentials)
            original_properties = property_encrypter.decrypt(snapshot.properties)
            try:
                removed = self._providers.unsubscribe(
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    user_id=snapshot.user_id,
                    subscription=self._entity(snapshot, original_properties),
                    credentials=original_credentials,
                    credential_type=snapshot.credential_type,
                )
            except Exception as error:
                raise TriggerSubscriptionProviderError(
                    f"Failed to remove trigger subscription {subscription_id} from provider {provider_id}."
                ) from error
            if not removed.success:
                raise TriggerSubscriptionProviderError(
                    f"Provider {provider_id} rejected removal of trigger subscription {subscription_id}: "
                    f"{removed.message}"
                )
            restored_credentials = self._restore_hidden(credentials or original_credentials, original_credentials)
            new_parameters = parameters or snapshot.parameters
            try:
                created = self._providers.subscribe(
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    user_id=snapshot.user_id,
                    endpoint=generate_plugin_trigger_endpoint_url(snapshot.endpoint_id),
                    parameters=new_parameters,
                    credentials=restored_credentials,
                    credential_type=snapshot.credential_type,
                )
            except Exception as error:
                raise TriggerSubscriptionProviderError(
                    f"Failed to rebuild trigger subscription {subscription_id} with provider {provider_id}."
                ) from error
            replacement = replace(
                replacement,
                credentials=dict(credential_encrypter.encrypt(restored_credentials)),
                parameters=dict(new_parameters),
                properties=dict(
                    property_encrypter.encrypt(self._restore_hidden(created.properties, original_properties))
                ),
                expires_at=created.expires_at,
            )
        with self._locks.for_subscription(tenant_id=tenant_id, subscription_id=subscription_id):
            self._subscriptions.update(expected=snapshot, replacement=replacement)
        self._invalidate(snapshot)

    def delete(self, *, tenant_id: str, subscription_id: str) -> None:
        snapshot = self._require(tenant_id=tenant_id, subscription_id=subscription_id)
        provider_id = TriggerProviderID(snapshot.provider_id)
        schemas = self._providers.get_schemas(
            tenant_id=tenant_id, provider_id=provider_id, credential_type=snapshot.credential_type
        )
        if snapshot.credential_type in {CredentialType.API_KEY, CredentialType.OAUTH2}:
            try:
                self._providers.unsubscribe(
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    user_id=snapshot.user_id,
                    subscription=self._entity(snapshot, snapshot.properties),
                    credentials=self._credential_encrypter(tenant_id, schemas, snapshot.credential_type).decrypt(
                        snapshot.credentials
                    ),
                    credential_type=snapshot.credential_type,
                )
            except Exception:
                logger.exception("Failed to unsubscribe trigger subscription %s before deletion", subscription_id)
        with self._locks.for_subscription(tenant_id=tenant_id, subscription_id=subscription_id):
            self._subscriptions.delete(expected=snapshot)
        self._invalidate(snapshot)

    def verify(
        self,
        *,
        tenant_id: str,
        user_id: str,
        provider_id: TriggerProviderID,
        subscription_id: str,
        credentials: Mapping[str, Any],
    ) -> Mapping[str, bool]:
        snapshot = self._require(tenant_id=tenant_id, subscription_id=subscription_id)
        if snapshot.provider_id != str(provider_id):
            raise TriggerSubscriptionNotFoundError(f"Trigger subscription {subscription_id} not found.")
        if snapshot.credential_type != CredentialType.API_KEY:
            return {"verified": True}
        schemas = self._providers.get_schemas(
            tenant_id=tenant_id, provider_id=provider_id, credential_type=snapshot.credential_type
        )
        original_credentials = self._credential_encrypter(tenant_id, schemas, snapshot.credential_type).decrypt(
            snapshot.credentials
        )
        self._providers.validate_credentials(
            tenant_id=tenant_id,
            provider_id=provider_id,
            user_id=user_id,
            credentials=self._restore_hidden(credentials, original_credentials),
        )
        return {"verified": True}

    def _require(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionSnapshot:
        snapshot = self._subscriptions.get(tenant_id=tenant_id, subscription_id=subscription_id)
        if snapshot is None:
            raise TriggerSubscriptionNotFoundError(f"Trigger subscription {subscription_id} not found.")
        return snapshot

    def _invalidate(self, snapshot: TriggerSubscriptionSnapshot) -> None:
        self._invalidate_cache(
            tenant_id=snapshot.tenant_id, provider_id=snapshot.provider_id, subscription_id=snapshot.id
        )

    @staticmethod
    def _credential_encrypter(
        tenant_id: str, schemas: TriggerSubscriptionSchemas, credential_type: CredentialType
    ) -> ProviderConfigEncrypter:
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=schemas.credentials[credential_type],
            cache=NoOpProviderCredentialCache(),
        )
        return encrypter

    @staticmethod
    def _properties_encrypter(tenant_id: str, schemas: TriggerSubscriptionSchemas) -> ProviderConfigEncrypter:
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id, config=schemas.properties, cache=NoOpProviderCredentialCache()
        )
        return encrypter

    @staticmethod
    def _restore_hidden(values: Mapping[str, Any], original: Mapping[str, Any]) -> dict[str, Any]:
        return {
            key: original.get(key, UNKNOWN_VALUE) if value == HIDDEN_VALUE else value for key, value in values.items()
        }

    @staticmethod
    def _entity(snapshot: TriggerSubscriptionSnapshot, properties: Mapping[str, Any]) -> Subscription:
        return Subscription(
            expires_at=snapshot.expires_at,
            endpoint=generate_plugin_trigger_endpoint_url(snapshot.endpoint_id),
            parameters=snapshot.parameters,
            properties=properties,
        )
