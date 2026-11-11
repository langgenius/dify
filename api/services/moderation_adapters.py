"""Adapters between legacy moderation capabilities, app replacement rules, and model invocation."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Protocol

from core.extension.api_based_extension_requestor import APIBasedExtensionPoint, APIBasedExtensionRequestor
from core.moderation.base import Moderation, ModerationInputsResult, ModerationOutputsResult
from core.moderation.base import ModerationAction as LegacyModerationAction
from core.moderation.factory import ModerationFactory
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderDeclaration
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMStructuredOutput
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from machinery.context import AppRequestContext
from services.api_based_extension_application_service import APIBasedExtensionSecretCipher, APIBasedExtensionStore
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


class HostedModerationPluginClient(Protocol):
    """Keep installed-tenant dispatch distinct from server-selected direct fallback."""

    def invoke_moderation(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str | None = None,
    ) -> bool: ...

    def invoke_moderation_direct(
        self,
        tenant_id: str,
        user_id: str | None,
        plugin_id: str,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        *,
        plugin_unique_identifier: str,
    ) -> bool: ...


class TenantModerationPluginResolver(Protocol):
    """Resolve an installed official, verified OpenAI plugin in the supplied tenant."""

    def resolve(self, tenant_id: str) -> str | None: ...


class TenantModerationPluginCatalogue(Protocol):
    """Tenant-scoped provider declarations and signed-manifest verification supplied by infrastructure."""

    def fetch_plugin_model_providers(self, *, tenant_id: str) -> Sequence[PluginModelProviderDeclaration]: ...

    def is_plugin_verified(self, tenant_id: str, plugin_unique_identifier: str) -> bool: ...


class VerifiedTenantModerationPluginResolver:
    """Admit only Marketplace OpenAI installations whose manifest is verified."""

    def __init__(self, catalogue: TenantModerationPluginCatalogue) -> None:
        """Bind catalogue access without discovery or manifest I/O."""
        self._catalogue = catalogue

    def resolve(self, tenant_id: str) -> str | None:
        """Return a trusted tenant identifier or None; discovery failures propagate to the fallback owner."""
        providers = self._catalogue.fetch_plugin_model_providers(tenant_id=tenant_id)
        return next(
            (
                provider.plugin_unique_identifier
                for provider in providers
                if provider.provider == "langgenius/openai/openai"
                and ModelType.MODERATION in provider.supported_model_types
                and provider.plugin_unique_identifier.startswith("langgenius/openai:")
                and provider.installation_source == PluginInstallationSource.Marketplace
                and self._catalogue.is_plugin_verified(tenant_id, provider.plugin_unique_identifier)
            ),
            None,
        )


class HostedOpenAIModerationGateway:
    """Use a verified tenant plugin before the configured fallback, without credit accounting."""

    def __init__(
        self,
        *,
        client: HostedModerationPluginClient,
        credentials: Mapping[str, object] | None,
        plugin_unique_identifier: str,
        tenant_plugins: TenantModerationPluginResolver | None = None,
    ) -> None:
        """Bind platform credentials and lazy plugin selection without external I/O.

        None credentials represent unavailable platform configuration, not user
        credential fallback. A None resolver selects only the configured plugin.
        Fallback identifier validation is deferred until needed so a valid tenant
        plugin does not depend on SRE supplying a fallback package.
        """
        self._client = client
        self._credentials = dict(credentials) if credentials is not None else None
        self._tenant_plugins = tenant_plugins
        self._tenant_identifiers: dict[str, str | None] = {}
        self._plugin_unique_identifier = plugin_unique_identifier.strip()

    @staticmethod
    def _validate_identifier(plugin_unique_identifier: str) -> None:
        """Require a pinned official OpenAI identifier before any direct daemon dispatch."""
        plugin_id, separator, package_identity = plugin_unique_identifier.partition(":")
        version, checksum_separator, checksum = package_identity.partition("@")
        valid_package = separator and version and checksum_separator and checksum
        if not valid_package or plugin_id != "langgenius/openai":
            raise ValueError("Hosted moderation requires a pinned langgenius/openai plugin identifier.")

    def _invoke(self, context: AppRequestContext, text: str, identifier: str, *, direct: bool) -> bool:
        """Invoke an admitted package; direct fallback never resolves a tenant installation.

        The caller selects direct dispatch only for the SRE-pinned fallback.
        Both routes retain platform credentials, tenant context, and strict verdict validation.
        """
        self._validate_identifier(identifier)
        if self._credentials is None:
            raise InvokeAuthorizationError("Hosted moderation credentials are not configured.")
        if not text:
            return False
        invoke = self._client.invoke_moderation_direct if direct else self._client.invoke_moderation
        flagged = invoke(
            tenant_id=context.tenant_id,
            user_id=None,
            plugin_id="langgenius/openai",
            provider="openai",
            model="omni-moderation-latest",
            credentials=self._credentials,
            text=text,
            plugin_unique_identifier=identifier,
        )
        if not isinstance(flagged, bool):
            raise ValueError("Hosted moderation returned an invalid verdict.")
        return flagged

    def _evaluate(self, context: AppRequestContext, text: str) -> tuple[bool, str]:
        """Try the trusted tenant package first; fallback only on absence or failure, never rejection."""
        if self._tenant_plugins is not None:
            try:
                if context.tenant_id not in self._tenant_identifiers:
                    self._tenant_identifiers[context.tenant_id] = self._tenant_plugins.resolve(context.tenant_id)
                identifier = self._tenant_identifiers[context.tenant_id]
                if identifier is not None:
                    return self._invoke(context, text, identifier, direct=False), "tenant"
            except Exception as error:
                self._tenant_identifiers[context.tenant_id] = None
                logger.warning(
                    "Tenant moderation plugin failed; trying configured fallback. tenant_id=%s app_id=%s error_type=%s",
                    context.tenant_id,
                    context.app_id,
                    type(error).__name__,
                )
        if not self._plugin_unique_identifier:
            raise InvokeAuthorizationError(
                "No trusted tenant OpenAI plugin or configured moderation fallback is available."
            )
        return self._invoke(context, text, self._plugin_unique_identifier, direct=True), "configured"

    def check(
        self, context: AppRequestContext, *, rule: ModerationRule, request: ModerationRequest, phase: ModerationPhase
    ) -> ModerationVerdict:
        """Return a verdict through the tenant-first platform-funded route and log rejections.

        No ModelManager, ModelInstance, tenant API key, or credit reservation is
        used. Missing credentials or failure of both plugin routes propagates.
        Logs identify the scope and phase but never include moderated text.
        """
        if rule.type != "openai_moderation":
            raise ValueError("Hosted moderation requires the OpenAI moderation rule.")
        if self._credentials is None:
            raise InvokeAuthorizationError("Hosted moderation credentials are not configured.")
        flagged, source = self._evaluate(context, request.text)
        if flagged:
            logger.warning(
                "Platform moderation rejected content. tenant_id=%s app_id=%s phase=%s plugin_source=%s",
                context.tenant_id,
                context.app_id,
                phase,
                source,
            )
        return ModerationVerdict(flagged=flagged, message=rule.config[f"{phase}s_config"].get("preset_response", ""))


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
        """Require every bound policy to approve inputs before model or quota effects."""
        for policy in self._policies:
            policy.check_inputs(prompt_messages)

    def check_result(self, result: LLMResult) -> None:
        """Require every policy to approve a completed result without modifying it."""
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


class LLMModerationGuard:
    """Check model inputs and segmented outputs before exposing them to the caller.

    Non-streaming output checks all text segments before returning the original
    result. Streaming output checks each independent threshold-sized segment
    before yielding its chunks. Segments never reuse previously checked text. The
    guard owns and closes the provider stream. Model quota accounting completes
    before output checks; rejection never refunds completed model usage.
    """

    def __init__(
        self,
        *,
        tenant_id: str,
        check: Callable[[str, ModerationPhase], None],
        check_input: bool,
        check_output: bool,
        non_stream_segment_size: int | None = None,
        stream_segment_size: int | None = None,
        platform: bool = False,
        output_observer: Callable[[object, str], None] | None = None,
    ) -> None:
        """Bind a nonempty tenant, phase enablement, and positive segment limits.

        None disables segmentation for that mode and preserves a single full-text
        check. Disabled phases perform no inspection or I/O.
        """
        if not tenant_id:
            raise ValueError("Moderation requires a tenant scope.")
        for segment_size in (non_stream_segment_size, stream_segment_size):
            if segment_size is not None and segment_size <= 0:
                raise ValueError("Moderation segment sizes must be positive.")
        self._tenant_id = tenant_id
        self._check = check
        self._check_input = check_input
        self._check_output = check_output
        self._non_stream_segment_size = non_stream_segment_size
        self._stream_segment_size = stream_segment_size
        self._platform = platform
        self._output_observer = output_observer

    @property
    def tenant_id(self) -> str:
        """Return the immutable tenant scope used to validate model assembly."""
        return self._tenant_id

    def check_inputs(self, prompt_messages: Sequence[PromptMessage]) -> None:
        """Approve every input segment before model/quota effects.

        Platform policies preserve message boundaries for exact app sharing;
        explicitly supplied policies retain the joined prompt representation.
        """
        if self._check_input:
            texts = (
                [_message_text(message) for message in prompt_messages] or [""]
                if self._platform
                else [prompt_text(prompt_messages)]
            )
            for text in texts:
                for segment in self._segments(text, self._non_stream_segment_size):
                    self._check_segment(segment, "input")

    def check_result(self, result: LLMResult) -> None:
        """Approve every non-streaming output segment, including structured content, without mutation."""
        if self._check_output:
            for segment in self._segments(result_text(result), self._non_stream_segment_size):
                self._check_segment(segment, "output")
            if self._output_observer is not None:
                self._output_observer(object(), _message_text(AssistantPromptMessage(content=result.message.content)))

    def _check_segment(self, text: str, phase: ModerationPhase) -> None:
        """Approve one segment or raise a typed app error without exposing backend failure details.

        The bound checker owns the verdict. Rejections retain their phase and
        configured message; other checker failures are logged and chained to a
        safe unavailable error. Neither failure permits delivery or model retry.
        """
        try:
            self._check(text, phase)
        except ModerationRejectedError as error:
            if self._platform:
                raise PlatformModerationRejectedInvocationError(error.phase, str(error)) from error
            raise ModerationRejectedInvocationError(error.phase, str(error)) from error
        except Exception as error:
            logger.exception("Moderation %s check failed", phase)
            raise ModerationUnavailableInvocationError() from error

    def check_output(self, response: LLMResult | Generator) -> LLMResult | Generator:
        """Return the original approved result or a guarded stream, propagating all failures.

        Model invocation and accounting must already be complete or owned by the
        supplied stream. No model retry or accounting refund occurs on rejection.
        """
        if not self._check_output:
            return response
        if isinstance(response, Generator):
            if self._stream_segment_size is not None:
                return self._check_stream_segments(response)
            return self._check_stream(response)
        self.check_result(response)
        return response

    def _segments(self, text: str, segment_size: int | None) -> Generator[str]:
        """Yield independent text segments within a positive size, or all text when size is None."""
        if segment_size is None or len(text) <= segment_size:
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
        """Check each independent segment before releasing its chunks; close the stream even on failure."""
        segment_size = self._stream_segment_size
        if segment_size is None:
            raise ValueError("Streaming moderation requires a segment size.")
        chunks: list[LLMResultChunk] = []
        fragment_parts: list[str] = []
        fragment_length = 0
        stream_identity = object()
        try:
            for chunk in response:
                chunks.append(chunk)
                fragment = self._stream_fragment(chunk)
                fragment_parts.append(fragment)
                fragment_length += len(fragment)
                if fragment_length >= segment_size:
                    text = "".join(fragment_parts)
                    self._check_segment(text, "output")
                    self._record_stream_output(stream_identity, chunks)
                    yield from chunks
                    chunks = []
                    fragment_parts = []
                    fragment_length = 0

            if chunks:
                text = "".join(fragment_parts)
                if text:
                    self._check_segment(text, "output")
                self._record_stream_output(stream_identity, chunks)
                yield from chunks
        finally:
            response.close()

    def _record_stream_output(self, identity: object, chunks: Sequence[LLMResultChunk]) -> None:
        """Notify the invocation-local observer only after a segment passed, before exposing any of its chunks."""
        if self._output_observer is not None:
            self._output_observer(
                identity,
                "".join(_message_text(AssistantPromptMessage(content=chunk.delta.message.content)) for chunk in chunks),
            )

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
            self._check_segment(text, "output")
            self._record_stream_output(object(), chunks)
            yield from chunks
        finally:
            response.close()
