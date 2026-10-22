"""Short SQL transactions and Redis serialization for trigger subscription commands."""

import sqlite3
from collections.abc import Generator
from contextlib import contextmanager
from copy import deepcopy
from typing import override

from psycopg2.errors import UniqueViolation
from pymysql.err import IntegrityError as MySQLIntegrityError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models.provider_ids import TriggerProviderID
from models.trigger import TriggerSubscription, WorkflowPluginTrigger
from services.trigger.subscription_service import (
    TriggerSubscriptionChangedError,
    TriggerSubscriptionLimitError,
    TriggerSubscriptionLocks,
    TriggerSubscriptionNameConflictError,
    TriggerSubscriptionSnapshot,
    TriggerSubscriptionStore,
)


def _is_name_conflict(error: IntegrityError) -> bool:
    original = error.orig
    constraint = "unique_trigger_provider"
    if isinstance(original, UniqueViolation):
        return original.diag.constraint_name == constraint
    if isinstance(original, MySQLIntegrityError):
        if len(original.args) != 2 or original.args[0] != 1062 or not isinstance(original.args[1], str):
            return False
        key = original.args[1].rsplit(" for key ", 1)[-1]
        return key in (
            f"'{constraint}'",
            f"'trigger_subscriptions.{constraint}'",
            f"`{constraint}`",
            f"`trigger_subscriptions.{constraint}`",
        )
    if isinstance(original, sqlite3.IntegrityError):
        return original.sqlite_errorcode == sqlite3.SQLITE_CONSTRAINT_UNIQUE and str(original) == (
            "UNIQUE constraint failed: trigger_subscriptions.tenant_id, "
            "trigger_subscriptions.provider_id, trigger_subscriptions.name"
        )
    return False


class TriggerSubscriptionRepository(TriggerSubscriptionStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get(self, *, tenant_id: str, subscription_id: str) -> TriggerSubscriptionSnapshot | None:
        with self._session_factory() as session:
            row = session.scalar(
                select(TriggerSubscription).where(
                    TriggerSubscription.tenant_id == tenant_id, TriggerSubscription.id == subscription_id
                )
            )
            return self._snapshot(row) if row is not None else None

    @override
    def create(self, *, subscription: TriggerSubscriptionSnapshot, max_count: int) -> None:
        try:
            with self._session_factory.begin() as session:
                owner = (
                    TriggerSubscription.tenant_id == subscription.tenant_id,
                    TriggerSubscription.provider_id == subscription.provider_id,
                )
                count = session.scalar(select(func.count(TriggerSubscription.id)).where(*owner)) or 0
                if count >= max_count:
                    raise TriggerSubscriptionLimitError(
                        f"Maximum number of subscriptions ({max_count}) reached "
                        f"for provider {subscription.provider_id}."
                    )
                self._require_available_name(session, subscription)
                row = TriggerSubscription(
                    name=subscription.name,
                    tenant_id=subscription.tenant_id,
                    user_id=subscription.user_id,
                    provider_id=subscription.provider_id,
                    endpoint_id=subscription.endpoint_id,
                    credential_type=subscription.credential_type,
                    parameters=deepcopy(dict(subscription.parameters)),
                    properties=deepcopy(dict(subscription.properties)),
                    credentials=deepcopy(dict(subscription.credentials)),
                    credential_expires_at=subscription.credential_expires_at,
                    expires_at=subscription.expires_at,
                    visibility=subscription.visibility,
                )
                row.id = subscription.id
                session.add(row)
        except IntegrityError as error:
            if not _is_name_conflict(error):
                raise
            raise self._name_conflict(subscription) from error

    @override
    def update(self, *, expected: TriggerSubscriptionSnapshot, replacement: TriggerSubscriptionSnapshot) -> None:
        try:
            with self._session_factory.begin() as session:
                row = self._require_unchanged(session, expected)
                if replacement.name != expected.name:
                    self._require_available_name(session, replacement)
                row.name = replacement.name
                row.parameters = deepcopy(dict(replacement.parameters))
                row.properties = deepcopy(dict(replacement.properties))
                row.credentials = deepcopy(dict(replacement.credentials))
                row.credential_expires_at = replacement.credential_expires_at
                row.expires_at = replacement.expires_at
        except IntegrityError as error:
            if not _is_name_conflict(error):
                raise
            raise self._name_conflict(replacement) from error

    @override
    def delete(self, *, expected: TriggerSubscriptionSnapshot) -> None:
        with self._session_factory.begin() as session:
            row = self._require_unchanged(session, expected)
            session.execute(
                delete(WorkflowPluginTrigger).where(
                    WorkflowPluginTrigger.tenant_id == expected.tenant_id,
                    WorkflowPluginTrigger.subscription_id == expected.id,
                )
            )
            session.delete(row)

    @classmethod
    def _require_unchanged(cls, session: Session, expected: TriggerSubscriptionSnapshot) -> TriggerSubscription:
        row = session.scalar(
            select(TriggerSubscription)
            .where(TriggerSubscription.tenant_id == expected.tenant_id, TriggerSubscription.id == expected.id)
            .with_for_update()
        )
        # Compare in Python so database JSON/text collations cannot consider
        # different ciphertext or nested configuration values equivalent.
        if row is None or cls._snapshot(row) != expected:
            raise TriggerSubscriptionChangedError(f"Trigger subscription {expected.id} changed. Reload and retry.")
        return row

    @classmethod
    def _require_available_name(cls, session: Session, subscription: TriggerSubscriptionSnapshot) -> None:
        exists = session.scalar(
            select(TriggerSubscription.id)
            .where(
                TriggerSubscription.tenant_id == subscription.tenant_id,
                TriggerSubscription.provider_id == subscription.provider_id,
                TriggerSubscription.name == subscription.name,
                TriggerSubscription.id != subscription.id,
            )
            .limit(1)
        )
        if exists is not None:
            raise cls._name_conflict(subscription)

    @staticmethod
    def _name_conflict(subscription: TriggerSubscriptionSnapshot) -> TriggerSubscriptionNameConflictError:
        return TriggerSubscriptionNameConflictError(
            f"Subscription name '{subscription.name}' already exists for provider {subscription.provider_id}."
        )

    @staticmethod
    def _snapshot(row: TriggerSubscription) -> TriggerSubscriptionSnapshot:
        return TriggerSubscriptionSnapshot(
            id=row.id,
            name=row.name,
            tenant_id=row.tenant_id,
            user_id=row.user_id,
            provider_id=row.provider_id,
            endpoint_id=row.endpoint_id,
            credential_type=row.credential_type,
            parameters=deepcopy(row.parameters),
            properties=deepcopy(row.properties),
            credentials=deepcopy(row.credentials),
            credential_expires_at=row.credential_expires_at,
            expires_at=row.expires_at,
            visibility=row.visibility,
        )


class RedisTriggerSubscriptionLocks(TriggerSubscriptionLocks):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    @contextmanager
    def for_provider(self, *, tenant_id: str, provider_id: TriggerProviderID) -> Generator[None]:
        with self._redis.lock(f"trigger_provider_create_lock:{tenant_id}_{provider_id}", timeout=20):
            yield

    @override
    @contextmanager
    def for_subscription(self, *, tenant_id: str, subscription_id: str) -> Generator[None]:
        with self._redis.lock(f"trigger_subscription_update_lock:{tenant_id}_{subscription_id}", timeout=20):
            yield
