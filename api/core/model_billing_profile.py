from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import ServiceUnavailable

from core.db.session_factory import session_factory
from extensions.ext_redis import redis_client
from models.model_billing import TenantModelBillingProfile
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus

logger = logging.getLogger(__name__)

_STORED_TOKENER_SOURCE = "tokener"
_MODEL_BILLING_SOURCE_CACHE_KEY_PREFIX = "tenant:model-billing-source:v1"
_MODEL_BILLING_SOURCE_CACHE_TTL_SECONDS = 10 * 60


class ModelBillingSource(StrEnum):
    LEGACY_MESSAGE_CREDITS = "legacy_message_credits"
    TOKENER = "tokener"


class ModelBillingProfileResolutionError(ServiceUnavailable):
    error_code = "model_billing_profile_unavailable"
    description = "Model billing profile is temporarily unavailable."


class InvalidModelBillingProfileError(ModelBillingProfileResolutionError):
    error_code = "model_billing_profile_invalid"
    description = "Model billing profile is invalid."


class ModelBillingProfileCacheUnavailableError(RuntimeError):
    """Raised when an explicit cache invalidation cannot be completed."""


class _ModelBillingSourceCache:
    """Typed cache for the normalized tenant model-billing source only."""

    @staticmethod
    def key(tenant_id: str) -> str:
        return f"{_MODEL_BILLING_SOURCE_CACHE_KEY_PREFIX}:{tenant_id}"

    @classmethod
    def get(cls, tenant_id: str) -> ModelBillingSource | None:
        key = cls.key(tenant_id)
        cached = redis_client.get(key)
        if cached is None:
            return None

        if isinstance(cached, bytes):
            try:
                cached = cached.decode("utf-8")
            except UnicodeDecodeError:
                cached = ""

        if isinstance(cached, str):
            try:
                return ModelBillingSource(cached)
            except ValueError:
                pass

        logger.error("Ignoring invalid model billing source cache entry, tenant_id=%s", tenant_id)
        try:
            redis_client.delete(key)
        except Exception:
            logger.warning(
                "Failed to delete invalid model billing source cache entry, tenant_id=%s",
                tenant_id,
            )
        return None

    @classmethod
    def set(cls, tenant_id: str, source: ModelBillingSource) -> None:
        redis_client.setex(
            cls.key(tenant_id),
            _MODEL_BILLING_SOURCE_CACHE_TTL_SECONDS,
            source.value,
        )

    @classmethod
    def invalidate(cls, tenant_id: str) -> None:
        redis_client.delete(cls.key(tenant_id))


@dataclass(frozen=True, slots=True)
class TenantModelBillingResolution:
    model_billing_source: ModelBillingSource
    tokener_bootstrap_status: TenantTokenerIntegrationStatus | None = None

    @property
    def uses_legacy_message_credits(self) -> bool:
        return self.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS

    @property
    def uses_tokener(self) -> bool:
        return self.model_billing_source == ModelBillingSource.TOKENER


class ModelBillingProfileService:
    """Resolve the persisted model-billing cohort without falling open to legacy credits."""

    @classmethod
    def resolve(
        cls,
        tenant_id: str,
        *,
        session: Session | None = None,
    ) -> TenantModelBillingResolution:
        try:
            cached_source = _ModelBillingSourceCache.get(tenant_id)
        except Exception:
            logger.warning(
                "Failed to read model billing source cache; falling back to database, tenant_id=%s",
                tenant_id,
            )
            cached_source = None

        if cached_source is not None:
            if cached_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS:
                return TenantModelBillingResolution(model_billing_source=cached_source)
            return cls._resolve_tokener_status(tenant_id, session=session)

        resolution = cls._resolve_from_database(tenant_id, session=session)
        try:
            _ModelBillingSourceCache.set(tenant_id, resolution.model_billing_source)
        except Exception:
            logger.warning(
                "Failed to cache model billing source, tenant_id=%s",
                tenant_id,
            )
        return resolution

    @classmethod
    def _resolve_from_database(
        cls,
        tenant_id: str,
        *,
        session: Session | None,
    ) -> TenantModelBillingResolution:
        try:
            if session is not None:
                return cls._resolve_with_session(tenant_id, session=session)

            with session_factory.create_session() as owned_session:
                return cls._resolve_with_session(tenant_id, session=owned_session)
        except ModelBillingProfileResolutionError:
            raise
        except Exception:
            logger.exception(
                "Failed to resolve tenant model billing profile, tenant_id=%s",
                tenant_id,
            )
            raise ModelBillingProfileResolutionError from None

    @classmethod
    def _resolve_tokener_status(
        cls,
        tenant_id: str,
        *,
        session: Session | None,
    ) -> TenantModelBillingResolution:
        try:
            if session is not None:
                integration = cls._get_tokener_integration(tenant_id, session=session)
            else:
                with session_factory.create_session() as owned_session:
                    integration = cls._get_tokener_integration(tenant_id, session=owned_session)
        except Exception:
            logger.exception(
                "Failed to resolve Tokener bootstrap status, tenant_id=%s",
                tenant_id,
            )
            raise ModelBillingProfileResolutionError from None

        return TenantModelBillingResolution(
            model_billing_source=ModelBillingSource.TOKENER,
            tokener_bootstrap_status=integration.status if integration is not None else None,
        )

    @staticmethod
    def _get_tokener_integration(tenant_id: str, *, session: Session) -> TenantTokenerIntegration | None:
        return session.scalar(
            select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant_id).limit(1)
        )

    @staticmethod
    def _resolve_with_session(tenant_id: str, *, session: Session) -> TenantModelBillingResolution:
        profile = session.scalar(
            select(TenantModelBillingProfile).where(TenantModelBillingProfile.tenant_id == tenant_id).limit(1)
        )
        if profile is None:
            return TenantModelBillingResolution(model_billing_source=ModelBillingSource.LEGACY_MESSAGE_CREDITS)

        raw_source = profile.model_billing_source
        if raw_source is None:
            return TenantModelBillingResolution(model_billing_source=ModelBillingSource.LEGACY_MESSAGE_CREDITS)
        if raw_source == _STORED_TOKENER_SOURCE:
            integration = ModelBillingProfileService._get_tokener_integration(tenant_id, session=session)
            return TenantModelBillingResolution(
                model_billing_source=ModelBillingSource.TOKENER,
                tokener_bootstrap_status=integration.status if integration is not None else None,
            )

        logger.error(
            "Unknown tenant model billing source, tenant_id=%s",
            tenant_id,
        )
        raise InvalidModelBillingProfileError

    @classmethod
    def invalidate(cls, tenant_id: str) -> None:
        try:
            _ModelBillingSourceCache.invalidate(tenant_id)
        except Exception:
            logger.warning(
                "Failed to invalidate model billing source cache, tenant_id=%s",
                tenant_id,
            )
            raise ModelBillingProfileCacheUnavailableError from None

    @staticmethod
    def new_tokener_profile(tenant_id: str) -> TenantModelBillingProfile:
        return TenantModelBillingProfile(
            tenant_id=tenant_id,
            model_billing_source=_STORED_TOKENER_SOURCE,
        )
