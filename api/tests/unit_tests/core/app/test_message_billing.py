from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from configs import dify_config
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
)
from core.app.llm.message_billing import begin_message_billing, release_message_billing, require_message_billing
from core.entities.provider_entities import ProviderQuotaType, QuotaConfiguration, QuotaUnit, SystemConfiguration
from core.model_invocation_routing import (
    FrozenModelInvocation,
    LegacyModelBinding,
    LegacyModelCredentials,
    RoutedModelCredentials,
)
from core.model_manager import ModelInstance, QuotaManagedModelInstance, create_model_instance
from enums import DeploymentEdition
from events.event_handlers import update_provider_when_message_created as message_event
from graphon.model_runtime.entities.model_entities import ModelType
from models.model import AppMode, Message
from models.provider import ProviderType
from tests.unit_tests.core.model_fixtures import make_model_config

TENANT = "11111111-1111-4111-8111-111111111111"
MESSAGE = "22222222-2222-4222-8222-222222222222"
PROVIDER = "langgenius/openai/openai"


def entity(agent=False, quota_type=ProviderQuotaType.PAID, tokener=False):
    credentials = LegacyModelCredentials(
        {"api_key": "TEST_LEGACY"}, LegacyModelBinding(TENANT, PROVIDER, "gpt-4o", ModelType.LLM, 0)
    )
    if tokener:
        credentials = RoutedModelCredentials(
            FrozenModelInvocation(
                tenant_id=TENANT,
                route_id=MESSAGE,
                logical_provider=PROVIDER,
                logical_model="gpt-4o",
                model_type=ModelType.LLM,
                route_epoch=1,
                mapping_revision="fixture-v1",
                credential_id="managed",
                expected_credential_fingerprint="sha256:" + "a" * 64,
                plugin_unique_identifier="langgenius/tokener:0.1.3@fixture",
                target_model="fixture-target",
                operations=("llm/invoke",),
            )
        )
    if quota_type == ProviderQuotaType.FREE:
        credentials = {"api_key": "INDEPENDENT_FREE"}
    configuration = SimpleNamespace(
        tenant_id=TENANT,
        using_provider_type=ProviderType.SYSTEM,
        provider=SimpleNamespace(provider=PROVIDER),
        model_settings=[],
        system_configuration=SystemConfiguration(
            enabled=True,
            current_quota_type=quota_type,
            quota_configurations=[
                QuotaConfiguration(
                    quota_type=quota_type, quota_unit=QuotaUnit.CREDITS, quota_limit=10, quota_used=9, is_valid=True
                )
            ],
        ),
    )
    llm = make_model_config(provider=PROVIDER, model="gpt-4o", mode="chat").provider_model_bundle.model_type_instance
    llm.invoke = Mock()
    bundle = SimpleNamespace(configuration=configuration, model_type_instance=llm)
    cls = AgentChatAppGenerateEntity if agent else ChatAppGenerateEntity
    return cls.model_construct(
        task_id="fixture-task",
        app_config=SimpleNamespace(tenant_id=TENANT, app_mode=AppMode.AGENT_CHAT if agent else AppMode.CHAT),
        model_conf=SimpleNamespace(
            provider=PROVIDER, model="gpt-4o", credentials=credentials, provider_model_bundle=bundle
        ),
    )


@pytest.fixture
def billing(mocker, config_overrides):
    state = {"phase": "prepared", "route_epoch": 0, "model_mapping_version": "fixture-v1"}
    mocker.patch("core.model_invocation_routing.migration_routing_state", side_effect=lambda _: state)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    mocker.patch.object(type(dify_config), "get_model_credits", return_value=9)
    reserve = mocker.patch("core.app.llm.quota.CreditPoolService.reserve_credits_capped")
    reserve.return_value.amount = 1  # Atomic capped tail balance, not the requested 9.
    reserve.return_value.reservation_id = None
    per_call = mocker.patch("core.app.llm.quota.reserve_model_quota_for_model")
    capped_event = mocker.patch.object(message_event, "_deduct_credit_pool_quota_capped")
    updates = mocker.patch.object(message_event, "_execute_provider_updates")
    profile = mocker.patch.object(message_event, "_legacy_message_credit_billing_allowed", return_value=False)
    return SimpleNamespace(
        state=state, reserve=reserve, per_call=per_call, capped_event=capped_event, updates=updates, profile=profile
    )


