"""Facade dispatch and safe failure tests using deterministic handlers."""

from dataclasses import dataclass, field

import pytest

from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelFailureCategory,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelOperationResult,
    ChannelProvider,
    ChannelRef,
    ChannelScope,
    ChannelScopeKind,
    ChannelStatus,
    ChannelTestResult,
    ChannelView,
    GetChannelCommand,
    HumanInputChannelManagementContext,
    IMChannelSummary,
    IMChannelTestSummary,
    NewSecret,
    ResendChannelSummary,
    ResendChannelTestSummary,
    SaveEmailChannelCommand,
    SaveIMChannelCommand,
    SlackIMCandidate,
)
from core.human_input_v2.channel_management import TestEmailChannelCommand as EmailTestCommand
from core.human_input_v2.email_channel import NewAPIKey, ResendCandidate
from core.human_input_v2.shared import AccountId, IntegrationId, NormalizedEmail, TenantId
from libs.datetime_utils import naive_utc_now
from services.human_input_channel_management_service import HumanInputChannelManagementService

_CONTEXT = HumanInputChannelManagementContext(
    tenant_id=TenantId("workspace-1"),
    actor_account_id=AccountId("account-1"),
    actor_email=NormalizedEmail("operator@example.com"),
)


@dataclass
class FakeHandler:
    ref: ChannelRef
    calls: list[str]
    capabilities: frozenset[ChannelCapability] = frozenset(
        (ChannelCapability.CONFIGURE, ChannelCapability.TEST, ChannelCapability.DELETE)
    )
    configured: bool = False
    fail: bool = False
    contexts: list[HumanInputChannelManagementContext] = field(default_factory=list)

    def _result(self, context):
        if self.fail:
            raise RuntimeError("diagnostic with secret")
        summary = (
            ResendChannelSummary(
                NormalizedEmail("sender@example.com") if self.configured else None,
                "Sender" if self.configured else None,
                self.configured,
            )
            if self.ref.kind is ChannelKind.EMAIL
            else IMChannelSummary(
                "provider-tenant" if self.configured else None,
                IntegrationId("integration-1") if self.configured else None,
                1 if self.configured else None,
            )
        )
        return ChannelOperationResult.success(
            ChannelView(
                ref=self.ref,
                scope=ChannelScope(ChannelScopeKind.WORKSPACE, str(context.tenant_id)),
                configured=self.configured,
                status=ChannelStatus.CONFIGURED if self.configured else ChannelStatus.NOT_CONFIGURED,
                capabilities=self.capabilities,
                summary=summary,
            )
        )

    def get(self, context):
        self.calls.append("get")
        self.contexts.append(context)
        return self._result(context)

    def test(self, context, command):
        del command
        self.calls.append("test")
        self.contexts.append(context)
        summary = (
            ResendChannelTestSummary(
                recipient_email=context.actor_email,
                sender_email=NormalizedEmail("candidate@example.com"),
                sender_name="Candidate",
            )
            if self.ref.kind is ChannelKind.EMAIL
            else IMChannelTestSummary("candidate-provider-tenant")
        )
        return ChannelOperationResult.tested(
            ChannelTestResult(
                ref=self.ref,
                scope=ChannelScope(ChannelScopeKind.WORKSPACE, str(context.tenant_id)),
                status=ChannelStatus.CONNECTED,
                summary=summary,
                checked_at=naive_utc_now(),
            )
        )

    def save(self, context, command):
        del command
        self.calls.append("save")
        return self.get(context)

    def delete(self, context, command):
        del command
        self.calls.append("delete")
        return self.get(context)


def test_facade_lists_independent_handlers_and_contains_safe_failure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [], fail=True)
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack)))

    result = service.list_channels(_CONTEXT)

    assert [channel.ref for channel in result.channels] == [email.ref]
    assert result.failures[0][0] == slack.ref
    assert result.failures[0][1].category is ChannelFailureCategory.CHANNEL_FAILURE
    assert "diagnostic with secret" not in repr(result)
    assert "diagnostic with secret" not in caplog.text
    assert email.calls == ["get"]
    assert slack.calls == ["get"]
    assert email.contexts == [_CONTEXT]
    assert slack.contexts == [_CONTEXT]


def test_facade_lists_each_registered_channel_ref_independently() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [], configured=True)
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [], configured=True)
    feishu = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack, feishu)))

    result = service.list_channels(_CONTEXT)

    assert {view.ref for view in result.channels} == {email.ref, slack.ref, feishu.ref}
    assert {view.ref for view in result.channels if view.configured} == {email.ref, slack.ref}
    assert email.calls == ["get"]
    assert slack.calls == ["get"]
    assert feishu.calls == ["get"]


def test_facade_rejects_unsupported_channel_without_handler_work() -> None:
    service = HumanInputChannelManagementService(ChannelHandlerRegistry())

    result = service.get_channel(
        _CONTEXT,
        GetChannelCommand(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND)),
    )

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.UNSUPPORTED_CHANNEL


def test_facade_gets_supported_channel_through_matching_handler() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [], configured=True)
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack)))

    result = service.get_channel(_CONTEXT, GetChannelCommand(email.ref))

    assert result.view is not None
    assert result.view.ref == email.ref
    assert email.calls == ["get"]
    assert email.contexts == [_CONTEXT]
    assert slack.calls == []


