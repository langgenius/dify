from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, cast

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from clients.a2a import A2AAgentCard, A2AClient, A2AClientError, A2AProtocolError, validate_same_origin_interface
from constants.model_template import default_app_templates
from core.helper import encrypter
from libs.datetime_utils import naive_utc_now
from libs.helper import to_timestamp
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentIconType,
    AgentKind,
    AgentScope,
    AgentSource,
    AgentStatus,
    ExternalAgentAuthType,
    ExternalAgentConfigSnapshot,
    ExternalAgentConnection,
)
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, IconType
from services.agent.errors import (
    AgentNameConflictError,
    AgentVersionConflictError,
    ExternalAgentConfigurationError,
    ExternalAgentConnectionError,
    ExternalAgentNotFoundError,
)


@dataclass(frozen=True)
class ExternalAgentDiscovery:
    """Validated, non-secret result of A2A discovery."""

    agent_card: A2AAgentCard
    protocol_version: str
    remote_agent_id: str


@dataclass(frozen=True)
class ExternalAgentConnectionMaterial:
    """Decrypted connection material used only at an outbound-call boundary."""

    endpoint: str
    auth_type: ExternalAgentAuthType
    bearer_token: str | None
    agent_config_snapshot_id: str | None = None


@dataclass(frozen=True)
class ExternalAgentRuntimeConfig:
    """Pinned card plus current connection secret required by Workflow runtime."""

    endpoint: str
    auth_type: ExternalAgentAuthType
    decrypted_bearer_token: str | None
    protocol_version: str
    remote_agent_id: str
    agent_card: A2AAgentCard