@pytest.mark.parametrize(("agent", "llm_calls"), [(False, 1), (True, 4)])
def test_classic_message_reserves_once_and_commits_original_receipt_after_cutover(billing, agent, llm_calls):
    app = entity(agent=agent)
    owner = begin_message_billing(app, MESSAGE)
    assert begin_message_billing(app, MESSAGE) is owner
    assert owner.backend == "legacy_reserved"
    assert owner.reservation.amount == 1
    assert billing.reserve.call_args.kwargs["credits_required"] == 9
    assert billing.reserve.call_args.kwargs["request_id"] == MESSAGE
    assert billing.reserve.call_args.kwargs["pool_type"] == "paid"
    assert billing.reserve.call_args.kwargs["meta"] == {
        "source": "message.created",
        "provider": PROVIDER,
        "model": "gpt-4o",
        "model_type": "llm",
        "app_type": "agent" if agent else "chatbot",
        "created_by": "app",
    }
    billing.reserve.assert_called_once()
    instance = create_model_instance(
        app.model_conf.provider_model_bundle, "gpt-4o", credentials=app.model_conf.credentials, message_billing=owner
    )
    assert type(instance) is ModelInstance
    assert not isinstance(instance, QuotaManagedModelInstance)
    billing.state.update(phase="active", route_epoch=1)
    for _ in range(llm_calls):
        instance.invoke_llm([], stream=False)
    assert instance.model_type_instance.invoke.call_count == llm_calls
    billing.per_call.assert_not_called()
    message = Message(message_tokens=1, answer_tokens=1)
    message.id = MESSAGE
    for _ in range(2):
        message_event.handle(message, application_generate_entity=app)
    release_message_billing(app)
    owner.reservation.commit.assert_called_once()
    owner.reservation.release.assert_not_called()
    billing.capped_event.assert_not_called()
    billing.profile.assert_not_called()


def test_tokener_message_never_touches_legacy_even_if_profile_read_would_allow_it(billing):
    billing.state.update(phase="active", route_epoch=1)
    billing.profile.return_value = True
    app = entity(tokener=True)
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "tokener"
    message = Message(message_tokens=2, answer_tokens=3)
    message.id = MESSAGE
    message_event.handle(message, application_generate_entity=app)
    release_message_billing(app)
    billing.reserve.assert_not_called()
    billing.per_call.assert_not_called()
    billing.capped_event.assert_not_called()
    billing.profile.assert_not_called()


@pytest.mark.parametrize("gateway_enabled", [False, True])
def test_only_enabled_agent_app_gateway_bypasses_message_reservation(billing, gateway_enabled):
    classic = entity()
    app = AgentAppGenerateEntity.model_construct(
        task_id=classic.task_id,
        app_config=classic.app_config,
        model_conf=classic.model_conf,
        agent_id="fixture-agent",
        agent_config_snapshot_id="fixture-snapshot",
        agent_llm_gateway_enabled=gateway_enabled,
    )
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == ("custom" if gateway_enabled else "legacy_reserved")
    assert require_message_billing(app) is owner
    assert billing.reserve.call_count == (0 if gateway_enabled else 1)
    release_message_billing(app)


def test_non_cloud_legacy_keeps_post_message_capped_accounting(billing, mocker, config_overrides):
    mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=None)
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    billing.profile.return_value = True
    app = entity(agent=True)
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "legacy_event"
    message = Message(message_tokens=2, answer_tokens=3)
    message.id = MESSAGE
    message_event.handle(message, application_generate_entity=app)
    message_event.handle(message, application_generate_entity=app)
    billing.reserve.assert_not_called()
    billing.per_call.assert_not_called()
    billing.capped_event.assert_called_once()


def test_message_started_before_any_migration_row_commits_after_claim(billing, mocker):
    state = mocker.patch("core.model_invocation_routing.migration_routing_state", return_value=None)
    app = entity(agent=True)
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "legacy_reserved"
    state.return_value = {"phase": "active", "route_epoch": 1}
    message = Message(message_tokens=2, answer_tokens=3)
    message.id = MESSAGE
    message_event.handle(message, application_generate_entity=app)
    release_message_billing(app)
    owner.reservation.commit.assert_called_once()
    billing.profile.assert_not_called()
    billing.capped_event.assert_not_called()