def test_facade_dispatches_candidate_test_without_returning_a_persisted_view() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email,)))
    command = EmailTestCommand(
        email.ref,
        ResendCandidate(
            NormalizedEmail("candidate@example.com"),
            "Candidate",
            NewAPIKey("candidate-key"),
        ),
    )

    result = service.test_channel(_CONTEXT, command)

    assert result.view is None
    assert result.test_result is not None
    assert result.test_result.ref == email.ref
    assert result.test_result.summary == ResendChannelTestSummary(
        recipient_email=_CONTEXT.actor_email,
        sender_email=NormalizedEmail("candidate@example.com"),
        sender_name="Candidate",
    )
    assert email.calls == ["test"]
    assert email.contexts == [_CONTEXT]
    assert "candidate-key" not in repr(result)


def test_facade_rejects_wrong_success_variant_from_test_handler() -> None:
    class InvalidTestHandler(FakeHandler):
        def test(self, context, command):
            del command
            return self._result(context)

    email = InvalidTestHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email,)))
    command = EmailTestCommand(
        email.ref,
        ResendCandidate(
            NormalizedEmail("candidate@example.com"),
            "Candidate",
            NewAPIKey("candidate-key"),
        ),
    )

    result = service.test_channel(_CONTEXT, command)

    assert result.view is None
    assert result.test_result is None
    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.CHANNEL_FAILURE


def test_facade_contains_wrong_success_variant_from_get_handler() -> None:
    class InvalidGetHandler(FakeHandler):
        def get(self, context):
            return self.test(context, None)

    email = InvalidGetHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email,)))

    result = service.list_channels(_CONTEXT)

    assert result.channels == ()
    assert result.failures[0][0] == email.ref
    assert result.failures[0][1].category is ChannelFailureCategory.CHANNEL_FAILURE


def test_facade_rejects_unsupported_operation_before_handler_work() -> None:
    email = FakeHandler(
        ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND),
        [],
        capabilities=frozenset(),
    )
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email,)))
    command = SaveEmailChannelCommand(
        email.ref,
        ResendCandidate(
            NormalizedEmail("sender@example.com"),
            "Sender",
            NewAPIKey("secret"),
        ),
    )

    result = service.save_channel(_CONTEXT, command)

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.UNSUPPORTED_OPERATION
    assert email.calls == []
    assert email.contexts == []


def test_facade_rejects_candidate_discriminator_mismatch_before_handler_work() -> None:
    handler = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((handler,)))
    command = SaveEmailChannelCommand(
        ref=handler.ref,
        candidate=ResendCandidate(
            NormalizedEmail("sender@example.com"),
            "Sender",
            NewAPIKey("secret"),
        ),
    )
    object.__setattr__(command.candidate, "provider", "slack")

    result = service.save_channel(_CONTEXT, command)

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.VALIDATION_FAILURE
    assert handler.calls == []


def test_facade_rejects_im_candidate_type_provider_mismatch_before_handler_work() -> None:
    handler = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((handler,)))
    candidate = SlackIMCandidate(
        client_id="client",
        client_secret=NewSecret("client-secret"),
        signing_secret=NewSecret("signing-secret"),
        bot_token=NewSecret("bot-token"),
        app_token=NewSecret("app-token"),
    )
    object.__setattr__(candidate, "provider", ChannelProvider.FEISHU)
    command = SaveIMChannelCommand(handler.ref, candidate)

    result = service.save_channel(_CONTEXT, command)

    assert result.failure is not None
    assert result.failure.category is ChannelFailureCategory.VALIDATION_FAILURE
    assert handler.calls == []


def test_email_mutation_does_not_touch_registered_im_handler() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [])
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack)))
    command = SaveEmailChannelCommand(
        email.ref,
        ResendCandidate(
            NormalizedEmail("sender@example.com"),
            "Sender",
            NewAPIKey("secret"),
        ),
    )

    result = service.save_channel(_CONTEXT, command)

    assert result.view is not None
    assert email.calls == ["save", "get"]
    assert slack.calls == []


def test_im_mutation_does_not_touch_registered_email_handler() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [], configured=True)
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack)))
    command = SaveIMChannelCommand(
        slack.ref,
        SlackIMCandidate(
            client_id="client",
            client_secret=NewSecret("client-secret"),
            signing_secret=NewSecret("signing-secret"),
            bot_token=NewSecret("bot-token"),
            app_token=NewSecret("app-token"),
        ),
    )

    result = service.save_channel(_CONTEXT, command)

    assert result.view is not None
    assert email.calls == []
    assert slack.calls == ["save", "get"]


def test_email_and_one_active_im_channel_are_listed_as_configured() -> None:
    email = FakeHandler(ChannelRef(ChannelKind.EMAIL, ChannelProvider.RESEND), [], configured=True)
    slack = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.SLACK), [], configured=True)
    feishu = FakeHandler(ChannelRef(ChannelKind.IM, ChannelProvider.FEISHU), [])
    service = HumanInputChannelManagementService(ChannelHandlerRegistry((email, slack, feishu)))

    result = service.list_channels(_CONTEXT)

    assert {view.ref for view in result.channels if view.configured} == {email.ref, slack.ref}
    assert {view.ref for view in result.channels if not view.configured} == {feishu.ref}
