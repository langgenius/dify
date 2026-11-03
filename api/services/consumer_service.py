"""Account consumer queries and personal App preferences without Studio admission.

Candidate discovery is not permission. Every App projection is filtered through
the existing deployment access policy, including Apps referenced by Connections.
Ports return detached, non-secret values and own short transactions.
"""

import base64
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from constants.end_user_connections import ConnectionCredentialType
from services.end_user_connections.entities import AccountConnectionContext
from services.end_user_connections.errors import ConnectionNotFoundError
from services.end_user_connections.management import ConnectionService
from services.web_identity_service import WebIdentityError, WebIdentityService
from services.web_passport_service import WebPassportTokenGateway


@dataclass(frozen=True, slots=True)
class ConsumerIdentity:
    account_id: str


class ConsumerApp(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    description: str
    mode: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    app_code: str
    is_favorite: bool
    last_used_at: datetime | None = Field(
        description="Creation time of the Account's latest retained published execution."
    )
    continuation: str = Field(exclude=True)


class ConsumerAppsQuery(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    view: Literal["recent", "favorites", "shared"] = "recent"
    name: str | None = Field(default=None, max_length=255)
    cursor: str | None = Field(default=None, max_length=2048)
    limit: int = Field(default=20, ge=1, le=100)


class ConsumerAppsPage(BaseModel):
    data: tuple[ConsumerApp, ...]
    has_more: bool
    next_cursor: str | None


class ConsumerConnectionKey(BaseModel):
    """Stable group selector; ownership is rechecked independently on every use."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1, max_length=255)
    connection_type: ConnectionCredentialType
    account_label: str | None = Field(min_length=1)
    connection_id: UUID | None

    @model_validator(mode="after")
    def require_one_group_identity(self) -> "ConsumerConnectionKey":
        if (self.account_label is None) == (self.connection_id is None):
            raise ValueError("A group requires either an account label or a Connection ID.")
        return self

    def encode(self) -> str:
        payload = [
            self.provider,
            self.connection_type,
            self.account_label,
            str(self.connection_id) if self.connection_id else None,
        ]
        return base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")

    @classmethod
    def decode(cls, value: str) -> "ConsumerConnectionKey":
        try:
            provider, connection_type, account_label, connection_id = json.loads(
                base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
            )
            key = cls(
                provider=provider,
                connection_type=connection_type,
                account_label=account_label,
                connection_id=connection_id,
            )
            if key.encode() != value:
                raise ValueError
            return key
        except (ValueError, TypeError):
            raise ValueError("Invalid Connection group key.") from None


@dataclass(frozen=True, slots=True)
class ConsumerConnectionGroup:
    key: ConsumerConnectionKey
    name: str


class ConsumerConnection(BaseModel):
    key: str = Field(description="Opaque group key for associated WebApp queries and disconnect.")
    provider: str
    connection_type: ConnectionCredentialType
    name: str = Field(description="Name of the group member with the smallest Connection ID.")
    account_label: str | None
    webapps_count: int = Field(ge=0, description="Number of distinct accessible WebApps associated with this group.")


class ConsumerConnectionsPage(BaseModel):
    data: tuple[ConsumerConnection, ...]
    has_more: bool
    next_cursor: str | None


class ConsumerAppNotFoundError(LookupError):
    """An unavailable and a foreign App have the same public result."""


class ConsumerAppsStore(Protocol):
    def candidates(
        self,
        identity: ConsumerIdentity,
        query: ConsumerAppsQuery,
        *,
        after: str | None,
        limit: int,
        shared_ids: Sequence[str] | None,
    ) -> tuple[ConsumerApp, ...]: ...

    def by_ids(self, identity: ConsumerIdentity, app_ids: Sequence[str]) -> tuple[ConsumerApp, ...]: ...

    def favorite(self, identity: ConsumerIdentity, app_id: str, *, enabled: bool) -> None:
        """Serialize on the Account; revalidate App availability in the write transaction.

        The existing tenant/Account/App unique key also prevents duplicate stars.
        No workspace membership is required or created.
        """
        ...


class ConsumerConnectionsStore(Protocol):
    def account_connection_groups(
        self, identity: ConsumerIdentity, *, provider: str | None, after: ConsumerConnectionKey | None, limit: int
    ) -> tuple[ConsumerConnectionGroup, ...]: ...

    def account_group_connections(
        self, identity: ConsumerIdentity, keys: Sequence[ConsumerConnectionKey]
    ) -> Mapping[ConsumerConnectionKey, tuple[str, ...]]: ...

    def account_connection_context(
        self, identity: ConsumerIdentity, connection_id: str
    ) -> AccountConnectionContext: ...

    def account_connection_apps(
        self, identity: ConsumerIdentity, connection_ids: Sequence[str]
    ) -> Mapping[str, tuple[str, ...]]:
        """Current App defaults and Session references, deduplicated by App.

        References do not grant ownership. Filter Connections by Account and join
        each reference on tenant as well as ID. Never read historical Run snapshots.
        """
        ...


class ConsumerAppAccess(Protocol):
    def get_visible_app_ids(self, *, user_id: str, app_ids: Sequence[str]) -> frozenset[str]: ...


class SharedConsumerApps(Protocol):
    def __call__(self) -> tuple[str, ...]: ...


class ConsumerService:
    def __init__(
        self,
        *,
        apps: ConsumerAppsStore,
        connections: ConsumerConnectionsStore,
        access: ConsumerAppAccess,
        shared_apps: SharedConsumerApps,
        management: ConnectionService,
        identities: WebIdentityService,
        tokens: WebPassportTokenGateway,
    ) -> None:
        self._apps = apps
        self._connections = connections
        self._access = access
        self._shared_apps = shared_apps
        self._management = management
        self._identities = identities
        self._tokens = tokens

    def authenticate(self, access_token: str | None) -> ConsumerIdentity:
        if not access_token:
            raise WebIdentityError("Account login required.")
        claims = self._identities.resolve_webapp_account_login(self._tokens.verify(access_token))
        assert claims.account_id is not None
        return ConsumerIdentity(claims.account_id)

    def _visible(self, identity: ConsumerIdentity, apps: Sequence[ConsumerApp]) -> tuple[ConsumerApp, ...]:
        visible = self._access.get_visible_app_ids(user_id=identity.account_id, app_ids=tuple(app.id for app in apps))
        return tuple(app for app in apps if app.id in visible)

    def list_apps(self, identity: ConsumerIdentity, query: ConsumerAppsQuery) -> ConsumerAppsPage:
        # The continuation is the last consumed candidate, including denied Apps.
        # Fill pages after permission filtering rather than leaking candidate counts.
        data: list[ConsumerApp] = []
        after = query.cursor
        last = after
        shared_ids = self._shared_apps() if query.view == "shared" else None
        while True:
            candidates = self._apps.candidates(
                identity, query, after=after, limit=query.limit + 1, shared_ids=shared_ids
            )
            if not candidates:
                return ConsumerAppsPage(data=tuple(data), has_more=False, next_cursor=None)
            visible = {app.id for app in self._visible(identity, candidates)}
            for app in candidates:
                if app.id in visible:
                    if len(data) == query.limit:
                        return ConsumerAppsPage(data=tuple(data), has_more=True, next_cursor=last)
                    data.append(app)
                last = app.continuation
            if len(candidates) < query.limit + 1:
                return ConsumerAppsPage(data=tuple(data), has_more=False, next_cursor=None)
            after = last

    def set_favorite(self, identity: ConsumerIdentity, app_id: str, *, enabled: bool) -> None:
        if enabled:
            apps = self._apps.by_ids(identity, (app_id,))
            if not self._visible(identity, apps):
                raise ConsumerAppNotFoundError()
        self._apps.favorite(identity, app_id, enabled=enabled)

    def list_connections(
        self, identity: ConsumerIdentity, *, provider: str | None, cursor: str | None, limit: int
    ) -> ConsumerConnectionsPage:
        after = ConsumerConnectionKey.decode(cursor) if cursor is not None else None
        if after is not None and provider is not None and after.provider != provider:
            raise ValueError("Invalid Connection group cursor.")
        rows = self._connections.account_connection_groups(identity, provider=provider, after=after, limit=limit + 1)
        members = self._connections.account_group_connections(identity, tuple(row.key for row in rows[:limit]))
        apps = self._group_apps(identity, members)
        data = tuple(
            ConsumerConnection(
                key=row.key.encode(),
                provider=row.key.provider,
                connection_type=row.key.connection_type,
                name=row.name,
                account_label=row.key.account_label,
                webapps_count=len(apps.get(row.key, ())),
            )
            for row in rows[:limit]
        )
        more = len(rows) > limit
        return ConsumerConnectionsPage(data=data, has_more=more, next_cursor=data[-1].key if more else None)

    def _group_apps(
        self, identity: ConsumerIdentity, members: Mapping[ConsumerConnectionKey, tuple[str, ...]]
    ) -> Mapping[ConsumerConnectionKey, tuple[ConsumerApp, ...]]:
        connection_ids = tuple(id_ for ids in members.values() for id_ in ids)
        associations = self._connections.account_connection_apps(identity, connection_ids)
        app_ids = tuple(dict.fromkeys(app_id for ids in associations.values() for app_id in ids))
        apps = {app.id: app for app in self._visible(identity, self._apps.by_ids(identity, app_ids))}
        return {
            key: tuple(
                apps[id_]
                for id_ in sorted(
                    {
                        app_id
                        for connection_id in members.get(key, ())
                        for app_id in associations.get(connection_id, ())
                        if app_id in apps
                    }
                )
            )
            for key in members
        }

    def list_connection_apps(
        self, identity: ConsumerIdentity, connection_key: str, *, cursor: str | None, limit: int
    ) -> ConsumerAppsPage:
        key = ConsumerConnectionKey.decode(connection_key)
        members = self._connections.account_group_connections(identity, (key,))
        if not members.get(key):
            raise ConnectionNotFoundError()
        apps = self._group_apps(identity, members)[key]
        if cursor is not None:
            after = str(UUID(cursor))
            apps = tuple(app for app in apps if app.id > after)
        more = len(apps) > limit
        data = apps[:limit]
        return ConsumerAppsPage(data=data, has_more=more, next_cursor=data[-1].id if more else None)

    def connection_context(self, identity: ConsumerIdentity, connection_id: str) -> AccountConnectionContext:
        return self._connections.account_connection_context(identity, connection_id)

    def delete_connection(self, identity: ConsumerIdentity, connection_key: str) -> None:
        key = ConsumerConnectionKey.decode(connection_key)
        members = self._connections.account_group_connections(identity, (key,)).get(key, ())
        if not members:
            raise ConnectionNotFoundError()
        for connection_id in members:
            try:
                self._management.delete_connection(self.connection_context(identity, connection_id), connection_id)
            except ConnectionNotFoundError:
                # Another disconnect may already have removed a member of the snapshot.
                continue
