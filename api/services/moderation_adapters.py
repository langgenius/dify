"""Adapters between legacy moderation capabilities, model invocation, and strict checks."""

import json
from collections.abc import Callable, Generator, Mapping, Sequence

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint, APIBasedExtensionRequestor
from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult
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
from services.moderation_service import ModerationPhase, ModerationRule, ModerationVerdict


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
        text: str,
        phase: ModerationPhase,
    ) -> ModerationVerdict:
        """Validate an existing backend and map its verdict without swallowing failures.

        Credentials are resolved by the legacy adapter within the explicit tenant
        scope. API override verdicts remain flagged rather than rewriting content.
        """
        if rule.type == "api":
            return self._check_api(context, rule=rule, text=text, phase=phase)
        ModerationFactory.validate_config(rule.type, context.tenant_id, rule.config)
        backend = ModerationFactory(rule.type, context.app_id, context.tenant_id, rule.config)
        result = backend.moderation_for_inputs({}, text) if phase == "input" else backend.moderation_for_outputs(text)
        return ModerationVerdict(flagged=result.flagged, message=result.preset_response)

    def _check_api(
        self, context: AppRequestContext, *, rule: ModerationRule, text: str, phase: ModerationPhase
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
        if phase == "input":
            payload = requestor.request(
                APIBasedExtensionPoint.APP_MODERATION_INPUT,
                {"app_id": context.app_id, "inputs": {}, "query": text},
            )
            result = ModerationInputsResult.model_validate(payload)
        else:
            payload = requestor.request(
                APIBasedExtensionPoint.APP_MODERATION_OUTPUT, {"app_id": context.app_id, "text": text}
            )
            result = ModerationOutputsResult.model_validate(payload)
        if not isinstance(payload.get("flagged"), bool):
            raise ValueError("Moderation API response must include a boolean flagged verdict.")
        return ModerationVerdict(flagged=result.flagged, message=result.preset_response)


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


class LLMModerationGuard:
    """Check complete model inputs and outputs before exposing a result to the caller.

    Streams are buffered in full so split keywords and cross-chunk violations
    cannot leak unchecked prefixes. The guard owns and closes the provider stream.
    Model invocation, including quota accounting, completes before output checks.
    """

    def __init__(
        self, *, tenant_id: str, check: Callable[[str, ModerationPhase], None], check_input: bool, check_output: bool
    ) -> None:
        """Bind a nonempty tenant and phase enablement; disabled phases perform no inspection or I/O."""
        if not tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        self._tenant_id = tenant_id
        self._check = check
        self._check_input = check_input
        self._check_output = check_output

    @property
    def tenant_id(self) -> str:
        """Return the immutable tenant scope used to validate model assembly."""
        return self._tenant_id

    def check_inputs(self, prompt_messages: Sequence[PromptMessage]) -> None:
        """Approve complete prompt text and tool arguments or raise before model and quota effects."""
        if self._check_input:
            self._check("\n".join(_message_text(message) for message in prompt_messages), "input")

    def check_result(self, result: LLMResult) -> None:
        """Approve completion and native structured payloads without mutation; disabled checks perform no I/O."""
        if self._check_output:
            parts = [_message_text(result.message)]
            if isinstance(result, LLMStructuredOutput) and result.structured_output is not None:
                parts.append(_structured_text(result))
            self._check("\n".join(parts), "output")

    def check_output(self, response: LLMResult | Generator) -> LLMResult | Generator:
        """Return the original approved result or a guarded stream, propagating all failures.

        Model invocation and accounting must already be complete or owned by the
        supplied stream. No model retry or accounting refund occurs on rejection.
        """
        if not self._check_output:
            return response
        if isinstance(response, Generator):
            return self._check_stream(response)
        self.check_result(response)
        return response

    def _check_stream(self, response: Generator[LLMResultChunk]) -> Generator[LLMResultChunk]:
        """Consume and close a stream, then yield its original chunks only after full approval."""
        chunks: list[LLMResultChunk] = []
        text_parts: list[str] = []
        tool_parts: dict[str, list[str]] = {}
        tool_ids: dict[int, str] = {}
        tool_names: dict[str, list[str]] = {}
        structured_parts: list[str] = []
        try:
            for chunk in response:
                chunks.append(chunk)
                if isinstance(chunk, LLMStructuredOutput) and chunk.structured_output is not None:
                    structured_parts.append(_structured_text(chunk))
                message = chunk.delta.message
                text_parts.append(_message_text(AssistantPromptMessage(content=message.content)))
                for position, tool in enumerate(message.tool_calls):
                    tool_id = tool.id or tool_ids.get(position, str(position))
                    tool_ids[position] = tool_id
                    tool_parts.setdefault(tool_id, []).append(tool.function.arguments)
                    tool_names.setdefault(tool_id, []).append(tool.function.name)
            text = "\n".join(
                [
                    "".join(text_parts),
                    *("".join(parts) for parts in tool_names.values()),
                    *("".join(parts) for parts in tool_parts.values()),
                    *structured_parts,
                ]
            )
            self._check(text, "output")
            yield from chunks
        finally:
            response.close()
