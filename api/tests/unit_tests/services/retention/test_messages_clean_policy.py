import datetime
from unittest.mock import MagicMock, patch

from services.retention.conversation.messages_clean_policy import (
    BillingDisabledPolicy,
    BillingSandboxPolicy,
    SimpleMessage,
    create_message_clean_policy,
)

MODULE = "services.retention.conversation.messages_clean_policy"


def _msg(msg_id: str, app_id: str, days_ago: int = 0) -> SimpleMessage:
    return SimpleMessage(
        id=msg_id,
        app_id=app_id,
        created_at=datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=days_ago),
    )


class TestBillingDisabledPolicy:
    def test_returns_all_message_ids(self):
        policy = BillingDisabledPolicy()
        msgs = [_msg("m1", "app1"), _msg("m2", "app2"), _msg("m3", "app1")]

        result = policy.filter_message_ids(msgs, {"app1": "t1", "app2": "t2"})

        assert set(result) == {"m1", "m2", "m3"}

    def test_empty_messages_returns_empty(self):
        assert BillingDisabledPolicy().filter_message_ids([], {}) == []


class TestBillingSandboxPolicy:
    def _policy(self, plans, *, graceful_days=21, whitelist=None, now=1_000_000_000):
        return BillingSandboxPolicy(
            plan_provider=lambda _ids: plans,
            graceful_period_days=graceful_days,
            tenant_whitelist=whitelist,
            current_timestamp=now,
        )

    def test_empty_messages_returns_empty(self):
        policy = self._policy({})
        assert policy.filter_message_ids([], {"app1": "t1"}) == []

    def test_empty_app_to_tenant_returns_empty(self):
        policy = self._policy({})
        assert policy.filter_message_ids([_msg("m1", "app1")], {}) == []

    def test_empty_plans_returns_empty(self):
        policy = self._policy({})
        msgs = [_msg("m1", "app1")]
        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == []

    def test_non_sandbox_tenant_skipped(self):
        plans = {"t1": {"plan": "professional", "expiration_date": 0}}
        policy = self._policy(plans)
        msgs = [_msg("m1", "app1")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == []

    def test_sandbox_no_previous_subscription_deletes(self):
        plans = {"t1": {"plan": "sandbox", "expiration_date": -1}}
        policy = self._policy(plans)
        msgs = [_msg("m1", "app1")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == ["m1"]

    def test_sandbox_expired_beyond_grace_period_deletes(self):
        now = 1_000_000_000
        expired_long_ago = now - (22 * 24 * 60 * 60)  # 22 days ago > 21 day grace
        plans = {"t1": {"plan": "sandbox", "expiration_date": expired_long_ago}}
        policy = self._policy(plans, now=now)
        msgs = [_msg("m1", "app1")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == ["m1"]

    def test_sandbox_within_grace_period_kept(self):
        now = 1_000_000_000
        expired_recently = now - (10 * 24 * 60 * 60)  # 10 days ago < 21 day grace
        plans = {"t1": {"plan": "sandbox", "expiration_date": expired_recently}}
        policy = self._policy(plans, now=now)
        msgs = [_msg("m1", "app1")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == []

    def test_whitelisted_tenant_skipped(self):
        plans = {"t1": {"plan": "sandbox", "expiration_date": -1}}
        policy = self._policy(plans, whitelist=["t1"])
        msgs = [_msg("m1", "app1")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == []

    def test_message_without_tenant_mapping_skipped(self):
        plans = {"t1": {"plan": "sandbox", "expiration_date": -1}}
        policy = self._policy(plans)
        msgs = [_msg("m1", "unmapped_app")]

        assert policy.filter_message_ids(msgs, {"app1": "t1"}) == []

    def test_mixed_tenants_only_sandbox_deleted(self):
        plans = {
            "t_sandbox": {"plan": "sandbox", "expiration_date": -1},
            "t_pro": {"plan": "professional", "expiration_date": 0},
        }
        policy = self._policy(plans)
        msgs = [_msg("m1", "app_sandbox"), _msg("m2", "app_pro")]
        app_map = {"app_sandbox": "t_sandbox", "app_pro": "t_pro"}

        result = policy.filter_message_ids(msgs, app_map)

        assert result == ["m1"]


class TestCreateMessageCleanPolicy:
    def test_billing_disabled_returns_disabled_policy(self):
        with patch(f"{MODULE}.dify_config") as cfg:
            cfg.BILLING_ENABLED = False
            policy = create_message_clean_policy()

        assert isinstance(policy, BillingDisabledPolicy)

    def test_billing_enabled_returns_sandbox_policy(self):
        with (
            patch(f"{MODULE}.dify_config") as cfg,
            patch(f"{MODULE}.BillingService") as bs,
        ):
            cfg.BILLING_ENABLED = True
            bs.get_expired_subscription_cleanup_whitelist.return_value = ["wl1"]
            bs.get_plan_bulk_with_cache = MagicMock()
            policy = create_message_clean_policy(graceful_period_days=30)

        assert isinstance(policy, BillingSandboxPolicy)
