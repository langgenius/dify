import logging
from collections.abc import Mapping, Sequence
from typing import Literal
from warnings import deprecated

from pydantic import ValidationError

from extensions.ext_redis import redis_client
from services.billing_client import billing, saas

logger = logging.getLogger(__name__)

EmailFreezeType = Literal["freeze", "email_domain_suspended"]


def _quota_meta(meta: Mapping[str, object] | None) -> dict[str, str]:
    """The spec types quota metadata as a string map."""
    return {key: value if isinstance(value, str) else str(value) for key, value in (meta or {}).items()}


class BillingService:
    # Redis key prefix for tenant plan cache
    _PLAN_CACHE_KEY_PREFIX = "tenant_plan:"
    # Cache TTL: 10 minutes
    _PLAN_CACHE_TTL = 600

    @classmethod
    def get_info(cls, tenant_id: str, exclude_vector_space: bool = False) -> billing.GetSubscriptionInfoReply:
        return billing.subscription_get_subscription_info(
            tenant_id=tenant_id, exclude_vector_space=exclude_vector_space
        )

    @classmethod
    def get_vector_space(cls, tenant_id: str, bypass_cache: bool = False) -> billing.VectorSpaceQuota:
        return billing.subscription_get_subscription_vector_space(tenant_id=tenant_id, bypass_cache=bypass_cache)

    @classmethod
    def invalidate_vector_space_cache(cls, tenant_id: str) -> None:
        cls.get_vector_space(tenant_id, bypass_cache=True)

    @classmethod
    def get_quota_info(cls, tenant_id: str) -> billing.QuotaGetInfoReply:
        return billing.quota_get_quota_info(tenant_id=tenant_id)

    @classmethod
    def quota_reserve(
        cls,
        tenant_id: str,
        feature_key: str,
        request_id: str,
        amount: int = 1,
        meta: Mapping[str, object] | None = None,
        bucket: str = "",
    ) -> billing.QuotaReserveReply:
        """Reserve quota before task execution."""
        return billing.quota_reserve(
            body=billing.QuotaReserveReq(
                tenant_id=tenant_id,
                feature_key=feature_key,
                request_id=request_id,
                amount=amount,
                meta=_quota_meta(meta),
                bucket=bucket,
            )
        )

    @classmethod
    def quota_commit(
        cls,
        tenant_id: str,
        feature_key: str,
        reservation_id: str,
        actual_amount: int,
        meta: Mapping[str, object] | None = None,
        bucket: str = "",
    ) -> billing.QuotaCommitReply:
        """Commit a reservation with actual consumption."""
        return billing.quota_commit(
            body=billing.QuotaCommitReq(
                tenant_id=tenant_id,
                feature_key=feature_key,
                reservation_id=reservation_id,
                actual_amount=actual_amount,
                meta=_quota_meta(meta),
                bucket=bucket,
            )
        )

    @classmethod
    def quota_release(
        cls, tenant_id: str, feature_key: str, reservation_id: str, bucket: str = ""
    ) -> billing.QuotaReleaseReply:
        """Release a reservation (cancel, return frozen quota)."""
        return billing.quota_release(
            body=billing.QuotaReleaseReq(
                tenant_id=tenant_id, feature_key=feature_key, reservation_id=reservation_id, bucket=bucket
            )
        )

    @classmethod
    def quota_get_balance(cls, tenant_id: str, feature_key: str, bucket: str = "") -> billing.QuotaGetBalanceReply:
        """Get quota balance for a feature bucket."""
        return billing.quota_get_balance(tenant_id=tenant_id, feature_key=feature_key, bucket=bucket)

    @classmethod
    def quota_consume_capped(
        cls,
        tenant_id: str,
        feature_key: str,
        request_id: str,
        amount: int,
        meta: Mapping[str, object] | None = None,
        bucket: str = "",
    ) -> billing.QuotaConsumeCappedReply:
        """Consume up to the available quota and return the actual deducted amount."""
        return billing.quota_consume_capped(
            body=billing.QuotaConsumeCappedReq(
                tenant_id=tenant_id,
                feature_key=feature_key,
                request_id=request_id,
                amount=amount,
                meta=_quota_meta(meta),
                bucket=bucket,
            )
        )

    @classmethod
    def get_knowledge_rate_limit(cls, tenant_id: str) -> billing.GetKnowledgeRateLimitReply:
        return billing.subscription_get_knowledge_rate_limit(tenant_id=tenant_id)

    @classmethod
    def get_subscription(
        cls, plan: str, interval: str, prefilled_email: str = "", tenant_id: str = ""
    ) -> billing.GetSubscriptionPaymentLinkReply:
        return billing.subscription_get_subscription_payment_link(
            plan=plan, interval=interval, prefilled_email=prefilled_email, tenant_id=tenant_id
        )

    @classmethod
    @deprecated("Only used by the deprecated model-provider checkout endpoint.")
    def get_model_provider_payment_link(
        cls, provider_name: str, tenant_id: str, account_id: str, prefilled_email: str
    ) -> billing.GetModelProviderPaymentLinkReply:
        return billing.model_provider_get_model_provider_payment_link(
            provider_name=provider_name, tenant_id=tenant_id, account_id=account_id, prefilled_email=prefilled_email
        )

    @classmethod
    def get_invoices(cls, prefilled_email: str = "", tenant_id: str = "") -> billing.GetInvoicesReply:
        return billing.invoice_get_invoices(prefilled_email=prefilled_email, tenant_id=tenant_id)

    @classmethod
    def delete_account(cls, account_id: str) -> saas.DeleteAccountReply:
        return saas.account_delete_account(account_id=account_id)

    @classmethod
    def get_email_freeze_type(cls, email: str) -> EmailFreezeType | None:
        try:
            reply = saas.account_check_account_in_freeze(email=email)
        except Exception:
            return None
        if not reply.data:
            return None
        match reply.freeze_type:
            case "freeze" | "email_domain_suspended" as freeze_type:
                return freeze_type
            case _:
                # Billing versions that only return the boolean `data` send an empty freeze type.
                return "freeze"

    @classmethod
    def is_email_in_freeze(cls, email: str) -> bool:
        return cls.get_email_freeze_type(email) is not None

    @classmethod
    def update_account_deletion_feedback(cls, email: str, feedback: str) -> saas.AddDeleteFeedbackReply:
        return saas.account_add_delete_feedback(body=saas.AddDeleteFeedbackRequest(email=email, feedback=feedback))

    class EducationIdentity:
        @classmethod
        def verify(cls, account_id: str) -> billing.VerifyEducationIdentityReply:
            return billing.education_verify_education_identity(account_id=account_id)

        @classmethod
        def status(cls, account_id: str) -> billing.GetEducationIdentityStatusReply:
            return billing.education_get_education_identity_status(account_id=account_id)

        @classmethod
        def activate(
            cls,
            *,
            account_id: str,
            tenant_id: str,
            token: str,
            institution: str,
            role: str,
        ) -> billing.CreateEducationIdentityReply:
            return billing.education_create_education_identity(
                body=billing.CreateEducationIdentityReq(
                    account_id=account_id, curr_tenant_id=tenant_id, institution=institution, role=role, token=token
                )
            )

        @classmethod
        def autocomplete(
            cls, keywords: str, page: int = 0, limit: int = 20
        ) -> billing.AutocompleteEducationInstitutionReply:
            return billing.education_autocomplete_education_institution(keywords=keywords, page=page, limit=limit)

    @classmethod
    def get_compliance_download_link(
        cls,
        doc_name: str,
        account_id: str,
        tenant_id: str,
        ip: str,
        device_info: str,
    ) -> billing.DownloadComplianceDocumentReply:
        return billing.compliance_download_compliance_document(
            body=billing.DownloadComplianceDocumentReq(
                doc_name=doc_name, account_id=account_id, tenant_id=tenant_id, ip_address=ip, device_info=device_info
            )
        )

    @classmethod
    def clean_billing_info_cache(cls, tenant_id: str) -> None:
        redis_client.delete(f"tenant:{tenant_id}:billing_info")

    @classmethod
    def get_plan_bulk(cls, tenant_ids: Sequence[str]) -> dict[str, billing.SubscriptionPlanItem]:
        """
        Bulk fetch billing subscription plan via billing API, at most 200 tenants per request.
        Invalid items are skipped so callers only receive validated plans.
        Returns:
            Mapping of tenant_id -> subscription plan
        """
        results: dict[str, billing.SubscriptionPlanItem] = {}

        chunk_size = 200
        for i in range(0, len(tenant_ids), chunk_size):
            chunk = tenant_ids[i : i + chunk_size]
            try:
                reply = billing.subscription_batch_get_subscription_plan(
                    body=billing.BatchGetSubscriptionPlanReq(tenant_ids=list(chunk))
                )
                for tenant_id, item in (reply.data or {}).items():
                    try:
                        # Observed responses can contain constructed models; validating an instance would trust it.
                        payload = (
                            item.model_dump(warnings=False) if isinstance(item, billing.SubscriptionPlanItem) else item
                        )
                        results[tenant_id] = billing.SubscriptionPlanItem.model_validate(payload)
                    except ValidationError:
                        logger.exception(
                            "get_plan_bulk: failed to validate subscription plan for tenant(%s)", tenant_id
                        )
            except Exception:
                logger.exception("get_plan_bulk: failed to fetch billing info batch for tenants: %s", chunk)
                continue

        return results

    @classmethod
    def _make_plan_cache_key(cls, tenant_id: str) -> str:
        return f"{cls._PLAN_CACHE_KEY_PREFIX}{tenant_id}"

    @classmethod
    def get_plan_bulk_with_cache(cls, tenant_ids: Sequence[str]) -> dict[str, billing.SubscriptionPlanItem]:
        """
        Bulk fetch billing subscription plan with cache to reduce billing API loads in batch job scenarios.

        NOTE: if you want to high data consistency, use get_plan_bulk instead.

        Returns:
            Mapping of tenant_id -> subscription plan
        """
        tenant_plans: dict[str, billing.SubscriptionPlanItem] = {}

        if not tenant_ids:
            return tenant_plans

        # Step 1: Batch fetch from Redis cache using mget
        redis_keys = [cls._make_plan_cache_key(tenant_id) for tenant_id in tenant_ids]
        try:
            cached_values = redis_client.mget(redis_keys)

            if len(cached_values) != len(tenant_ids):
                raise Exception(
                    "get_plan_bulk_with_cache: unexpected error: redis mget failed: cached values length mismatch"
                )

            # Map cached values back to tenant_ids
            cache_misses: list[str] = []

            for tenant_id, cached_value in zip(tenant_ids, cached_values, strict=False):
                if cached_value:
                    try:
                        tenant_plans[tenant_id] = billing.SubscriptionPlanItem.model_validate_json(cached_value)
                    except Exception:
                        logger.exception(
                            "get_plan_bulk_with_cache: process tenant(%s) failed, add to cache misses", tenant_id
                        )
                        cache_misses.append(tenant_id)
                else:
                    cache_misses.append(tenant_id)

            logger.info(
                "get_plan_bulk_with_cache: cache hits=%s, cache misses=%s",
                len(tenant_plans),
                len(cache_misses),
            )
        except Exception:
            logger.exception("get_plan_bulk_with_cache: redis mget failed, falling back to API")
            cache_misses = list(tenant_ids)

        # Step 2: Fetch missing plans from billing API
        if cache_misses:
            bulk_plans = BillingService.get_plan_bulk(cache_misses)

            if bulk_plans:
                plans_to_cache: dict[str, billing.SubscriptionPlanItem] = {}

                for tenant_id, subscription_plan in bulk_plans.items():
                    tenant_plans[tenant_id] = subscription_plan
                    plans_to_cache[tenant_id] = subscription_plan

                # Step 3: Batch update Redis cache using pipeline
                if plans_to_cache:
                    try:
                        pipe = redis_client.pipeline()
                        for tenant_id, subscription_plan in plans_to_cache.items():
                            redis_key = cls._make_plan_cache_key(tenant_id)
                            pipe.setex(redis_key, cls._PLAN_CACHE_TTL, subscription_plan.model_dump_json())
                        pipe.execute()

                        logger.info(
                            "get_plan_bulk_with_cache: cached %s new tenant plans to Redis",
                            len(plans_to_cache),
                        )
                    except Exception:
                        logger.exception("get_plan_bulk_with_cache: redis pipeline failed")

        return tenant_plans

    @classmethod
    def get_expired_subscription_cleanup_whitelist(cls) -> Sequence[str]:
        reply = billing.subscription_list_subscription_cleanup_whitelist()
        return [item.tenant_id for item in reply.data or []]

    @classmethod
    def get_account_notification(cls, account_id: str) -> saas.GetAccountNotificationReply:
        """Return the active in-product notifications; fetching marks `once` notifications as seen."""
        return saas.notification_get_account_notification(account_id=account_id)

    @classmethod
    def dismiss_notification(cls, notification_id: str, account_id: str) -> saas.DismissNotificationReply:
        return saas.notification_dismiss_notification(
            notification_id=notification_id,
            body=saas.DismissNotificationReq(notification_id=notification_id, account_id=account_id),
        )
