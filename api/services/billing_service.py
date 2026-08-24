import json
import logging
import os
from collections.abc import Sequence
from typing import Any, Literal, NotRequired, TypedDict

import httpx
from pydantic import TypeAdapter, ValidationError
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed
from typing_extensions import deprecated
from werkzeug.exceptions import InternalServerError

from core.helper.http_client_pooling import get_pooled_http_client
from enums import CloudPlan
from extensions.ext_redis import redis_client
from libs.helper import RateLimiter
from services.billing_portal_service import BillingPortalLink
from services.errors.billing import (
    BillingUpstreamInvalidResponseError,
    BillingUpstreamUnavailableError,
)

logger = logging.getLogger(__name__)

_http_client: httpx.Client = get_pooled_http_client(
    "billing:default",
    lambda: httpx.Client(
        timeout=httpx.Timeout(30.0, connect=5.0),
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
    ),
)


EmailFreezeType = Literal["freeze", "email_domain_suspended"]


class _BillingHTTPStatusError(ValueError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class SubscriptionPlan(TypedDict):
    """Tenant subscriptionplan information."""

    plan: str
    expiration_date: int


class MessageResponseDict(TypedDict):
    message: str


class EducationVerifyResponseDict(TypedDict):
    token: str


class EducationStatusResponseDict(TypedDict):
    result: bool
    is_student: bool
    expire_at: str
    allow_refresh: bool


class EducationAutocompleteResponseDict(TypedDict):
    data: list[str]
    curr_page: int
    has_next: bool


_billing_portal_link_adapter = TypeAdapter(BillingPortalLink)


class QuotaReserveResult(TypedDict):
    reservation_id: str
    available: int
    reserved: int


class QuotaCommitResult(TypedDict):
    available: int
    reserved: int
    refunded: int


class QuotaReleaseResult(TypedDict):
    available: int
    reserved: int
    released: int


class QuotaBalanceResult(TypedDict):
    available: int
    reserved: int
    quota: int
    usage: int
    exhausted_at: NotRequired[int]


class QuotaConsumeCappedResult(TypedDict):
    deducted: int
    available: int
    reserved: int
    quota: int
    usage: int


_quota_reserve_adapter = TypeAdapter(QuotaReserveResult)
_quota_commit_adapter = TypeAdapter(QuotaCommitResult)
_quota_release_adapter = TypeAdapter(QuotaReleaseResult)
_quota_balance_adapter = TypeAdapter(QuotaBalanceResult)
_quota_consume_capped_adapter = TypeAdapter(QuotaConsumeCappedResult)


class _TenantFeatureQuota(TypedDict):
    usage: int
    limit: int
    reset_date: NotRequired[int]


class TenantFeatureQuotaInfo(TypedDict):
    """Response of /quota/info.

    NOTE (hj24):
    - Same convention as BillingInfo: billing may return int fields as str,
      always keep non-strict mode to auto-coerce.
    """

    trigger_event: _TenantFeatureQuota
    api_rate_limit: _TenantFeatureQuota


_tenant_feature_quota_info_adapter = TypeAdapter(TenantFeatureQuotaInfo)


class _BillingQuota(TypedDict):
    size: int
    limit: int


class _VectorSpaceQuota(TypedDict):
    size: float
    limit: int
    usage_unknown: NotRequired[bool]


class _KnowledgeRateLimit(TypedDict):
    # NOTE (hj24):
    # 1. Return for sandbox users but is null for other plans, it's defined but never used.
    # 2. Keep it for compatibility for now, can be deprecated in future versions.
    size: NotRequired[int]
    # NOTE END
    limit: int


class _BillingSubscription(TypedDict):
    plan: str
    interval: str
    education: bool


class BillingInfo(TypedDict):
    """Response of /subscription/info.

    NOTE (hj24):
    - Fields not listed here (e.g. trigger_event, api_rate_limit) are stripped by TypeAdapter.validate_python()
    - To ensure the precision, billing may convert fields like int as str, be careful when use TypeAdapter:
        1. validate_python in non-strict mode will coerce it to the expected type
        2. In strict mode, it will raise ValidationError
        3. To preserve compatibility, always keep non-strict mode here and avoid strict mode
    """

    enabled: bool
    subscription: _BillingSubscription
    members: _BillingQuota
    apps: _BillingQuota
    vector_space: NotRequired[_VectorSpaceQuota]
    knowledge_rate_limit: _KnowledgeRateLimit
    documents_upload_quota: _BillingQuota
    annotation_quota_limit: _BillingQuota
    docs_processing: str
    can_replace_logo: bool
    model_load_balancing_enabled: bool
    knowledge_pipeline_publish_enabled: bool
    next_credit_reset_date: NotRequired[int]


_billing_info_adapter = TypeAdapter(BillingInfo)
_vector_space_quota_adapter = TypeAdapter(_VectorSpaceQuota)


class KnowledgeRateLimitDict(TypedDict):
    limit: int
    subscription_plan: str


class TenantFeaturePlanUsageDict(TypedDict):
    result: str
    history_id: str


class LangContentDict(TypedDict):
    lang: str
    title: str
    subtitle: str
    body: str
    title_pic_url: str


class NotificationDict(TypedDict):
    notification_id: str
    contents: dict[str, LangContentDict]
    frequency: Literal["once", "every_page_load"]


class AccountNotificationDict(TypedDict, total=False):
    should_show: bool
    notification: NotificationDict
    shouldShow: bool
    notifications: list[dict]


class DismissNotificationDict(TypedDict):
    success: bool


class BillingService:
    base_url = os.environ.get("BILLING_API_URL", "BILLING_API_URL")
    quota_base_url = os.environ.get("BILLING_QUOTA_API_URL") or base_url
    secret_key = os.environ.get("BILLING_API_SECRET_KEY", "BILLING_API_SECRET_KEY")

    compliance_download_rate_limiter = RateLimiter("compliance_download_rate_limiter", 4, 60)

    # Redis key prefix for tenant plan cache
    _PLAN_CACHE_KEY_PREFIX = "tenant_plan:"
    # Cache TTL: 10 minutes
    _PLAN_CACHE_TTL = 600

    @classmethod
    def ensure_new_agent_beta_revision(cls, revision_id: str) -> None:
        cls._send_request("POST", f"/new-agent-beta/revisions/{revision_id}/ensure")

    @classmethod
    def get_info(cls, tenant_id: str, exclude_vector_space: bool = False) -> BillingInfo:
        params = {"tenant_id": tenant_id}
        if exclude_vector_space:
            params["exclude_vector_space"] = "true"

        billing_info = cls._send_request("GET", "/subscription/info", params=params)
        if exclude_vector_space and billing_info.get("vector_space") is None:
            # Unset proto message fields can be serialized as null; the light billing contract treats it as absent.
            billing_info.pop("vector_space", None)
        return _billing_info_adapter.validate_python(billing_info)

    @classmethod
    def get_vector_space(cls, tenant_id: str, bypass_cache: bool = False) -> _VectorSpaceQuota:
        params = {"tenant_id": tenant_id}
        if bypass_cache:
            params["bypass_cache"] = "true"
        return _vector_space_quota_adapter.validate_python(
            cls._send_request("GET", "/subscription/vector-space", params=params)
        )

    @classmethod
    def invalidate_vector_space_cache(cls, tenant_id: str) -> None:
        cls.get_vector_space(tenant_id, bypass_cache=True)

    @classmethod
    def get_quota_info(cls, tenant_id: str) -> TenantFeatureQuotaInfo:
        params = {"tenant_id": tenant_id}
        return _tenant_feature_quota_info_adapter.validate_python(
            cls._send_quota_request("GET", "/quota/info", params=params)
        )

    @classmethod
    def quota_reserve(
        cls,
        tenant_id: str,
        feature_key: str,
        request_id: str,
        amount: int = 1,
        meta: dict | None = None,
        bucket: str = "",
    ) -> QuotaReserveResult:
        """Reserve quota before task execution."""
        payload: dict = {
            "tenant_id": tenant_id,
            "feature_key": feature_key,
            "request_id": request_id,
            "amount": amount,
        }
        if bucket:
            payload["bucket"] = bucket
        if meta:
            payload["meta"] = meta
        return _quota_reserve_adapter.validate_python(cls._send_quota_request("POST", "/quota/reserve", json=payload))

    @classmethod
    def quota_commit(
        cls,
        tenant_id: str,
        feature_key: str,
        reservation_id: str,
        actual_amount: int,
        meta: dict | None = None,
        bucket: str = "",
    ) -> QuotaCommitResult:
        """Commit a reservation with actual consumption."""
        payload: dict = {
            "tenant_id": tenant_id,
            "feature_key": feature_key,
            "reservation_id": reservation_id,
            "actual_amount": actual_amount,
        }
        if bucket:
            payload["bucket"] = bucket
        if meta:
            payload["meta"] = meta
        return _quota_commit_adapter.validate_python(cls._send_quota_request("POST", "/quota/commit", json=payload))

    @classmethod
    def quota_release(
        cls, tenant_id: str, feature_key: str, reservation_id: str, bucket: str = ""
    ) -> QuotaReleaseResult:
        """Release a reservation (cancel, return frozen quota)."""
        payload = {
            "tenant_id": tenant_id,
            "feature_key": feature_key,
            "reservation_id": reservation_id,
        }
        if bucket:
            payload["bucket"] = bucket
        return _quota_release_adapter.validate_python(cls._send_quota_request("POST", "/quota/release", json=payload))

    @classmethod
    def quota_get_balance(cls, tenant_id: str, feature_key: str, bucket: str = "") -> QuotaBalanceResult:
        """Get quota balance for a feature bucket."""
        params = {"tenant_id": tenant_id, "feature_key": feature_key}
        if bucket:
            params["bucket"] = bucket
        return _quota_balance_adapter.validate_python(cls._send_quota_request("GET", "/quota/balance", params=params))

    @classmethod
    def quota_consume_capped(
        cls,
        tenant_id: str,
        feature_key: str,
        request_id: str,
        amount: int,
        meta: dict | None = None,
        bucket: str = "",
    ) -> QuotaConsumeCappedResult:
        """Consume up to the available quota and return the actual deducted amount."""
        payload: dict = {
            "tenant_id": tenant_id,
            "feature_key": feature_key,
            "request_id": request_id,
            "amount": amount,
        }
        if bucket:
            payload["bucket"] = bucket
        if meta:
            payload["meta"] = meta
        return _quota_consume_capped_adapter.validate_python(
            cls._send_quota_request("POST", "/quota/consume-capped", json=payload)
        )

    @classmethod
    def get_knowledge_rate_limit(cls, tenant_id: str) -> KnowledgeRateLimitDict:
        params = {"tenant_id": tenant_id}

        knowledge_rate_limit = cls._send_request("GET", "/subscription/knowledge-rate-limit", params=params)

        return {
            "limit": knowledge_rate_limit.get("limit", 10),
            "subscription_plan": knowledge_rate_limit.get("subscription_plan", CloudPlan.SANDBOX),
        }

    @classmethod
    def get_subscription(
        cls, plan: str, interval: str, prefilled_email: str = "", tenant_id: str = ""
    ) -> BillingPortalLink:
        params = {"plan": plan, "interval": interval, "prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_billing_portal_request("/subscription/payment-link", params=params)

    @classmethod
    @deprecated("Only used by the deprecated model-provider checkout endpoint.")
    def get_model_provider_payment_link(cls, provider_name: str, tenant_id: str, account_id: str, prefilled_email: str):
        params = {
            "provider_name": provider_name,
            "tenant_id": tenant_id,
            "account_id": account_id,
            "prefilled_email": prefilled_email,
        }
        return cls._send_request("GET", "/model-provider/payment-link", params=params)

    @classmethod
    def get_invoices(cls, prefilled_email: str = "", tenant_id: str = "") -> BillingPortalLink:
        params = {"prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_billing_portal_request("/invoices", params=params)

    @classmethod
    def update_tenant_feature_plan_usage(
        cls, tenant_id: str, feature_key: str, delta: int
    ) -> TenantFeaturePlanUsageDict:
        """
        Update tenant feature plan usage.

        Args:
            tenant_id: Tenant identifier
            feature_key: Feature key (e.g., 'trigger', 'workflow')
            delta: Usage delta (positive to add, negative to consume)

        Returns:
            Response dict with 'result' and 'history_id'
            Example: {"result": "success", "history_id": "uuid"}
        """
        return cls._send_request(
            "POST",
            "/tenant-feature-usage/usage",
            params={"tenant_id": tenant_id, "feature_key": feature_key, "delta": delta},
        )

    @classmethod
    def refund_tenant_feature_plan_usage(cls, history_id: str) -> TenantFeaturePlanUsageDict:
        """
        Refund a previous usage charge.

        Args:
            history_id: The history_id returned from update_tenant_feature_plan_usage

        Returns:
            Response dict with 'result' and 'history_id'
        """
        return cls._send_request("POST", "/tenant-feature-usage/refund", params={"quota_usage_history_id": history_id})

    @classmethod
    @deprecated("Legacy tenant feature-plan usage endpoint; use the quota APIs instead.")
    def get_tenant_feature_plan_usage(cls, tenant_id: str, feature_key: str):
        params = {"tenant_id": tenant_id, "feature_key": feature_key}
        return cls._send_request("GET", "/billing/tenant_feature_plan/usage", params=params)

    @classmethod
    def _send_quota_request(
        cls, method: Literal["GET", "POST", "DELETE", "PUT"], endpoint: str, json=None, params=None
    ) -> dict[str, Any]:
        return cls._send_request(method, endpoint, json=json, params=params, base_url=cls.quota_base_url)

    @classmethod
    @retry(
        wait=wait_fixed(2),
        stop=stop_before_delay(10),
        retry=retry_if_exception_type(httpx.RequestError),
        reraise=True,
    )
    def _send_request(
        cls,
        method: Literal["GET", "POST", "DELETE", "PUT"],
        endpoint: str,
        json=None,
        params=None,
        base_url: str | None = None,
    ) -> Any:
        headers = {"Content-Type": "application/json", "Billing-Api-Secret-Key": cls.secret_key}

        url = f"{base_url or cls.base_url}{endpoint}"
        response = _http_client.request(method, url, json=json, params=params, headers=headers, follow_redirects=True)
        if method == "GET" and response.status_code != httpx.codes.OK:
            raise _BillingHTTPStatusError(
                "Unable to retrieve billing information. Please try again later or contact support.",
                response.status_code,
            )
        if method == "PUT":
            if response.status_code == httpx.codes.INTERNAL_SERVER_ERROR:
                raise InternalServerError(
                    "Unable to process billing request. Please try again later or contact support."
                )
            if response.status_code != httpx.codes.OK:
                raise ValueError("Invalid arguments.")
        if method == "POST" and response.status_code != httpx.codes.OK:
            raise ValueError(f"Unable to send request to {url}. Please try again later or contact support.")
        if method == "DELETE" and response.status_code != httpx.codes.OK:
            logger.error("billing_service: DELETE response: %s %s", response.status_code, response.text)
            raise ValueError(f"Unable to process delete request {url}. Please try again later or contact support.")
        return response.json()

    @classmethod
    def _send_billing_portal_request(
        cls,
        endpoint: str,
        *,
        params: dict[str, str],
    ) -> BillingPortalLink:
        try:
            response = cls._send_request("GET", endpoint, params=params)
            return _billing_portal_link_adapter.validate_python(response)
        except _BillingHTTPStatusError as error:
            if error.status_code in {httpx.codes.REQUEST_TIMEOUT, httpx.codes.TOO_MANY_REQUESTS} or (
                error.status_code >= 500
            ):
                raise BillingUpstreamUnavailableError from error
            raise BillingUpstreamInvalidResponseError from error
        except httpx.RequestError as error:
            raise BillingUpstreamUnavailableError from error
        except (json.JSONDecodeError, UnicodeDecodeError, ValidationError) as error:
            raise BillingUpstreamInvalidResponseError from error
        except ValueError as error:
            raise RuntimeError("Unexpected billing service value error") from error

    @classmethod
    def delete_account(cls, account_id: str) -> MessageResponseDict:
        """Delete account."""
        params = {"account_id": account_id}
        return cls._send_request("DELETE", "/account", params=params)

    @classmethod
    def get_email_freeze_type(cls, email: str) -> EmailFreezeType | None:
        params = {"email": email}
        try:
            response = cls._send_request("GET", "/account/in-freeze", params=params)
            if not response.get("data", False):
                return None

            freeze_type = response.get("freeze_type") or response.get("freezeType")
            if freeze_type in ("freeze", "email_domain_suspended"):
                return freeze_type

            # Keep compatibility with older billing services that only return
            # the boolean `data` field.
            return "freeze"
        except Exception:
            return None

    @classmethod
    def is_email_in_freeze(cls, email: str) -> bool:
        return cls.get_email_freeze_type(email) is not None

    @classmethod
    def update_account_deletion_feedback(cls, email: str, feedback: str) -> MessageResponseDict:
        """Update account deletion feedback."""
        json = {"email": email, "feedback": feedback}
        return cls._send_request("POST", "/account/delete-feedback", json=json)

    class EducationIdentity:
        @classmethod
        def verify(cls, account_id: str) -> EducationVerifyResponseDict:
            params = {"account_id": account_id}
            return BillingService._send_request("GET", "/education/verify", params=params)

        @classmethod
        def status(cls, account_id: str) -> EducationStatusResponseDict:
            params = {"account_id": account_id}
            return BillingService._send_request("GET", "/education/status", params=params)

        @classmethod
        def activate(
            cls,
            *,
            account_id: str,
            tenant_id: str,
            token: str,
            institution: str,
            role: str,
        ) -> MessageResponseDict:
            params = {"account_id": account_id, "curr_tenant_id": tenant_id}
            json = {
                "institution": institution,
                "token": token,
                "role": role,
            }
            return BillingService._send_request("POST", "/education/", json=json, params=params)

        @classmethod
        def autocomplete(cls, keywords: str, page: int = 0, limit: int = 20) -> EducationAutocompleteResponseDict:
            params = {"keywords": keywords, "page": page, "limit": limit}
            return BillingService._send_request("GET", "/education/autocomplete", params=params)

    @classmethod
    def get_compliance_download_link(
        cls,
        doc_name: str,
        account_id: str,
        tenant_id: str,
        ip: str,
        device_info: str,
    ):
        limiter_key = f"{account_id}:{tenant_id}"
        if cls.compliance_download_rate_limiter.is_rate_limited(limiter_key):
            from controllers.console.error import ComplianceRateLimitError

            raise ComplianceRateLimitError()

        json = {
            "doc_name": doc_name,
            "account_id": account_id,
            "tenant_id": tenant_id,
            "ip_address": ip,
            "device_info": device_info,
        }
        res = cls._send_request("POST", "/compliance/download", json=json)
        cls.compliance_download_rate_limiter.increment_rate_limit(limiter_key)
        return res

    @classmethod
    def clean_billing_info_cache(cls, tenant_id: str) -> None:
        redis_client.delete(f"tenant:{tenant_id}:billing_info")

    @classmethod
    def sync_partner_tenants_bindings(cls, account_id: str, partner_key: str, click_id: str) -> dict[str, Any]:
        payload = {"account_id": account_id, "click_id": click_id}
        return cls._send_request("PUT", f"/partners/{partner_key}/tenants", json=payload)

    @classmethod
    def get_plan_bulk(cls, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        """
        Bulk fetch billing subscription plan via billing API.
        Payload: {"tenant_ids": ["t1", "t2", ...]} (max 200 per request)
        Returns:
            Mapping of tenant_id -> {plan: str, expiration_date: int}
        """
        results: dict[str, SubscriptionPlan] = {}
        subscription_adapter = TypeAdapter(SubscriptionPlan)

        chunk_size = 200
        for i in range(0, len(tenant_ids), chunk_size):
            chunk = tenant_ids[i : i + chunk_size]
            try:
                resp = cls._send_request("POST", "/subscription/plan/batch", json={"tenant_ids": chunk})
                data = resp.get("data", {})

                for tenant_id, plan in data.items():
                    try:
                        subscription_plan = subscription_adapter.validate_python(plan)
                        results[tenant_id] = subscription_plan
                    except Exception:
                        logger.exception(
                            "get_plan_bulk: failed to validate subscription plan for tenant(%s)", tenant_id
                        )
                        continue
            except Exception:
                logger.exception("get_plan_bulk: failed to fetch billing info batch for tenants: %s", chunk)
                continue

        return results

    @classmethod
    def _make_plan_cache_key(cls, tenant_id: str) -> str:
        return f"{cls._PLAN_CACHE_KEY_PREFIX}{tenant_id}"

    @classmethod
    def get_plan_bulk_with_cache(cls, tenant_ids: Sequence[str]) -> dict[str, SubscriptionPlan]:
        """
        Bulk fetch billing subscription plan with cache to reduce billing API loads in batch job scenarios.

        NOTE: if you want to high data consistency, use get_plan_bulk instead.

        Returns:
            Mapping of tenant_id -> {plan: str, expiration_date: int}
        """
        tenant_plans: dict[str, SubscriptionPlan] = {}

        if not tenant_ids:
            return tenant_plans

        subscription_adapter = TypeAdapter(SubscriptionPlan)

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

            for tenant_id, cached_value in zip(tenant_ids, cached_values):
                if cached_value:
                    try:
                        # Redis returns bytes, decode to string and parse JSON
                        json_str = cached_value.decode("utf-8") if isinstance(cached_value, bytes) else cached_value
                        plan_dict = json.loads(json_str)
                        # NOTE (hj24): New billing versions may return timestamp as str, and validate_python
                        # in non-strict mode will coerce it to the expected int type.
                        # To preserve compatibility, always keep non-strict mode here and avoid strict mode.
                        subscription_plan = subscription_adapter.validate_python(plan_dict)
                        # NOTE END
                        tenant_plans[tenant_id] = subscription_plan
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
                plans_to_cache: dict[str, SubscriptionPlan] = {}

                for tenant_id, subscription_plan in bulk_plans.items():
                    tenant_plans[tenant_id] = subscription_plan
                    plans_to_cache[tenant_id] = subscription_plan

                # Step 3: Batch update Redis cache using pipeline
                if plans_to_cache:
                    try:
                        pipe = redis_client.pipeline()
                        for tenant_id, subscription_plan in plans_to_cache.items():
                            redis_key = cls._make_plan_cache_key(tenant_id)
                            # Serialize dict to JSON string
                            json_str = json.dumps(subscription_plan)
                            pipe.setex(redis_key, cls._PLAN_CACHE_TTL, json_str)
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
        resp = cls._send_request("GET", "/subscription/cleanup/whitelist")
        data = resp.get("data", [])
        tenant_whitelist = []
        for item in data:
            tenant_whitelist.append(item["tenant_id"])
        return tenant_whitelist

    @classmethod
    def get_account_notification(cls, account_id: str) -> AccountNotificationDict:
        """Return the active in-product notification for account_id, if any.

        Calling this endpoint also marks the notification as seen; subsequent
        calls will return should_show=false when frequency='once'.

        Response shape (mirrors GetAccountNotificationReply):
          {
            "should_show": bool,
            "notification": {          # present only when should_show=true
              "notification_id": str,
              "contents": {            # lang -> LangContent
                "en": {"lang": "en", "title": ..., "subtitle": ..., "body": ..., "title_pic_url": ...},
                ...
              },
              "frequency": "once" | "every_page_load"
            }
          }
        """
        return cls._send_request("GET", "/notifications/active", params={"account_id": account_id})

    @classmethod
    def dismiss_notification(cls, notification_id: str, account_id: str) -> DismissNotificationDict:
        """Mark a notification as dismissed for an account.

        Returns {"success": bool}.
        """
        return cls._send_request(
            "POST",
            f"/notifications/{notification_id}/dismiss",
            json={"account_id": account_id},
        )
