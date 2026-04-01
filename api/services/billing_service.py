import json
import logging
import os
from collections.abc import Sequence
from typing import Literal

import httpx
from pydantic import TypeAdapter
from sqlalchemy import select
from tenacity import retry, retry_if_exception_type, stop_before_delay, wait_fixed
from typing_extensions import TypedDict
from werkzeug.exceptions import InternalServerError

from core.helper.http_client_pooling import get_pooled_http_client
from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.helper import RateLimiter
from models import Account, TenantAccountJoin, TenantAccountRole

logger = logging.getLogger(__name__)

_http_client: httpx.Client = get_pooled_http_client(
    "billing:default",
    lambda: httpx.Client(limits=httpx.Limits(max_keepalive_connections=50, max_connections=100)),
)


class SubscriptionPlan(TypedDict):
    """Tenant subscriptionplan information."""

    plan: str
    expiration_date: int


class BillingService:
    base_url = os.environ.get("BILLING_API_URL", "BILLING_API_URL")
    secret_key = os.environ.get("BILLING_API_SECRET_KEY", "BILLING_API_SECRET_KEY")

    compliance_download_rate_limiter = RateLimiter("compliance_download_rate_limiter", 4, 60)

    # Redis key prefix for tenant plan cache
    _PLAN_CACHE_KEY_PREFIX = "tenant_plan:"
    # Cache TTL: 10 minutes
    _PLAN_CACHE_TTL = 600

    @classmethod
    def get_info(cls, tenant_id: str):
        params = {"tenant_id": tenant_id}

        billing_info = cls._send_request("GET", "/subscription/info", params=params)
        return billing_info

    @classmethod
    def get_tenant_feature_plan_usage_info(cls, tenant_id: str):
        params = {"tenant_id": tenant_id}

        usage_info = cls._send_request("GET", "/tenant-feature-usage/info", params=params)
        return usage_info

    @classmethod
    def get_knowledge_rate_limit(cls, tenant_id: str):
        params = {"tenant_id": tenant_id}

        knowledge_rate_limit = cls._send_request("GET", "/subscription/knowledge-rate-limit", params=params)

        return {
            "limit": knowledge_rate_limit.get("limit", 10),
            "subscription_plan": knowledge_rate_limit.get("subscription_plan", CloudPlan.SANDBOX),
        }

    @classmethod
    def get_subscription(cls, plan: str, interval: str, prefilled_email: str = "", tenant_id: str = ""):
        params = {"plan": plan, "interval": interval, "prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_request("GET", "/subscription/payment-link", params=params)

    @classmethod
    def get_model_provider_payment_link(cls, provider_name: str, tenant_id: str, account_id: str, prefilled_email: str):
        params = {
            "provider_name": provider_name,
            "tenant_id": tenant_id,
            "account_id": account_id,
            "prefilled_email": prefilled_email,
        }
        return cls._send_request("GET", "/model-provider/payment-link", params=params)

    @classmethod
    def get_invoices(cls, prefilled_email: str = "", tenant_id: str = ""):
        params = {"prefilled_email": prefilled_email, "tenant_id": tenant_id}
        return cls._send_request("GET", "/invoices", params=params)

    @classmethod
    def update_tenant_feature_plan_usage(cls, tenant_id: str, feature_key: str, delta: int) -> dict:
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
    def refund_tenant_feature_plan_usage(cls, history_id: str) -> dict:
        """
        Refund a previous usage charge.

        Args:
            history_id: The history_id returned from update_tenant_feature_plan_usage

        Returns:
            Response dict with 'result' and 'history_id'
        """
        return cls._send_request("POST", "/tenant-feature-usage/refund", params={"quota_usage_history_id": history_id})

    @classmethod
    def get_tenant_feature_plan_usage(cls, tenant_id: str, feature_key: str):
        params = {"tenant_id": tenant_id, "feature_key": feature_key}
        return cls._send_request("GET", "/billing/tenant_feature_plan/usage", params=params)

    @classmethod
    @retry(
        wait=wait_fixed(2),
        stop=stop_before_delay(10),
        retry=retry_if_exception_type(httpx.RequestError),
        reraise=True,
    )
    def _send_request(cls, method: Literal["GET", "POST", "DELETE", "PUT"], endpoint: str, json=None, params=None):
        headers = {"Content-Type": "application/json", "Billing-Api-Secret-Key": cls.secret_key}

        url = f"{cls.base_url}{endpoint}"
        response = _http_client.request(method, url, json=json, params=params, headers=headers, follow_redirects=True)
        if method == "GET" and response.status_code != httpx.codes.OK:
            raise ValueError("Unable to retrieve billing information. Please try again later or contact support.")
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

    @staticmethod
    def is_tenant_owner_or_admin(current_user: Account):
        tenant_id = current_user.current_tenant_id

        join: TenantAccountJoin | None = db.session.scalar(
            select(TenantAccountJoin)
            .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.account_id == current_user.id)
            .limit(1)
        )

        if not join:
            raise ValueError("Tenant account join not found")

        if not TenantAccountRole.is_privileged_role(TenantAccountRole(join.role)):
            raise ValueError("Only team owner or team admin can perform this action")

    @classmethod
    def delete_account(cls, account_id: str):
        """Delete account."""
        params = {"account_id": account_id}
        return cls._send_request("DELETE", "/account", params=params)

    @classmethod
    def is_email_in_freeze(cls, email: str) -> bool:
        params = {"email": email}
        try:
            response = cls._send_request("GET", "/account/in-freeze", params=params)
            return bool(response.get("data", False))
        except Exception:
            return False

    @classmethod
    def update_account_deletion_feedback(cls, email: str, feedback: str):
        """Update account deletion feedback."""
        json = {"email": email, "feedback": feedback}
        return cls._send_request("POST", "/account/delete-feedback", json=json)

    class EducationIdentity:
        verification_rate_limit = RateLimiter(prefix="edu_verification_rate_limit", max_attempts=10, time_window=60)
        activation_rate_limit = RateLimiter(prefix="edu_activation_rate_limit", max_attempts=10, time_window=60)

        @classmethod
        def verify(cls, account_id: str, account_email: str):
            if cls.verification_rate_limit.is_rate_limited(account_email):
                from controllers.console.error import EducationVerifyLimitError

                raise EducationVerifyLimitError()

            cls.verification_rate_limit.increment_rate_limit(account_email)

            params = {"account_id": account_id}
            return BillingService._send_request("GET", "/education/verify", params=params)

        @classmethod
        def status(cls, account_id: str):
            params = {"account_id": account_id}
            return BillingService._send_request("GET", "/education/status", params=params)

        @classmethod
        def activate(cls, account: Account, token: str, institution: str, role: str):
            if cls.activation_rate_limit.is_rate_limited(account.email):
                from controllers.console.error import EducationActivateLimitError

                raise EducationActivateLimitError()

            cls.activation_rate_limit.increment_rate_limit(account.email)
            params = {"account_id": account.id, "curr_tenant_id": account.current_tenant_id}
            json = {
                "institution": institution,
                "token": token,
                "role": role,
            }
            return BillingService._send_request("POST", "/education/", json=json, params=params)

        @classmethod
        def autocomplete(cls, keywords: str, page: int = 0, limit: int = 20):
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
    def clean_billing_info_cache(cls, tenant_id: str):
        redis_client.delete(f"tenant:{tenant_id}:billing_info")

    @classmethod
    def sync_partner_tenants_bindings(cls, account_id: str, partner_key: str, click_id: str):
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
    def get_account_notification(cls, account_id: str) -> dict:
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
    def upsert_notification(
        cls,
        contents: list[dict],
        frequency: str = "once",
        status: str = "active",
        notification_id: str | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
    ) -> dict:
        """Create or update a notification.

        contents: list of {"lang": str, "title": str, "subtitle": str, "body": str, "title_pic_url": str}
        start_time / end_time: RFC3339 strings (e.g. "2026-03-01T00:00:00Z"), optional.
        Returns {"notification_id": str}.
        """
        payload: dict = {
            "contents": contents,
            "frequency": frequency,
            "status": status,
        }
        if notification_id:
            payload["notification_id"] = notification_id
        if start_time:
            payload["start_time"] = start_time
        if end_time:
            payload["end_time"] = end_time
        return cls._send_request("POST", "/notifications", json=payload)

    @classmethod
    def batch_add_notification_accounts(cls, notification_id: str, account_ids: list[str]) -> dict:
        """Register target account IDs for a notification (max 1000 per call).

        Returns {"count": int}.
        """
        return cls._send_request(
            "POST",
            f"/notifications/{notification_id}/accounts",
            json={"account_ids": account_ids},
        )

    @classmethod
    def dismiss_notification(cls, notification_id: str, account_id: str) -> dict:
        """Mark a notification as dismissed for an account.

        Returns {"success": bool}.
        """
        return cls._send_request(
            "POST",
            f"/notifications/{notification_id}/dismiss",
            json={"account_id": account_id},
        )
