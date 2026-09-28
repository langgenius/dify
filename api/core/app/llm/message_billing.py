"""Classic Chat/Agent billing is owned by a message, never by each LLM turn.

Cloud shared-credit legacy messages reserve once before starting their worker.
The existing message-created event commits that receipt even after cutover,
including messages admitted before migration preparation exists at all.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from threading import Event, RLock, Thread
from time import monotonic
from typing import TYPE_CHECKING, Any, Literal

from configs import dify_config
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.model_invocation_routing import (
    LegacyModelCredentials,
    ModelInvocationReprepare,
    ModelMigrationProcessing,
    ModelRouteUnavailable,
    RoutedModelCredentials,
    validate_invocation_admission,
)
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from models.provider import ProviderType
from models.provider_ids import ModelProviderID
from services.credit_pool_service import CreditPoolReservation, CreditPoolService

if TYPE_CHECKING:
    from core.app.entities.app_invoke_entities import EasyUIBasedAppGenerateEntity

logger = logging.getLogger(__name__)
MESSAGE_RESERVATION_HEARTBEAT_SECONDS = 20


@dataclass
class ClassicMessageBilling:
    tenant_id: str
    message_id: str
    provider: str
    model: str
    backend: Literal["legacy_event", "legacy_reserved", "tokener", "provider_free", "custom", "unmetered"]
    reservation: CreditPoolReservation | None = field(default=None, repr=False)
    settled: bool = field(default=False, init=False)
    _commit_attempted: bool = field(default=False, init=False, repr=False)
    _lock: Any = field(default_factory=RLock, init=False, repr=False)
    _heartbeat_stop: Event = field(default_factory=Event, init=False, repr=False)
    _renew_failed: bool = field(default=False, init=False, repr=False)
    _last_renewed_at: float = field(default_factory=monotonic, init=False, repr=False)

    def start_heartbeat(self) -> None:
        if self.reservation is None or self.reservation.reservation_id is None:
            return
        Thread(target=self._heartbeat, name="classic-message-reservation", daemon=True).start()

    def _heartbeat(self) -> None:
        while not self._heartbeat_stop.wait(MESSAGE_RESERVATION_HEARTBEAT_SECONDS):
            with self._lock:
                if self._heartbeat_stop.is_set() or self.settled or self.reservation is None:
                    return
                self._renew_locked()
                if self._renew_failed:
                    return

    def _renew_locked(self) -> None:
        if self.reservation is None or self.reservation.reservation_id is None:
            return
        try:
            self.reservation.renew()
            self._last_renewed_at = monotonic()
        except Exception:
            self._renew_failed = True
            self._heartbeat_stop.set()
            logger.warning("Message billing renewal failed tenant=%s message=%s", self.tenant_id, self.message_id)

    def check_active(self) -> None:
        with self._lock:
            if self._renew_failed or self.settled:
                raise ModelMigrationProcessing
            # A delayed scheduler cannot launch a new Agent turn behind an
            # unknown hold. Synchronously renew the original receipt first.
            if monotonic() - self._last_renewed_at >= MESSAGE_RESERVATION_HEARTBEAT_SECONDS:
                self._renew_locked()
            if self._renew_failed:
                raise ModelMigrationProcessing

    def check_identity(self, tenant_id: str, provider: str, model: str) -> None:
        if (tenant_id, str(ModelProviderID(provider)), model) != (self.tenant_id, self.provider, self.model):
            raise ModelRouteUnavailable

    def commit_reserved(self) -> None:
        self._heartbeat_stop.set()
        with self._lock:
            if self.settled:
                return
            self.check_active()
            if self.reservation is not None:
                # If a commit result is unknown, do not turn it into a release
                # from generator cleanup. The durable Billing receipt can retry.
                self._commit_attempted = True
                self.reservation.commit()
            self.settled = True

    def release_unsettled(self) -> None:
        self._heartbeat_stop.set()
        with self._lock:
            if self.settled or self._commit_attempted:
                return
            if self.reservation is not None:
                self.reservation.release()
            self.settled = True


def begin_message_billing(entity: EasyUIBasedAppGenerateEntity, message_id: str) -> ClassicMessageBilling:
    from core.app.entities.app_invoke_entities import get_credit_usage_app_type, get_credit_usage_created_by
    from extensions.ext_database import db

    existing = entity._classic_message_billing
    if existing is not None:
        existing.check_identity(entity.app_config.tenant_id, entity.model_conf.provider, entity.model_conf.model)
        if existing.message_id != message_id:
            raise ModelRouteUnavailable
        return existing

    configuration = entity.model_conf.provider_model_bundle.configuration
    tenant_id = entity.app_config.tenant_id
    provider = entity.model_conf.provider
    model = entity.model_conf.model
    credentials = entity.model_conf.credentials
    owner = ClassicMessageBilling(tenant_id, message_id, str(ModelProviderID(provider)), model, "custom")
    if getattr(entity, "agent_llm_gateway_enabled", False):
        entity._classic_message_billing = owner
        return owner
    if configuration.using_provider_type == ProviderType.SYSTEM:
        validate_invocation_admission(
            credentials, tenant_id=tenant_id, provider=provider, model_type=ModelType.LLM, model=model
        )
        system = configuration.system_configuration
        quota = next((q for q in system.quota_configurations if q.quota_type == system.current_quota_type), None)
        if isinstance(credentials, RoutedModelCredentials):
            owner.backend = "tokener"
        elif quota is None or quota.quota_limit == -1 or system.current_quota_type is None:
            owner.backend = "unmetered"
        elif system.current_quota_type == ProviderQuotaType.FREE:
            owner.backend = "provider_free"
        else:
            owner.backend = "legacy_event"
            if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and quota.quota_unit in {
                QuotaUnit.CREDITS,
                QuotaUnit.TIMES,
            }:
                if not isinstance(credentials, LegacyModelCredentials):
                    raise ModelInvocationReprepare
                amount = dify_config.get_model_credits(model) if quota.quota_unit == QuotaUnit.CREDITS else 1
                if amount <= 0:
                    owner.backend = "unmetered"
                    entity._classic_message_billing = owner
                    return owner
                owner.reservation = CreditPoolService.reserve_credits_capped(
                    tenant_id=tenant_id,
                    credits_required=amount,
                    pool_type=system.current_quota_type.value,
                    request_id=message_id,
                    session_factory=db.session,
                    meta={
                        "source": "message.created",
                        "provider": provider,
                        "model": model,
                        "model_type": ModelType.LLM.value,
                        "app_type": get_credit_usage_app_type(entity.app_config.app_mode),
                        "created_by": get_credit_usage_created_by(entity.app_config.app_mode),
                    },
                )
                owner.backend = "legacy_reserved"
    entity._classic_message_billing = owner
    owner.start_heartbeat()
    return owner


def require_message_billing(entity: EasyUIBasedAppGenerateEntity) -> ClassicMessageBilling:
    owner = getattr(entity, "_classic_message_billing", None)
    if owner is None:
        # Never silently turn a lost message-level receipt into per-LLM
        # accounting and a second charge from the message-created event.
        raise ModelRouteUnavailable
    return owner


def release_message_billing(entity: EasyUIBasedAppGenerateEntity) -> None:
    owner = getattr(entity, "_classic_message_billing", None)
    if owner is not None:
        try:
            owner.release_unsettled()
        except Exception:
            logger.exception(
                "Failed to release message billing receipt tenant=%s message=%s", owner.tenant_id, owner.message_id
            )
