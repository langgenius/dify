"""Due-window tests for trigger OAuth / subscription refresh helpers.

The poller (`_build_due_filter`) and executor (`_refresh_oauth_if_expired`,
`_refresh_subscription_if_expired`) share `TRIGGER_PROVIDER_*_THRESHOLD_SECONDS`.
A 1h default made a freshly refreshed 1h OAuth token immediately due again.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.plugin.entities.plugin_daemon import CredentialType
from models.trigger import TriggerSubscription
from tasks.trigger_subscription_refresh_tasks import (
    _refresh_oauth_if_expired,
    _refresh_subscription_if_expired,
)

NOW = 1_700_000_000


def _subscription(
    *,
    name: str,
    credential_type: CredentialType = CredentialType.OAUTH2,
    credential_expires_at: int = -1,
    expires_at: int = -1,
) -> TriggerSubscription:
    subscription = TriggerSubscription(
        tenant_id="tenant-123",
        user_id="user-123",
        name=name,
        endpoint_id=f"endpoint-{name}",
        provider_id="langgenius/gmail/gmail",
        parameters={},
        properties={},
        credentials={},
        credential_type=credential_type,
        credential_expires_at=credential_expires_at,
        expires_at=expires_at,
    )
    subscription.id = f"subscription-{name}"
    return subscription


def test_default_refresh_thresholds_are_below_typical_oauth_ttl() -> None:
    assert dify_config.TRIGGER_PROVIDER_CREDENTIAL_THRESHOLD_SECONDS == 300
    assert dify_config.TRIGGER_PROVIDER_SUBSCRIPTION_THRESHOLD_SECONDS == 300


@pytest.mark.parametrize(
    ("credential_expires_at", "should_refresh"),
    [
        (NOW + 3600, False),
        (NOW + 200, True),
        (-1, False),
    ],
)
def test_refresh_oauth_if_expired_respects_threshold(credential_expires_at: int, should_refresh: bool) -> None:
    subscription = _subscription(name="oauth", credential_expires_at=credential_expires_at)

    with patch(
        "tasks.trigger_subscription_refresh_tasks.TriggerProviderService.refresh_oauth_token",
        return_value={"result": "ok"},
    ) as refresh:
        _refresh_oauth_if_expired(tenant_id="tenant-123", subscription=subscription, now=NOW)

    if should_refresh:
        refresh.assert_called_once_with(tenant_id="tenant-123", subscription_id=subscription.id)
    else:
        refresh.assert_not_called()


@pytest.mark.parametrize(
    ("expires_at", "should_refresh"),
    [
        (NOW + 3600, False),
        (NOW + 200, True),
        (-1, False),
    ],
)
def test_refresh_subscription_if_expired_respects_threshold(expires_at: int, should_refresh: bool) -> None:
    subscription = _subscription(name="lease", expires_at=expires_at)

    with patch(
        "tasks.trigger_subscription_refresh_tasks.TriggerProviderService.refresh_subscription",
        return_value={"result": "ok"},
    ) as refresh:
        _refresh_subscription_if_expired(tenant_id="tenant-123", subscription=subscription, now=NOW)

    if should_refresh:
        refresh.assert_called_once_with(tenant_id="tenant-123", subscription_id=subscription.id, now=NOW)
    else:
        refresh.assert_not_called()


def test_build_due_filter_skips_fresh_token_and_never_expire(sqlite_session: Session) -> None:
    from schedule.trigger_provider_refresh_task import _build_due_filter

    fresh = _subscription(name="fresh-oauth", credential_expires_at=NOW + 3600)
    due_oauth = _subscription(name="due-oauth", credential_expires_at=NOW + 200)
    never_oauth = _subscription(name="never-oauth", credential_expires_at=-1)
    fresh_lease = _subscription(name="fresh-lease", expires_at=NOW + 3600)
    due_lease = _subscription(name="due-lease", expires_at=NOW + 200)
    never_lease = _subscription(name="never-lease", expires_at=-1)

    sqlite_session.add_all([fresh, due_oauth, never_oauth, fresh_lease, due_lease, never_lease])
    sqlite_session.flush()

    due_ids = set(sqlite_session.scalars(select(TriggerSubscription.id).where(_build_due_filter(now_ts=NOW))))

    assert due_ids == {due_oauth.id, due_lease.id}