def test_independent_free_stays_message_scoped_after_profile_cutover(billing):
    app = entity(agent=True, quota_type=ProviderQuotaType.FREE)
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "provider_free"
    message = Message(message_tokens=2, answer_tokens=3)
    message.id = MESSAGE
    message_event.handle(message, application_generate_entity=app)
    message_event.handle(message, application_generate_entity=app)
    operations = [operation for call in billing.updates.call_args_list for operation in call.args[0]]
    assert sum(operation.description == "quota_deduction_update" for operation in operations) == 1
    billing.reserve.assert_not_called()
    billing.per_call.assert_not_called()
    billing.capped_event.assert_not_called()


@pytest.mark.usefixtures("billing")
def test_failed_or_abandoned_message_releases_receipt_once():
    app = entity()
    owner = begin_message_billing(app, MESSAGE)
    release_message_billing(app)
    release_message_billing(app)
    owner.reservation.release.assert_called_once()
    owner.reservation.commit.assert_not_called()


@pytest.mark.usefixtures("billing")
def test_unknown_commit_result_does_not_trigger_competing_release():
    app = entity()
    owner = begin_message_billing(app, MESSAGE)
    owner.reservation.commit.side_effect = TimeoutError("fixture")
    with pytest.raises(TimeoutError):
        owner.commit_reserved()
    release_message_billing(app)
    owner.reservation.release.assert_not_called()


@pytest.mark.usefixtures("billing")
def test_receipt_and_credentials_are_not_serialized_into_task_payload():
    app = entity()
    begin_message_billing(app, MESSAGE)
    assert "_classic_message_billing" not in app.model_dump()
    release_message_billing(app)


def test_remote_receipt_renews_and_failed_renewal_blocks_agent_next_turn(billing, mocker):
    mocker.patch("core.app.llm.message_billing.MESSAGE_RESERVATION_HEARTBEAT_SECONDS", 0.01)
    billing.reserve.return_value.reservation_id = "remote-receipt"
    renewed = Event()

    def fail_renew():
        renewed.set()
        raise TimeoutError("fixture")

    billing.reserve.return_value.renew.side_effect = fail_renew
    app = entity(agent=True)
    owner = begin_message_billing(app, MESSAGE)
    instance = create_model_instance(
        app.model_conf.provider_model_bundle, "gpt-4o", credentials=app.model_conf.credentials, message_billing=owner
    )
    assert renewed.wait(1)
    # Synchronize with the heartbeat's failure marker rather than its RPC entry.
    with owner._lock:
        pass
    from core.model_invocation_routing import ModelMigrationProcessing

    with pytest.raises(ModelMigrationProcessing):
        instance.invoke_llm([], stream=False)
    instance.model_type_instance.invoke.assert_not_called()
    with pytest.raises(ModelMigrationProcessing):
        owner.commit_reserved()
    release_message_billing(app)
    owner.reservation.release.assert_called_once()


def test_lost_message_receipt_never_falls_back_to_per_llm_billing():
    from core.model_invocation_routing import ModelRouteUnavailable

    with pytest.raises(ModelRouteUnavailable):
        require_message_billing(entity())


@pytest.mark.usefixtures("billing")
def test_delayed_heartbeat_is_renewed_before_another_model_call():
    app = entity(agent=True)
    owner = begin_message_billing(app, MESSAGE)
    owner.reservation.reservation_id = "remote-hold"
    owner._last_renewed_at = 0
    owner.check_active()
    owner.check_active()
    owner.reservation.renew.assert_called_once()
    release_message_billing(app)


def test_zero_credit_model_does_not_create_an_invalid_zero_hold(billing, mocker):
    mocker.patch.object(type(dify_config), "get_model_credits", return_value=0)
    app = entity()
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "unmetered"
    billing.reserve.assert_not_called()


