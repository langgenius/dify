from collections.abc import Callable
from contextlib import nullcontext
from unittest.mock import Mock, patch

import pytest

from core.plugin.entities.plugin_daemon import CredentialType
from core.trigger.entities.entities import SubscriptionBuilder, SubscriptionBuilderUpdater
from core.trigger.trigger_manager import TriggerManager
from models.provider_ids import TriggerProviderID
from services.trigger.trigger_subscription_builder_service import TriggerSubscriptionBuilderService

PROVIDER_ID = TriggerProviderID("org/plugin/provider")


def subscription_builder() -> SubscriptionBuilder:
    return SubscriptionBuilder(
        id="builder-1",
        name="Builder",
        tenant_id="tenant-1",
        user_id="user-1",
        provider_id=str(PROVIDER_ID),
        endpoint_id="builder-1",
        parameters={},
        properties={},
        credentials={},
        credential_type=CredentialType.UNAUTHORIZED,
        credential_expires_at=-1,
        expires_at=-1,
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "other-builder"),
        ("tenant_id", "other-tenant"),
        ("user_id", "other-user"),
        ("provider_id", "org/plugin/other"),
    ],
)
def test_get_subscription_builder_rejects_non_owner(field: str, value: str) -> None:
    builder = subscription_builder().model_copy(update={field: value})
    with patch.object(
        TriggerSubscriptionBuilderService,
        "_get_subscription_builder_by_endpoint_id",
        return_value=builder,
    ):
        with pytest.raises(ValueError, match="not found"):
            TriggerSubscriptionBuilderService.get_subscription_builder(
                tenant_id="tenant-1",
                user_id="user-1",
                provider_id=PROVIDER_ID,
                subscription_builder_id="builder-1",
            )


def test_get_subscription_builder_accepts_owner() -> None:
    builder = subscription_builder()
    with patch.object(
        TriggerSubscriptionBuilderService,
        "_get_subscription_builder_by_endpoint_id",
        return_value=builder,
    ):
        assert (
            TriggerSubscriptionBuilderService.get_subscription_builder(
                tenant_id="tenant-1",
                user_id="user-1",
                provider_id=PROVIDER_ID,
                subscription_builder_id="builder-1",
            )
            is builder
        )


def test_get_subscription_builder_returns_none_when_temporary_builder_is_absent() -> None:
    with patch.object(
        TriggerSubscriptionBuilderService,
        "_get_subscription_builder_by_endpoint_id",
        return_value=None,
    ):
        assert (
            TriggerSubscriptionBuilderService.get_subscription_builder(
                tenant_id="tenant-1",
                user_id="user-1",
                provider_id=PROVIDER_ID,
                subscription_builder_id="builder-1",
            )
            is None
        )


def test_get_subscription_builder_rejects_mismatched_endpoint() -> None:
    builder = subscription_builder().model_copy(update={"endpoint_id": "other-builder"})
    with patch(
        "services.trigger.trigger_subscription_builder_service.redis_client.get",
        return_value=builder.model_dump_json(),
    ):
        assert TriggerSubscriptionBuilderService._get_subscription_builder_by_endpoint_id("builder-1") is None


def test_get_subscription_builder_accepts_matching_endpoint() -> None:
    builder = subscription_builder()
    with patch(
        "services.trigger.trigger_subscription_builder_service.redis_client.get",
        return_value=builder.model_dump_json(),
    ):
        assert TriggerSubscriptionBuilderService._get_subscription_builder_by_endpoint_id("builder-1") == builder


@pytest.mark.parametrize(
    ("operation", "needs_updater"),
    [
        (TriggerSubscriptionBuilderService.update_trigger_subscription_builder, True),
        (TriggerSubscriptionBuilderService.update_and_verify_builder, True),
        (TriggerSubscriptionBuilderService.update_and_build_builder, True),
        (TriggerSubscriptionBuilderService.list_logs, False),
        (TriggerSubscriptionBuilderService.get_subscription_builder_by_id, False),
    ],
)
def test_owner_scoped_operations_reject_missing_builder_before_side_effects(
    operation: Callable[..., object], needs_updater: bool
) -> None:
    kwargs: dict[str, object] = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "provider_id": PROVIDER_ID,
        "subscription_builder_id": "builder-1",
    }
    if needs_updater:
        kwargs["subscription_builder_updater"] = SubscriptionBuilderUpdater(name="Updated")

    with (
        patch.object(TriggerManager, "get_trigger_provider", return_value=Mock()),
        patch.object(TriggerSubscriptionBuilderService, "acquire_builder_lock", return_value=nullcontext()),
        patch.object(
            TriggerSubscriptionBuilderService,
            "get_subscription_builder",
            return_value=None,
        ) as get_subscription_builder,
        patch("services.trigger.trigger_subscription_builder_service.redis_client.setex") as setex,
        patch("services.trigger.trigger_subscription_builder_service.redis_client.delete") as delete,
    ):
        with pytest.raises(ValueError, match="not found"):
            operation(**kwargs)

    get_subscription_builder.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider_id=PROVIDER_ID,
        subscription_builder_id="builder-1",
    )
    setex.assert_not_called()
    delete.assert_not_called()