class ExternalAgentService:
    """Register and resolve customer-hosted A2A Agents.

    Discovery is deliberately a separate method that performs no database
    access. Controllers can therefore finish/rollback any read transaction
    before outbound I/O and only open a write transaction after discovery has
    succeeded.
    """

    def __init__(self, session: Session):
        self._session = session

    @staticmethod
    def discover(
        *,
        endpoint: str,
        auth_type: ExternalAgentAuthType,
        bearer_token: str | None,
    ) -> ExternalAgentDiscovery:
        endpoint = ExternalAgentService._normalize_connection(endpoint, auth_type, bearer_token).endpoint
        token = bearer_token if auth_type == ExternalAgentAuthType.BEARER else None
        try:
            agent_card = A2AClient(
                endpoint,
                token,
                connect_timeout_seconds=10.0,
                read_timeout_seconds=30.0,
            ).discover()
            interface = agent_card.preferred_http_interface()
            validate_same_origin_interface(endpoint, interface.url)
            ExternalAgentService._validate_card_authentication(agent_card, auth_type)
        except (A2AProtocolError, ValueError) as exc:
            raise ExternalAgentConfigurationError(description=str(exc)) from exc
        except A2AClientError as exc:
            raise ExternalAgentConnectionError(description=str(exc)) from exc

        extra = agent_card.model_extra or {}
        remote_agent_id = str(extra.get("id") or agent_card.name).strip()
        if not remote_agent_id:
            raise ExternalAgentConfigurationError(description="A2A Agent Card must identify the external agent.")
        return ExternalAgentDiscovery(
            agent_card=agent_card,
            protocol_version=interface.protocol_version,
            remote_agent_id=remote_agent_id,
        )

    def create_external_agent(
        self,
        *,
        tenant_id: str,
        account_id: str,
        endpoint: str,
        auth_type: ExternalAgentAuthType,
        bearer_token: str | None,
        discovery: ExternalAgentDiscovery,
        name: str | None = None,
        description: str | None = None,
        role: str = "",
        icon_type: AgentIconType | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> dict[str, Any]:
        connection_material = self._normalize_connection(endpoint, auth_type, bearer_token)
        card = discovery.agent_card
        agent_name = (name or card.name).strip()
        if not agent_name:
            raise ExternalAgentConfigurationError(description="External agent name cannot be empty.")

        app_template = dict(default_app_templates[AppMode.AGENT]["app"])
        app = App(**app_template)
        app.name = agent_name
        app.description = description if description is not None else card.description
        app.mode = AppMode.AGENT
        app.icon_type = IconType(icon_type.value) if icon_type else IconType.EMOJI
        app.icon = icon or "🤖"
        app.icon_background = icon_background or "#F4F4F5"
        app.tenant_id = tenant_id
        app.enable_site = False
        app.enable_api = False
        app.api_rph = 0
        app.api_rpm = 0
        app.max_active_requests = None
        app.created_by = account_id
        app.maintainer = account_id
        app.updated_by = account_id

        try:
            self._session.add(app)
            self._session.flush()

            app_model_config = AppModelConfig(app_id=app.id, created_by=account_id, updated_by=account_id)
            self._session.add(app_model_config)
            self._session.flush()
            app.app_model_config_id = app_model_config.id

            agent = Agent(
                tenant_id=tenant_id,
                name=agent_name,
                description=app.description or "",
                role=role,
                icon_type=icon_type or AgentIconType.EMOJI,
                icon=app.icon,
                icon_background=app.icon_background,
                agent_kind=AgentKind.EXTERNAL_AGENT,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id=app.id,
                backing_app_id=app.id,
                status=AgentStatus.ACTIVE,
                active_config_has_model=True,
                active_config_is_published=True,
                created_by=account_id,
                updated_by=account_id,
            )
            self._session.add(agent)
            self._session.flush()

            config_snapshot = AgentConfigSnapshot(
                tenant_id=tenant_id,
                agent_id=agent.id,
                version=1,
                config_snapshot=AgentSoulConfig(),
                version_note="Connected external A2A agent",
                created_by=account_id,
            )
            self._session.add(config_snapshot)
            self._session.flush()

            connection = self._new_connection(
                tenant_id=tenant_id,
                agent_id=agent.id,
                account_id=account_id,
                material=connection_material,
            )
            self._session.add(connection)
            self._session.flush()

            external_snapshot = self._new_external_snapshot(
                tenant_id=tenant_id,
                agent_id=agent.id,
                account_id=account_id,
                connection_id=connection.id,
                agent_config_snapshot_id=config_snapshot.id,
                discovery=discovery,
            )
            self._session.add(external_snapshot)
            self._session.add(
                AgentConfigRevision(
                    tenant_id=tenant_id,
                    agent_id=agent.id,
                    current_snapshot_id=config_snapshot.id,
                    revision=1,
                    operation=AgentConfigRevisionOperation.CONNECT_EXTERNAL_AGENT,
                    version_note="Connected external A2A agent",
                    created_by=account_id,
                )
            )
            agent.active_config_snapshot_id = config_snapshot.id
            self._session.commit()
        except IntegrityError as exc:
            self._session.rollback()
            raise AgentNameConflictError() from exc

        return self.get_detail(tenant_id=tenant_id, agent_id=agent.id)

    def update_external_agent(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        endpoint: str,
        auth_type: ExternalAgentAuthType,
        bearer_token: str | None,
        discovery: ExternalAgentDiscovery,
        expected_active_config_snapshot_id: str,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: AgentIconType | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> dict[str, Any]:
        try:
            return self._update_external_agent_impl(
                tenant_id=tenant_id,
                agent_id=agent_id,
                account_id=account_id,
                endpoint=endpoint,
                auth_type=auth_type,
                bearer_token=bearer_token,
                discovery=discovery,
                expected_active_config_snapshot_id=expected_active_config_snapshot_id,
                name=name,
                description=description,
                role=role,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
            )
        except IntegrityError as exc:
            self._session.rollback()
            if self._is_version_integrity_error(exc):
                raise AgentVersionConflictError() from exc
            raise AgentNameConflictError() from exc

    def _update_external_agent_impl(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        endpoint: str,
        auth_type: ExternalAgentAuthType,
        bearer_token: str | None,
        discovery: ExternalAgentDiscovery,
        expected_active_config_snapshot_id: str,
        name: str | None = None,
        description: str | None = None,
        role: str | None = None,
        icon_type: AgentIconType | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> dict[str, Any]:
        material = self._normalize_connection(endpoint, auth_type, bearer_token)
        # Serialize version allocation per Agent. The controller also sends the
        # snapshot seen by the editor, while this row lock closes the race
        # between allocating max(version)+1 and activating the new snapshot.
        agent = self._get_external_agent(tenant_id=tenant_id, agent_id=agent_id, for_update=True)
        if agent.active_config_snapshot_id != expected_active_config_snapshot_id:
            raise AgentVersionConflictError()
        if not agent.app_id:
            raise ExternalAgentNotFoundError()
        app = self._session.scalar(
            select(App).where(App.id == agent.app_id, App.tenant_id == tenant_id, App.mode == AppMode.AGENT)
        )
        connection = self._get_connection_for_snapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )
        if app is None or connection is None:
            raise ExternalAgentNotFoundError()

        now = naive_utc_now()
        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise ExternalAgentConfigurationError(description="External agent name cannot be empty.")
            agent.name = normalized_name
            app.name = normalized_name
        if description is not None:
            agent.description = description
            app.description = description
        if role is not None:
            agent.role = role
        if icon_type is not None:
            agent.icon_type = icon_type
            app.icon_type = IconType(icon_type.value)
        if icon is not None:
            agent.icon = icon
            app.icon = icon
        if icon_background is not None:
            agent.icon_background = icon_background
            app.icon_background = icon_background

        previous_snapshot_id = agent.active_config_snapshot_id
        next_version = (
            self._session.scalar(
                select(func.max(AgentConfigSnapshot.version)).where(
                    AgentConfigSnapshot.tenant_id == tenant_id,
                    AgentConfigSnapshot.agent_id == agent_id,
                )
            )
            or 0
        ) + 1
        next_revision = (
            self._session.scalar(
                select(func.max(AgentConfigRevision.revision)).where(
                    AgentConfigRevision.tenant_id == tenant_id,
                    AgentConfigRevision.agent_id == agent_id,
                )
            )
            or 0
        ) + 1
        config_snapshot = AgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            version=next_version,
            config_snapshot=AgentSoulConfig(),
            version_note="Refreshed external A2A Agent Card",
            created_by=account_id,
        )
        self._session.add(config_snapshot)
        self._session.flush()

        connection = self._new_connection(
            tenant_id=tenant_id,
            agent_id=agent_id,
            account_id=account_id,
            material=material,
        )
        self._session.add(connection)
        self._session.flush()

        self._session.add(
            self._new_external_snapshot(
                tenant_id=tenant_id,
                agent_id=agent_id,
                account_id=account_id,
                connection_id=connection.id,
                agent_config_snapshot_id=config_snapshot.id,
                discovery=discovery,
            )
        )
        self._session.add(
            AgentConfigRevision(
                tenant_id=tenant_id,
                agent_id=agent_id,
                previous_snapshot_id=previous_snapshot_id,
                current_snapshot_id=config_snapshot.id,
                revision=next_revision,
                operation=AgentConfigRevisionOperation.REFRESH_EXTERNAL_AGENT,
                version_note="Refreshed external A2A Agent Card",
                created_by=account_id,
            )
        )
        agent.updated_by = account_id
        agent.updated_at = now
        app.updated_by = account_id
        app.updated_at = now

        self._session.flush()
        activation_result = cast(
            CursorResult,
            self._session.execute(
                update(Agent)
                .where(
                    Agent.tenant_id == tenant_id,
                    Agent.id == agent_id,
                    Agent.active_config_snapshot_id == expected_active_config_snapshot_id,
                )
                .values(
                    active_config_snapshot_id=config_snapshot.id,
                    active_config_has_model=True,
                    active_config_is_published=True,
                    updated_by=account_id,
                    updated_at=now,
                )
                .execution_options(synchronize_session=False)
            ),
        )
        if activation_result.rowcount != 1:
            self._session.rollback()
            raise AgentVersionConflictError()
        self._session.commit()
        # The conditional UPDATE intentionally bypasses ORM synchronization so
        # the compare-and-swap predicate remains the source of truth. Refresh
        # the identity-map row before serializing the newly active snapshot.
        self._session.expire(agent)
        return self.get_detail(tenant_id=tenant_id, agent_id=agent_id)

    def get_detail(self, *, tenant_id: str, agent_id: str) -> dict[str, Any]:
        agent = self._get_external_agent(tenant_id=tenant_id, agent_id=agent_id)
        if not agent.active_config_snapshot_id:
            raise ExternalAgentNotFoundError()
        runtime_config = self.get_runtime_config(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )
        connection = self._get_connection_for_snapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )
        return {
            "id": agent.id,
            "app_id": agent.app_id,
            "name": agent.name,
            "description": agent.description,
            "role": agent.role or "",
            "icon_type": agent.icon_type.value if agent.icon_type else None,
            "icon": agent.icon,
            "icon_background": agent.icon_background,
            "agent_kind": agent.agent_kind.value,
            "active_config_snapshot_id": agent.active_config_snapshot_id,
            "endpoint": runtime_config.endpoint,
            "auth_type": runtime_config.auth_type.value,
            "has_bearer_token": runtime_config.decrypted_bearer_token is not None,
            "protocol_version": runtime_config.protocol_version,
            "remote_agent_id": runtime_config.remote_agent_id,
            "agent_card": runtime_config.agent_card.model_dump(mode="json", by_alias=True),
            "last_verified_at": to_timestamp(connection.last_verified_at),
            "created_at": to_timestamp(agent.created_at),
            "updated_at": to_timestamp(agent.updated_at),
        }

    def get_connection_material(self, *, tenant_id: str, agent_id: str) -> ExternalAgentConnectionMaterial:
        agent = self._get_external_agent(tenant_id=tenant_id, agent_id=agent_id)
        if not agent.active_config_snapshot_id:
            raise ExternalAgentNotFoundError()
        connection = self._get_connection_for_snapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )
        return ExternalAgentConnectionMaterial(
            endpoint=encrypter.decrypt_token(tenant_id, connection.encrypted_endpoint),
            auth_type=connection.auth_type,
            bearer_token=(
                encrypter.decrypt_token(tenant_id, connection.encrypted_bearer_token)
                if connection.encrypted_bearer_token
                else None
            ),
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )

    def record_verified(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        expected_active_config_snapshot_id: str,
    ) -> None:
        agent = self._get_external_agent(tenant_id=tenant_id, agent_id=agent_id, for_update=True)
        if agent.active_config_snapshot_id != expected_active_config_snapshot_id:
            raise AgentVersionConflictError()
        connection = self._get_connection_for_snapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent.active_config_snapshot_id,
        )
        connection.last_verified_at = naive_utc_now()
        connection.updated_by = account_id
        self._session.commit()

    def validate_snapshot_available(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
    ) -> bool:
        return bool(
            self._session.scalar(
                select(ExternalAgentConfigSnapshot.id)
                .join(
                    Agent,
                    (Agent.id == ExternalAgentConfigSnapshot.agent_id)
                    & (Agent.tenant_id == ExternalAgentConfigSnapshot.tenant_id),
                )
                .join(
                    AgentConfigSnapshot,
                    (AgentConfigSnapshot.id == ExternalAgentConfigSnapshot.agent_config_snapshot_id)
                    & (AgentConfigSnapshot.tenant_id == ExternalAgentConfigSnapshot.tenant_id)
                    & (AgentConfigSnapshot.agent_id == ExternalAgentConfigSnapshot.agent_id),
                )
                .where(
                    ExternalAgentConfigSnapshot.tenant_id == tenant_id,
                    ExternalAgentConfigSnapshot.agent_id == agent_id,
                    ExternalAgentConfigSnapshot.agent_config_snapshot_id == agent_config_snapshot_id,
                    Agent.tenant_id == tenant_id,
                    Agent.id == agent_id,
                    Agent.agent_kind == AgentKind.EXTERNAL_AGENT,
                    Agent.status == AgentStatus.ACTIVE,
                )
                .limit(1)
            )
        )

    def get_runtime_config(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
    ) -> ExternalAgentRuntimeConfig:
        row = self._session.execute(
            select(ExternalAgentConfigSnapshot, ExternalAgentConnection)
            .join(
                ExternalAgentConnection,
                (ExternalAgentConnection.id == ExternalAgentConfigSnapshot.connection_id)
                & (ExternalAgentConnection.tenant_id == ExternalAgentConfigSnapshot.tenant_id)
                & (ExternalAgentConnection.agent_id == ExternalAgentConfigSnapshot.agent_id),
            )
            .join(
                Agent,
                (Agent.id == ExternalAgentConfigSnapshot.agent_id)
                & (Agent.tenant_id == ExternalAgentConfigSnapshot.tenant_id),
            )
            .join(
                AgentConfigSnapshot,
                (AgentConfigSnapshot.id == ExternalAgentConfigSnapshot.agent_config_snapshot_id)
                & (AgentConfigSnapshot.tenant_id == ExternalAgentConfigSnapshot.tenant_id)
                & (AgentConfigSnapshot.agent_id == ExternalAgentConfigSnapshot.agent_id),
            )
            .where(
                ExternalAgentConfigSnapshot.tenant_id == tenant_id,
                ExternalAgentConfigSnapshot.agent_id == agent_id,
                ExternalAgentConfigSnapshot.agent_config_snapshot_id == agent_config_snapshot_id,
                Agent.tenant_id == tenant_id,
                Agent.id == agent_id,
                Agent.agent_kind == AgentKind.EXTERNAL_AGENT,
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        ).one_or_none()
        if row is None:
            raise ExternalAgentNotFoundError()
        snapshot, connection = row
        try:
            card_json = encrypter.decrypt_token(tenant_id, snapshot.encrypted_agent_card)
            card = A2AAgentCard.model_validate_json(card_json)
        except (ValueError, ValidationError) as exc:
            raise ExternalAgentConfigurationError(description="Stored external Agent Card is invalid.") from exc
        return ExternalAgentRuntimeConfig(
            endpoint=encrypter.decrypt_token(tenant_id, connection.encrypted_endpoint),
            auth_type=connection.auth_type,
            decrypted_bearer_token=(
                encrypter.decrypt_token(tenant_id, connection.encrypted_bearer_token)
                if connection.encrypted_bearer_token
                else None
            ),
            protocol_version=snapshot.protocol_version,
            remote_agent_id=snapshot.remote_agent_id,
            agent_card=card,
        )

    def _get_external_agent(self, *, tenant_id: str, agent_id: str, for_update: bool = False) -> Agent:
        stmt = select(Agent).where(
            Agent.tenant_id == tenant_id,
            Agent.id == agent_id,
            Agent.scope == AgentScope.ROSTER,
            Agent.agent_kind == AgentKind.EXTERNAL_AGENT,
            Agent.status == AgentStatus.ACTIVE,
        )
        if for_update:
            stmt = stmt.with_for_update()
        agent = self._session.scalar(stmt)
        if agent is None:
            raise ExternalAgentNotFoundError()
        return agent

    @staticmethod
    def _is_version_integrity_error(exc: IntegrityError) -> bool:
        constraint_name = getattr(getattr(exc, "orig", None), "diag", None)
        named_constraint = getattr(constraint_name, "constraint_name", None)
        message = f"{named_constraint or ''} {exc}".lower()
        return any(
            name in message
            for name in (
                "agent_config_snapshot_agent_version_unique",
                "agent_config_revision_agent_revision_unique",
            )
        )

    def _get_connection_for_snapshot(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str | None,
    ) -> ExternalAgentConnection:
        if not agent_config_snapshot_id:
            raise ExternalAgentNotFoundError()
        connection = self._session.scalar(
            select(ExternalAgentConnection)
            .join(
                ExternalAgentConfigSnapshot,
                (ExternalAgentConfigSnapshot.connection_id == ExternalAgentConnection.id)
                & (ExternalAgentConfigSnapshot.tenant_id == ExternalAgentConnection.tenant_id)
                & (ExternalAgentConfigSnapshot.agent_id == ExternalAgentConnection.agent_id),
            )
            .where(
                ExternalAgentConnection.tenant_id == tenant_id,
                ExternalAgentConnection.agent_id == agent_id,
                ExternalAgentConfigSnapshot.tenant_id == tenant_id,
                ExternalAgentConfigSnapshot.agent_id == agent_id,
                ExternalAgentConfigSnapshot.agent_config_snapshot_id == agent_config_snapshot_id,
            )
            .limit(1)
        )
        if connection is None:
            raise ExternalAgentNotFoundError()
        return connection

    @staticmethod
    def _normalize_connection(
        endpoint: str,
        auth_type: ExternalAgentAuthType,
        bearer_token: str | None,
    ) -> ExternalAgentConnectionMaterial:
        normalized_endpoint = endpoint.strip().rstrip("/")
        if not normalized_endpoint:
            raise ExternalAgentConfigurationError(description="External agent endpoint cannot be empty.")
        normalized_token = bearer_token.strip() if bearer_token else None
        if auth_type == ExternalAgentAuthType.BEARER and not normalized_token:
            raise ExternalAgentConfigurationError(description="Bearer authentication requires a token.")
        if auth_type == ExternalAgentAuthType.NONE and normalized_token:
            raise ExternalAgentConfigurationError(
                description="Bearer token must be omitted when authentication is disabled."
            )
        return ExternalAgentConnectionMaterial(
            endpoint=normalized_endpoint,
            auth_type=auth_type,
            bearer_token=normalized_token,
        )

    @staticmethod
    def endpoint_origins_match(first_endpoint: str, second_endpoint: str) -> bool:
        try:
            validate_same_origin_interface(first_endpoint, second_endpoint)
        except (A2AProtocolError, ValueError):
            return False
        return True

    @staticmethod
    def _validate_card_authentication(
        agent_card: A2AAgentCard,
        auth_type: ExternalAgentAuthType,
    ) -> None:
        requirements = agent_card.security_requirements
        if not requirements:
            return

        bearer_scheme_names = {
            name
            for name, definition in agent_card.security_schemes.items()
            if ExternalAgentService._is_bearer_security_scheme(definition)
        }
        alternatives = [ExternalAgentService._security_requirement_names(item) for item in requirements]
        if any(not names for names in alternatives):
            return
        if auth_type == ExternalAgentAuthType.NONE:
            raise ExternalAgentConfigurationError(
                description="The A2A Agent Card requires authentication. Choose a supported authentication method."
            )
        if not any(names and names.issubset(bearer_scheme_names) for names in alternatives):
            raise ExternalAgentConfigurationError(
                description="The A2A Agent Card does not advertise a Bearer authentication alternative."
            )

    @staticmethod
    def _security_requirement_names(requirement: dict[str, Any]) -> set[str]:
        schemes = requirement.get("schemes", requirement)
        return set(schemes) if isinstance(schemes, dict) else set()

    @staticmethod
    def _is_bearer_security_scheme(definition: Any) -> bool:
        if not isinstance(definition, dict):
            return False
        http_scheme = definition.get("httpAuthSecurityScheme")
        if isinstance(http_scheme, dict):
            return str(http_scheme.get("scheme") or "").lower() == "bearer"
        return (
            str(definition.get("type") or "").lower() == "http"
            and str(definition.get("scheme") or "").lower() == "bearer"
        )

    @staticmethod
    def _new_connection(
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        material: ExternalAgentConnectionMaterial,
    ) -> ExternalAgentConnection:
        return ExternalAgentConnection(
            tenant_id=tenant_id,
            agent_id=agent_id,
            encrypted_endpoint=encrypter.encrypt_token(tenant_id, material.endpoint),
            endpoint_hash=ExternalAgentService._hash_text(material.endpoint),
            auth_type=material.auth_type,
            encrypted_bearer_token=(
                encrypter.encrypt_token(tenant_id, material.bearer_token) if material.bearer_token is not None else None
            ),
            last_verified_at=naive_utc_now(),
            created_by=account_id,
            updated_by=account_id,
        )

    @staticmethod
    def _new_external_snapshot(
        *,
        tenant_id: str,
        agent_id: str,
        account_id: str,
        connection_id: str,
        agent_config_snapshot_id: str,
        discovery: ExternalAgentDiscovery,
    ) -> ExternalAgentConfigSnapshot:
        card_json = ExternalAgentService._canonical_card_json(discovery.agent_card)
        return ExternalAgentConfigSnapshot(
            tenant_id=tenant_id,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
            connection_id=connection_id,
            encrypted_agent_card=encrypter.encrypt_token(tenant_id, card_json),
            agent_card_hash=ExternalAgentService._hash_text(card_json),
            protocol_version=discovery.protocol_version,
            remote_agent_id=discovery.remote_agent_id,
            created_by=account_id,
        )

    @staticmethod
    def _canonical_card_json(agent_card: A2AAgentCard) -> str:
        return json.dumps(
            agent_card.model_dump(mode="json", by_alias=True),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    @staticmethod
    def _hash_text(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()