@pytest.mark.parametrize("quota_type", [ProviderQuotaType.PAID, ProviderQuotaType.TRIAL])
@pytest.mark.parametrize(("quota_unit", "amount"), [(QuotaUnit.CREDITS, 9), (QuotaUnit.TIMES, 1)])
def test_message_quota_adapter_preserves_bucket_and_charge(billing, quota_type, quota_unit, amount):
    app = entity(quota_type=quota_type)
    quota = app.model_conf.provider_model_bundle.configuration.system_configuration.quota_configurations[0]
    quota.quota_unit = quota_unit
    owner = begin_message_billing(app, MESSAGE)
    assert owner.backend == "legacy_reserved"
    assert billing.reserve.call_args.kwargs["pool_type"] == quota_type.value
    assert billing.reserve.call_args.kwargs["credits_required"] == amount
    assert billing.reserve.call_args.kwargs["request_id"] == MESSAGE
    billing.reserve.assert_called_once()
    release_message_billing(app)


@pytest.mark.parametrize("worker_fails", [False, True])
@pytest.mark.parametrize("read_first", [False, True])
@pytest.mark.parametrize("http_wrappers", [False, True])
def test_http_detach_keeps_receipt_until_execution_terminal(billing, worker_fails, read_first, http_wrappers):
    from flask import Flask, has_app_context

    from core.app.entities.task_entities import PingStreamResponse
    from core.app.task_pipeline.easy_ui_based_generate_task_pipeline import EasyUIBasedGenerateTaskPipeline

    app = entity(agent=True)
    billing.reserve.return_value.reservation_id = "remote-receipt"
    owner = begin_message_billing(app, MESSAGE)
    worker_terminal = Event()
    completed = Event()
    owner.reservation.release.side_effect = completed.set
    message = Message(message_tokens=2, answer_tokens=3)
    message.id = MESSAGE

    def execution():
        # Exceed the delivery buffer, including close-before-first-read, to
        # prove an abandoned HTTP generator cannot strand terminal processing.
        for _ in range(100):
            yield PingStreamResponse(task_id="fixture-task")
        assert worker_terminal.wait(2)
        assert has_app_context()  # Original HTTP context has already ended.
        if worker_fails:
            raise ValueError("worker-failed")
        message_event.handle(message, application_generate_entity=app)
        completed.set()
        yield PingStreamResponse(task_id="fixture-task")

    pipeline = object.__new__(EasyUIBasedGenerateTaskPipeline)
    pipeline._application_generate_entity = app
    pipeline.stream = True
    pipeline._message_cycle_manager = Mock()
    pipeline._conversation_id = "conversation-1"
    pipeline._message_id = MESSAGE
    pipeline._message_created_at = 0
    pipeline.queue_manager = Mock()
    pipeline._wrapper_process_stream_response = Mock(return_value=execution())
    flask_app = Flask("detached-message")
    if http_wrappers:
        from core.app.apps.base_app_generator import BaseAppGenerator
        from core.app.apps.chat.generate_response_converter import ChatAppGenerateResponseConverter
        from core.app.entities.app_invoke_entities import InvokeFrom
        from libs.helper import compact_generate_response

        @flask_app.get("/stream")
        def stream():
            frames = pipeline.process()
            converted = ChatAppGenerateResponseConverter.convert(frames, InvokeFrom.SERVICE_API)
            return compact_generate_response(BaseAppGenerator.convert_to_event_stream(converted))

        with flask_app.test_request_context("/stream"):
            response = flask_app.full_dispatch_request()
            if read_first:
                assert next(response.iter_encoded()) == b"event: ping\n\n"
            response.close()
    else:
        with flask_app.app_context():
            output = pipeline.process()
            if read_first:
                assert next(output) is not None
            output.close()
    assert not owner.settled
    assert not owner._heartbeat_stop.is_set()
    owner.reservation.release.assert_not_called()
    owner.reservation.commit.assert_not_called()
    pipeline.queue_manager.request_abort.assert_not_called()
    billing.state.update(phase="active", route_epoch=1)
    worker_terminal.set()
    assert completed.wait(2)
    if worker_fails:
        owner.reservation.release.assert_called_once()
        owner.reservation.commit.assert_not_called()
        pipeline.queue_manager.request_abort.assert_called_once()
    else:
        owner.reservation.commit.assert_called_once()
        owner.reservation.release.assert_not_called()
        pipeline.queue_manager.request_abort.assert_not_called()
