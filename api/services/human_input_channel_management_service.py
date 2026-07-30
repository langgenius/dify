"""Application facade for channel-neutral Human Input management."""

from __future__ import annotations

from collections.abc import Callable
from functools import partial

from core.human_input_v2.channel_management import (
    ChannelCapability,
    ChannelCollectionResult,
    ChannelFailureCategory,
    ChannelHandlerRegistry,
    ChannelKind,
    ChannelOperation,
    ChannelOperationResult,
    ChannelProvider,
    DeleteChannelCommand,
    DingTalkIMCandidate,
    FeishuIMCandidate,
    GetChannelCommand,
    HumanInputChannelManagementContext,
    SaveEmailChannelCommand,
    SaveIMChannelCommand,
    SlackIMCandidate,
    TestEmailChannelCommand,
    TestIMChannelCommand,
)
from core.human_input_v2.channel_management.commands import SaveChannelCommand, TestChannelCommand
from core.human_input_v2.email_channel import ResendCandidate

_OPERATION_CAPABILITY = {
    ChannelOperation.TEST: ChannelCapability.TEST,
    ChannelOperation.SAVE: ChannelCapability.CONFIGURE,
    ChannelOperation.DELETE: ChannelCapability.DELETE,
}


class HumanInputChannelManagementService:
    """Dispatch trusted commands without observing credentials or persistence."""

    def __init__(self, registry: ChannelHandlerRegistry) -> None:
        self._registry = registry

    def list_channels(self, context: HumanInputChannelManagementContext) -> ChannelCollectionResult:
        handlers = self._registry.handlers()
        if not handlers:
            return ChannelCollectionResult(())
        channels = []
        failures = []
        for handler in handlers:
            result = self._safe_view_call(partial(handler.get, context))
            if result.view is not None:
                channels.append(result.view)
            else:
                assert result.failure is not None
                failures.append((handler.ref, result.failure))
        return ChannelCollectionResult(tuple(channels), tuple(failures))

    def get_channel(
        self,
        context: HumanInputChannelManagementContext,
        command: GetChannelCommand,
    ) -> ChannelOperationResult:
        handler = self._registry.resolve(command.ref)
        if handler is None:
            return ChannelOperationResult.failed(ChannelFailureCategory.UNSUPPORTED_CHANNEL)
        return self._safe_view_call(lambda: handler.get(context))

    def test_channel(
        self,
        context: HumanInputChannelManagementContext,
        command: TestChannelCommand,
    ) -> ChannelOperationResult:
        validation_failure = self._validate_discriminator(command)
        if validation_failure is not None:
            return validation_failure
        return self._dispatch(context, ChannelOperation.TEST, command)

    def save_channel(
        self,
        context: HumanInputChannelManagementContext,
        command: SaveChannelCommand,
    ) -> ChannelOperationResult:
        validation_failure = self._validate_discriminator(command)
        if validation_failure is not None:
            return validation_failure
        return self._dispatch(context, ChannelOperation.SAVE, command)

    def delete_channel(
        self,
        context: HumanInputChannelManagementContext,
        command: DeleteChannelCommand,
    ) -> ChannelOperationResult:
        handler = self._registry.resolve(command.ref)
        if handler is None:
            return ChannelOperationResult.failed(ChannelFailureCategory.UNSUPPORTED_CHANNEL)
        if ChannelCapability.DELETE not in handler.capabilities:
            return ChannelOperationResult.failed(ChannelFailureCategory.UNSUPPORTED_OPERATION)
        return self._safe_view_call(lambda: handler.delete(context, command))

    def _dispatch(
        self,
        context: HumanInputChannelManagementContext,
        operation: ChannelOperation,
        command: SaveChannelCommand | TestChannelCommand,
    ) -> ChannelOperationResult:
        handler = self._registry.resolve(command.ref)
        if handler is None:
            return ChannelOperationResult.failed(ChannelFailureCategory.UNSUPPORTED_CHANNEL)
        if _OPERATION_CAPABILITY[operation] not in handler.capabilities:
            return ChannelOperationResult.failed(ChannelFailureCategory.UNSUPPORTED_OPERATION)
        if isinstance(command, (SaveEmailChannelCommand, SaveIMChannelCommand)):
            return self._safe_view_call(lambda: handler.save(context, command))
        if isinstance(command, (TestEmailChannelCommand, TestIMChannelCommand)):
            return self._safe_test_call(lambda: handler.test(context, command))
        return ChannelOperationResult.failed(ChannelFailureCategory.VALIDATION_FAILURE, "invalid_command")

    @staticmethod
    def _validate_discriminator(
        command: SaveChannelCommand | TestChannelCommand,
    ) -> ChannelOperationResult | None:
        if isinstance(command, (SaveEmailChannelCommand, TestEmailChannelCommand)):
            if command.ref.kind is not ChannelKind.EMAIL or not isinstance(command.candidate, ResendCandidate):
                return ChannelOperationResult.failed(
                    ChannelFailureCategory.VALIDATION_FAILURE,
                    "channel_candidate_mismatch",
                )
            expected_provider = ChannelProvider.RESEND
            candidate_provider_value = str(command.candidate.provider)
        elif isinstance(command, (SaveIMChannelCommand, TestIMChannelCommand)):
            if command.ref.kind is not ChannelKind.IM:
                return ChannelOperationResult.failed(
                    ChannelFailureCategory.VALIDATION_FAILURE,
                    "channel_candidate_mismatch",
                )
            if isinstance(command.candidate, FeishuIMCandidate):
                expected_provider = ChannelProvider.FEISHU
            elif isinstance(command.candidate, SlackIMCandidate):
                expected_provider = ChannelProvider.SLACK
            elif isinstance(command.candidate, DingTalkIMCandidate):
                expected_provider = ChannelProvider.DING_TALK
            else:
                return ChannelOperationResult.failed(
                    ChannelFailureCategory.VALIDATION_FAILURE,
                    "channel_candidate_mismatch",
                )
            candidate_provider_value = str(command.candidate.provider)
        else:
            return ChannelOperationResult.failed(ChannelFailureCategory.VALIDATION_FAILURE, "invalid_command")
        try:
            provider = ChannelProvider(candidate_provider_value)
        except (TypeError, ValueError):
            return ChannelOperationResult.failed(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        if provider is not expected_provider or command.ref.provider is not expected_provider:
            return ChannelOperationResult.failed(
                ChannelFailureCategory.VALIDATION_FAILURE,
                "channel_candidate_mismatch",
            )
        return None

    @staticmethod
    def _safe_call(operation: Callable[[], ChannelOperationResult]) -> ChannelOperationResult:
        try:
            result = operation()
        except Exception:
            return ChannelOperationResult.failed(ChannelFailureCategory.CHANNEL_FAILURE)
        if not isinstance(result, ChannelOperationResult):
            return ChannelOperationResult.failed(ChannelFailureCategory.CHANNEL_FAILURE)
        return result

    @classmethod
    def _safe_view_call(cls, operation: Callable[[], ChannelOperationResult]) -> ChannelOperationResult:
        result = cls._safe_call(operation)
        if result.view is not None or result.failure is not None:
            return result
        return ChannelOperationResult.failed(ChannelFailureCategory.CHANNEL_FAILURE)

    @classmethod
    def _safe_test_call(cls, operation: Callable[[], ChannelOperationResult]) -> ChannelOperationResult:
        result = cls._safe_call(operation)
        if result.test_result is not None or result.failure is not None:
            return result
        return ChannelOperationResult.failed(ChannelFailureCategory.CHANNEL_FAILURE)
