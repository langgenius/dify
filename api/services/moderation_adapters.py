"""Adapters between legacy moderation capabilities, app replacement rules, and model invocation."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Iterable, Mapping, Sequence
from typing import TYPE_CHECKING

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint, APIBasedExtensionRequestor
from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult
from core.moderation.base import ModerationAction as LegacyModerationAction
from core.moderation.factory import ModerationFactory
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMStructuredOutput
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from machinery.context import AppRequestContext
from services.api_based_extension_application_service import APIBasedExtensionSecretCipher, APIBasedExtensionStore
from services.hosted_moderation_service import HostedModerationUnavailableError
from services.moderation_invocation_errors import (
    ModerationRejectedInvocationError,
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import (
    ModerationPhase,
    ModerationRejectedError,
    ModerationReplacement,
    ModerationRequest,
    ModerationRule,
    ModerationVerdict,
)

if TYPE_CHECKING:
    from core.model_manager import LLMModerationPolicy

logger = logging.getLogger(__name__)


class ChainedLLMModerationPolicy:
    """Apply enabled platform moderation together with an explicitly configured tenant policy."""

    def __init__(self, policies: tuple[LLMModerationPolicy, ...]) -> None:
        """Bind a nonempty set of policies with the same tenant; reject scope mismatches before I/O."""
        if not policies or any(policy.tenant_id != policies[0].tenant_id for policy in policies):
            raise ValueError("Moderation policies must share one tenant scope.")
        self._policies = policies

    @property
    def tenant_id(self) -> str:
        """Return the common immutable tenant scope."""
        return self._policies[0].tenant_id

    def check_inputs(self, prompt_messages: Sequence[PromptMessage]) -> None:
        """Enforce every bound input policy before model or quota effects."""
        for policy in self._policies:
            policy.check_inputs(prompt_messages)

    def check_result(self, result: LLMResult) -> None:
        """Enforce every bound output policy without modifying the completed result."""
        for policy in self._policies:
            policy.check_result(result)

    def check_output(self, response: LLMResult | Generator) -> LLMResult | Generator:
        """Apply every output guard before caller delivery, propagating rejection and backend errors."""
        for policy in self._policies:
            response = policy.check_output(response)
        return response


class ExtensionModerationGateway:
    def __init__(self, *, extensions: APIBasedExtensionStore, cipher: APIBasedExtensionSecretCipher) -> None:
        """Receive scoped extension lookup and decryption ports; construction performs no I/O."""
        self._extensions = extensions
        self._cipher = cipher

    def check(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        """Validate an existing backend and map its verdict without swallowing failures.

        Credentials are resolved by the legacy adapter within the explicit tenant
        scope. API override verdicts remain flagged rather than rewriting content.
        """
        if rule.type == "api":
            return self._check_api(context, rule=rule, request=request, phase=phase)
        ModerationFactory.validate_config(rule.type, context.tenant_id, rule.config)
        backend = ModerationFactory(rule.type, context.app_id, context.tenant_id, rule.config)
        input_query = request.query if request.inputs is not None else request.text
        result = (
            backend.moderation_for_inputs(dict(request.inputs) if request.inputs is not None else {}, input_query)
            if phase == "input"
            else backend.moderation_for_outputs(request.text)
        )
        return _verdict_from_legacy_result(result)

    def _check_api(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        request: ModerationRequest,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        """Load workspace-scoped extension data before outbound I/O and validate its verdict.

        Missing extensions, decryption failures, HTTP errors, and malformed
        responses fail closed. The query port closes its session before returning.
        """
        Moderation._validate_inputs_and_outputs_config(rule.config, False)
        extension_id = rule.config.get("api_based_extension_id")
        if not isinstance(extension_id, str) or not extension_id:
            raise ValueError("api_based_extension_id is required")
        extension = self._extensions.find_extension(context.tenant_id, extension_id)
        if extension is None:
            raise ValueError("API-based Extension not found. Please check it again.")
        requestor = APIBasedExtensionRequestor(
            extension.api_endpoint, self._cipher.decrypt(context.tenant_id, extension.api_key)
        )
        app_inputs = request.inputs if request.inputs is not None else {}
        input_query = request.query if request.inputs is not None else request.text
        if phase == "input":
            payload = requestor.request(
                APIBasedExtensionPoint.APP_MODERATION_INPUT,
                {"app_id": context.app_id, "inputs": dict(app_inputs), "query": input_query},
            )
            result = ModerationInputsResult.model_validate(payload)
        else:
            payload = requestor.request(
                APIBasedExtensionPoint.APP_MODERATION_OUTPUT, {"app_id": context.app_id, "text": request.text}
            )
            result = ModerationOutputsResult.model_validate(payload)
        if not isinstance(payload.get("flagged"), bool):
            raise ValueError("Moderation API response must include a boolean flagged verdict.")
        return _verdict_from_legacy_result(result)


def _verdict_from_legacy_result(
    result: ModerationInputsResult | ModerationOutputsResult,
) -> ModerationVerdict:
    """Preserve app replacement data while adapting a legacy backend verdict to the use case."""
    action = "overridden" if result.action == LegacyModerationAction.OVERRIDDEN else "direct_output"
    inputs = result.inputs if isinstance(result, ModerationInputsResult) else {}
    query = result.query if isinstance(result, ModerationInputsResult) else ""
    text = result.text if isinstance(result, ModerationOutputsResult) else ""
    replacement = ModerationReplacement(
        action=action,
        preset_response=result.preset_response,
        inputs=inputs,
        query=query,
        text=text,
    )
    return ModerationVerdict(flagged=result.flagged, message=result.preset_response, replacement=replacement)


def _message_text(message: PromptMessage | Mapping[str, object]) -> str:
    """Extract textual content and tool arguments without changing opaque transport payloads.

    Agent gateway dictionaries are validated into a role-specific inspection
    copy; the original payload, including provider extensions, remains untouched.
    Invalid inspection inputs fail closed, and binary attachments are not serialized.
    """
    if isinstance(message, Mapping):
        message_types: dict[str, type[PromptMessage]] = {
            "user": UserPromptMessage,
            "assistant": AssistantPromptMessage,
            "system": SystemPromptMessage,
            "tool": ToolPromptMessage,
        }
        role = message.get("role")
        if not isinstance(role, str) or role not in message_types:
            raise ValueError("Moderation requires a valid prompt message role.")
        message = message_types[role].model_validate(message)
    if isinstance(message.content, str):
        parts = [message.content]
    else:
        parts = ["".join(part.data for part in message.content or () if isinstance(part, TextPromptMessageContent))]
    if isinstance(message, AssistantPromptMessage):
        parts.extend(value for tool in message.tool_calls for value in (tool.function.name, tool.function.arguments))
    return "\n".join(parts)


def _structured_text(result: LLMStructuredOutput) -> str:
    """Serialize a validated structured payload without adding result-envelope keys to moderated content."""
    payload = result.model_dump(mode="json", include={"structured_output"})["structured_output"]
    return json.dumps(payload, ensure_ascii=False)


def prompt_text(prompt_messages: Sequence[PromptMessage]) -> str:
    """Extract all textual model input content without mutating transport payloads."""
    return "\n".join(_message_text(message) for message in prompt_messages)


def result_text(result: LLMResult) -> str:
    """Extract output message, tool arguments, and any native structured payload."""
    parts = [_message_text(result.message)]
    if isinstance(result, LLMStructuredOutput) and result.structured_output is not None:
        parts.append(_structured_text(result))
    return "\n".join(parts)


type ModerationCheck = Callable[[Iterable[str], ModerationPhase], None]


class LLMModerationGuard:
    """Enforce model moderation without changing the request or response text.

    Only recognized platform backend failures allow unchecked segments through.
    After an outage, the rest of the current stream uses cached verdicts only.
    A rejected segment is never delivered. The guard closes the provider stream
    and never retries model generation or refunds completed usage.
    """

    def __init__(
        self,
        *,
        tenant_id: str,
        check: ModerationCheck,
        check_input: bool,
        check_output: bool,
        non_stream_segment_size: int,
        stream_segment_size: int,
        platform: bool = False,
        check_cached: ModerationCheck | None = None,
    ) -> None:
        """Bind a tenant, phase enablement, and positive segment limits without I/O.

        Disabled phases do no work. On a platform backend outage, streaming
        switches to the cache-only checker if supplied; otherwise it has no
        further verdicts to enforce. Explicit policies always propagate failures.
        """
        if not tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        for segment_size in (non_stream_segment_size, stream_segment_size):
            if segment_size <= 0:
                raise ValueError("Moderation segment sizes must be positive.")
        self._tenant_id = tenant_id
        self._check = check
        self._check_cached = check_cached
        self._check_input = check_input
        self._check_output = check_output
        self._non_stream_segment_size = non_stream_segment_size
        self._stream_segment_size = stream_segment_size
        self._platform = platform

    @property
    def tenant_id(self) -> str:
        """Return the immutable tenant scope used to validate model assembly."""
        return self._tenant_id

    def check_inputs(self, prompt_messages: Sequence[PromptMessage]) -> None:
        """Enforce input verdicts before model/quota effects, unless the platform backend is unavailable.

        Platform policies preserve independent message boundaries;
        explicitly supplied policies retain the joined prompt representation.
        """
        if self._check_input:
            texts = (
                [_message_text(message) for message in prompt_messages] or [""]
                if self._platform
                else [prompt_text(prompt_messages)]
            )
            segments = (segment for text in texts for segment in self._segments(text, self._non_stream_segment_size))
            self._check_segments(self._check, segments, "input")

    def check_result(self, result: LLMResult) -> None:
        """Check non-streaming output, including structure, without changing the result."""
        if self._check_output:
            segments = self._segments(result_text(result), self._non_stream_segment_size)
            self._check_segments(self._check, segments, "output")

    def _check_segments(self, check: ModerationCheck, segments: Iterable[str], phase: ModerationPhase) -> bool:
        """Return False only for a recognized platform outage that allows the invocation to proceed.

        A rejection always raises. Strict-policy and unexpected failures become
        a safe unavailable error with the original cause retained.
        """
        try:
            check(segments, phase)
        except ModerationRejectedError as error:
            rejection = (
                PlatformModerationRejectedInvocationError(error.phase, str(error))
                if self._platform
                else ModerationRejectedInvocationError(error.phase, str(error))
            )
            raise rejection from error
        except Exception as error:
            if self._platform and isinstance(error, HostedModerationUnavailableError):
                logger.warning(
                    "Platform moderation unavailable; skipping unchecked segments. tenant_id=%s phase=%s reason=%s",
                    self._tenant_id,
                    phase,
                    error,
                )
                return False
            logger.exception("Moderation %s check failed", phase)
            unavailable = ModerationUnavailableInvocationError()
            raise unavailable from error
        return True

    def check_output(self, response: LLMResult | Generator) -> LLMResult | Generator:
        """Return the original result or a guarded stream; only platform unavailability is recoverable.

        Model invocation and accounting must already be complete or owned by the
        supplied stream. No model retry or accounting refund occurs on rejection.
        """
        if not self._check_output:
            return response
        if isinstance(response, Generator):
            return self._check_stream_segments(response)
        self.check_result(response)
        return response

    def _segments(self, text: str, segment_size: int) -> Generator[str]:
        """Yield independent segments within the configured positive size, including an empty input."""
        if len(text) <= segment_size:
            yield text
            return
        start = 0
        while start < len(text):
            end = min(start + segment_size, len(text))
            yield text[start:end]
            start = end

    @staticmethod
    def _stream_fragment(chunk: LLMResultChunk) -> str:
        """Extract textual deltas while concatenating argument fragments across the stream."""
        message = chunk.delta.message
        parts = [_message_text(AssistantPromptMessage(content=message.content))]
        parts.extend(tool.function.arguments for tool in message.tool_calls)
        if isinstance(chunk, LLMStructuredOutput) and chunk.structured_output is not None:
            parts.append(_structured_text(chunk))
        return "".join(parts)

    def _check_stream_segments(self, response: Generator[LLMResultChunk]) -> Generator[LLMResultChunk]:
        """Check each buffer before release and close the stream on every exit.

        After a platform outage, keep enforcing cached flags but make no more
        upstream checks in this stream. Tool names are collected separately so
        repeated names do not interrupt argument fragments within a buffer.
        """
        check: ModerationCheck | None = self._check
        segment_size = self._stream_segment_size
        chunks: list[LLMResultChunk] = []
        fragment_parts: list[str] = []
        tool_names: list[str] = []
        fragment_length = 0
        try:
            for chunk in response:
                chunks.append(chunk)
                fragment = self._stream_fragment(chunk)
                fragment_parts.append(fragment)
                fragment_length += len(fragment)
                for tool in chunk.delta.message.tool_calls:
                    if tool.function.name:
                        tool_names.append(tool.function.name)
                        fragment_length += len(tool.function.name)
                if fragment_length >= segment_size:
                    text = "\n".join(["".join(fragment_parts), *tool_names])
                    if check is not None and not self._check_segments(check, (text,), "output"):
                        check = self._check_cached
                    yield from chunks
                    chunks = []
                    fragment_parts = []
                    tool_names = []
                    fragment_length = 0

            if chunks:
                text = "\n".join(["".join(fragment_parts), *tool_names])
                if text and check is not None:
                    self._check_segments(check, (text,), "output")
                yield from chunks
        finally:
            response.close()