def test_update_and_build_uses_the_owned_builder_without_refetching() -> None:
    builder = subscription_builder()
    cache_key = TriggerSubscriptionBuilderService.encode_cache_key(builder.id)

    with (
        patch.object(TriggerManager, "get_trigger_provider", return_value=Mock()),
        patch.object(TriggerSubscriptionBuilderService, "acquire_builder_lock", return_value=nullcontext()),
        patch.object(
            TriggerSubscriptionBuilderService,
            "get_subscription_builder",
            return_value=builder,
        ) as get_subscription_builder,
        patch("services.trigger.trigger_subscription_builder_service.redis_client.setex") as setex,
        patch(
            "services.trigger.trigger_subscription_builder_service.TriggerProviderService.add_trigger_subscription"
        ) as add_subscription,
        patch("services.trigger.trigger_subscription_builder_service.redis_client.delete") as delete,
    ):
        TriggerSubscriptionBuilderService.update_and_build_builder(
            tenant_id="tenant-1",
            user_id="user-1",
            provider_id=PROVIDER_ID,
            subscription_builder_id=builder.id,
            subscription_builder_updater=SubscriptionBuilderUpdater(name="Updated"),
        )

    get_subscription_builder.assert_called_once_with(
        tenant_id="tenant-1",
        user_id="user-1",
        provider_id=PROVIDER_ID,
        subscription_builder_id=builder.id,
    )
    setex.assert_called_once_with(cache_key, 30 * 60, builder.model_dump_json())
    add_subscription.assert_called_once()
    subscription_call = add_subscription.call_args.kwargs
    assert subscription_call["subscription_id"] == builder.id
    assert subscription_call["tenant_id"] == "tenant-1"
    assert subscription_call["user_id"] == "user-1"
    assert subscription_call["provider_id"] == PROVIDER_ID
    assert subscription_call["endpoint_id"] == builder.endpoint_id
    assert subscription_call["name"] == "Updated"
    delete.assert_called_once_with(cache_key)


def test_list_logs_uses_the_owned_builder_endpoint() -> None:
    builder = subscription_builder()
    logs_key = f"trigger:subscription:builder:logs:{builder.endpoint_id}"

    with (
        patch.object(TriggerSubscriptionBuilderService, "get_subscription_builder", return_value=builder),
        patch("services.trigger.trigger_subscription_builder_service.redis_client.get", return_value=None) as redis_get,
    ):
        assert (
            TriggerSubscriptionBuilderService.list_logs(
                tenant_id="tenant-1",
                user_id="user-1",
                provider_id=PROVIDER_ID,
                subscription_builder_id=builder.id,
            )
            == []
        )

    redis_get.assert_called_once_with(logs_key)


def test_process_validation_endpoint_uses_the_public_capability() -> None:
    builder = subscription_builder()
    request = Mock()
    response = Mock()
    controller = Mock()
    controller.dispatch.return_value = Mock(response=response)

    with (
        patch.object(
            TriggerSubscriptionBuilderService,
            "_get_subscription_builder_by_endpoint_id",
            return_value=builder,
        ) as get_by_endpoint,
        patch.object(TriggerSubscriptionBuilderService, "get_subscription_builder") as get_owned,
        patch.object(TriggerManager, "get_trigger_provider", return_value=controller) as get_provider,
        patch.object(TriggerSubscriptionBuilderService, "append_log") as append_log,
    ):
        assert (
            TriggerSubscriptionBuilderService.process_builder_validation_endpoint(builder.endpoint_id, request)
            is response
        )

    get_by_endpoint.assert_called_once_with(builder.endpoint_id)
    get_owned.assert_not_called()
    get_provider.assert_called_once()
    provider_call = get_provider.call_args.kwargs
    assert provider_call["tenant_id"] == builder.tenant_id
    assert str(provider_call["provider_id"]) == str(PROVIDER_ID)
    controller.dispatch.assert_called_once()
    append_log.assert_called_once()
