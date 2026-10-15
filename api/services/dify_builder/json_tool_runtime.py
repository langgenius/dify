"""Request-bound native JSON Parse Tool adapter.

Only trusted in-process callers can issue a binding. Graphon's Tool node still
resolves its LLM inputs and the native Tool/PluginTool retain type conversion
and daemon dispatch. This adapter guards the final scalar call and TEXT stream.
"""

from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, override

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DifyRunContext
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.db.session_factory import session_factory
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolInvokeMessage, ToolProviderType
from core.tools.plugin_tool.tool import PluginTool
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.node_runtime import DifyToolNodeRuntime
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.exc import ToolRuntimeInvocationError, ToolRuntimeResolutionError
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from services.dify_builder.execution_contracts import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    JsonToolExecutionContext,
    canonical_digest,
    context_digest,
)
from services.dify_builder.json_tool_execution import validate_json_parameters
from services.dify_builder.json_tool_metadata import (
    PROVIDER_ID,
    TOOL_NAME,
    UNIQUE_IDENTIFIER,
    InstalledJsonParse,
    require_same_json_installation,
    resolve_installed_json_parse,
    validate_current_json_controller,
)


@dataclass(frozen=True, slots=True)
class JsonRuntimeBinding:
    """Private issuer state; never part of graph data or persisted context."""

    context: JsonToolExecutionContext
    native_run_id: str
    native_task_id: str
    native_node_execution_id: str
    expected_parameters: Mapping[str, str | bool]
    recorder: BuilderExecutionRecorder
    metadata_reader: Callable[[str], InstalledJsonParse] = lambda tenant_id: resolve_installed_json_parse(
        tenant_id=tenant_id
    )


class JsonToolRuntimeIssuer(Protocol):
    def json_runtime_binding(
        self, *, node_id: str, native_run_id: str, native_node_execution_id: str
    ) -> JsonRuntimeBinding: ...


class _GuardedJsonPluginTool(PluginTool):
    """Preserve PluginTool.invoke and its conversion; guard its final _invoke."""

    def __init__(self, native: PluginTool, expected_parameters: Mapping[str, str | bool]):
        super().__init__(
            entity=native.entity,
            runtime=native.runtime,
            tenant_id=native.tenant_id,
            icon=native.icon,
            plugin_unique_identifier=native.plugin_unique_identifier,
        )
        self._expected_parameters = dict(expected_parameters)
        self._texts: list[str] = []
        self._text_bytes = 0
        self._invoked = False
        self._complete = False
        self._active_stream: Generator[ToolInvokeMessage] | None = None
        self._guard_stream: Generator[ToolInvokeMessage] | None = None

    @property
    def text_output(self) -> str:
        return "".join(self._texts)

    @property
    def text_bytes(self) -> int:
        return self._text_bytes

    @property
    def text_messages(self) -> int:
        return len(self._texts)

    @property
    def complete(self) -> bool:
        return self._complete

    def close_stream(self) -> None:
        if self._guard_stream is not None:
            self._guard_stream.close()
            self._guard_stream = None
        if self._active_stream is not None:
            self._active_stream.close()
            self._active_stream = None

    @override
    def invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        # super() is Tool.invoke: declared type casting remains native.
        stream = super().invoke(session, user_id, tool_parameters, conversation_id, app_id, message_id)
        self._guard_stream = stream
        return stream

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage]:
        if self._invoked:
            raise BuilderExecutionPolicyError("json_tool_invocation_replayed")
        self._invoked = True
        if session.in_transaction():
            raise BuilderExecutionPolicyError("json_tool_session_in_transaction")
        validate_json_parameters(tool_parameters)
        if tool_parameters != self._expected_parameters or canonical_digest(tool_parameters) != canonical_digest(
            self._expected_parameters
        ):
            raise BuilderExecutionPolicyError("json_tool_parameters_changed")
        messages = super()._invoke(
            session=session,
            user_id=user_id,
            tool_parameters=tool_parameters,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )
        self._active_stream = messages
        try:
            for message in messages:
                if session.in_transaction():
                    raise BuilderExecutionPolicyError("json_tool_session_in_transaction")
                if (
                    message.type != ToolInvokeMessage.MessageType.TEXT
                    or type(message.message) is not ToolInvokeMessage.TextMessage
                ):
                    raise BuilderExecutionPolicyError("unsupported_json_tool_output")
                text = message.message.text
                if type(text) is not str or len(text) > 65536:
                    raise BuilderExecutionPolicyError("json_execution_limit")
                try:
                    size = len(text.encode("utf-8", errors="strict"))
                except UnicodeError:
                    raise BuilderExecutionPolicyError("unsupported_json_tool_output") from None
                if len(self._texts) >= 8 or self._text_bytes + size > 65536:
                    raise BuilderExecutionPolicyError("json_execution_limit")
                self._texts.append(text)
                self._text_bytes += size
                yield message
            self._complete = True
        finally:
            messages.close()
            self._active_stream = None


class QualifiedJsonToolNodeRuntime(DifyToolNodeRuntime):
    """One owned JSON Tool node; Graphon's native Tool protocol remains in use."""

    def __init__(
        self,
        run_context: DifyRunContext | Mapping[str, Any],
        *,
        native_run_id: str,
        native_task_id: str,
        issuer: JsonToolRuntimeIssuer,
        session_maker: sessionmaker[Session] | None = None,
    ) -> None:
        super().__init__(run_context, session_maker=session_maker)
        self._native_run_id = native_run_id
        self._native_task_id = native_task_id
        self._issuer = issuer
        self._binding: JsonRuntimeBinding | None = None
        self._tool: _GuardedJsonPluginTool | None = None
        self._handle: ToolRuntimeHandle | None = None
        self._pre_installation: InstalledJsonParse | None = None
        self._spent = False
        self._invoke_started = False
        self._healthy = True

    @staticmethod
    @override
    def _require_no_transaction(session: Session) -> None:
        if session.in_transaction():
            raise BuilderExecutionPolicyError("json_tool_session_in_transaction")

    @override
    def build_file_reference(self, *, mapping: Mapping[str, Any]):
        raise BuilderExecutionPolicyError("unsupported_json_tool_file")

    @override
    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle:
        if self._binding is not None or self._spent or not self._healthy:
            raise ToolRuntimeResolutionError("json_tool_runtime_replayed")
        # Spend resolution before an issuer or transport can fail.
        self._spent = True
        try:
            if type(node_execution_id) is not str or not node_execution_id or variable_pool is None:
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            binding = self._issuer.json_runtime_binding(
                node_id=node_id, native_run_id=self._native_run_id, native_node_execution_id=node_execution_id
            )
            context = binding.context
            if (
                binding.native_run_id != self._native_run_id
                or binding.native_task_id != self._native_task_id
                or binding.native_node_execution_id != node_execution_id
                or context.qualified_tool.node_id != node_id
                or context.tenant_id != self._run_context.tenant_id
                or context.app_id != self._run_context.app_id
                or context.actor_id != self._run_context.user_id
                or context.context_digest != context_digest(context)
                or not binding.recorder.healthy
            ):
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            validate_json_parameters(binding.expected_parameters)
            if canonical_digest(binding.expected_parameters) != context.qualified_tool.final_parameters_digest:
                raise BuilderExecutionPolicyError("json_tool_parameters_changed")
            self._validate_native_node(node_data, binding.expected_parameters)
            with (self._session_maker or session_factory.get_session_maker())() as session:
                self._require_no_transaction(session)
                installation = binding.metadata_reader(context.tenant_id)
                self._require_no_transaction(session)
                require_same_json_installation(context.qualified_tool, installation)
                spec = self._build_tool_runtime_spec(node_data)
                # A raw persisted bool is admitted, but the v2 FORM converter
                # requires native ToolInput shape. Do not alter node_data/graph.
                if type(spec.tool_configurations["ensure_ascii"]) is bool:
                    spec.tool_configurations["ensure_ascii"] = {
                        "type": "constant",
                        "value": spec.tool_configurations["ensure_ascii"],
                    }
                native = ToolManager.get_tool_runtime(
                    provider_type=spec.provider_type,
                    provider_id=spec.provider_id,
                    tool_name=spec.tool_name,
                    tenant_id=context.tenant_id,
                    user_id=self._run_context.user_id,
                    invoke_from=self._run_context.invoke_from,
                    tool_invoke_from=ToolInvokeFrom.WORKFLOW,
                    credential_id=spec.credential_id,
                    json_provider_validator=lambda controller, tool: validate_current_json_controller(
                        controller, tool, expected=installation
                    ),
                )
                self._require_no_transaction(session)
                if type(native) is not PluginTool:
                    raise BuilderExecutionPolicyError("json_tool_controller_mismatch")
                converted = ToolManager._convert_tool_parameters_type(
                    native.get_merged_runtime_parameters(), variable_pool, spec.tool_configurations, typ="workflow"
                )
                self._require_no_transaction(session)
                if converted != {"ensure_ascii": binding.expected_parameters["ensure_ascii"]}:
                    raise BuilderExecutionPolicyError("json_tool_parameters_changed")
                native.runtime.runtime_parameters.update(converted)
            guarded = _GuardedJsonPluginTool(native, binding.expected_parameters)
            handle = ToolRuntimeHandle(raw=guarded)
            self._binding = binding
            self._tool = guarded
            self._handle = handle
            self._pre_installation = installation
            return handle
        except Exception as exc:
            self._healthy = False
            reason = exc.reason_code if isinstance(exc, BuilderExecutionPolicyError) else "json_tool_resolution_failed"
            raise ToolRuntimeResolutionError(str(BuilderExecutionPolicyError(reason))) from None

    @staticmethod
    def _validate_native_node(node_data: ToolNodeData, expected: Mapping[str, str | bool]) -> None:
        if (
            node_data.provider_type.value != ToolProviderType.BUILT_IN.value
            or node_data.provider_id != PROVIDER_ID
            or node_data.provider_name != PROVIDER_ID
            or node_data.plugin_unique_identifier not in (None, UNIQUE_IDENTIFIER)
            or node_data.tool_name != TOOL_NAME
            or node_data.tool_node_version != "2"
            or node_data.credential_id is not None
            or set(node_data.tool_configurations) != {"ensure_ascii"}
            or set(node_data.tool_parameters)
            not in ({"content", "json_filter"}, {"content", "json_filter", "ensure_ascii"})
        ):
            raise BuilderExecutionPolicyError("unsupported_json_tool_configuration")
        flag = node_data.tool_configurations["ensure_ascii"]
        if type(flag) is not bool or flag is not expected["ensure_ascii"]:
            raise BuilderExecutionPolicyError("unsupported_json_tool_configuration")
        if "ensure_ascii" in node_data.tool_parameters:
            derived = node_data.tool_parameters["ensure_ascii"]
            if derived.model_dump(mode="python") != {"type": "constant", "value": flag}:
                raise BuilderExecutionPolicyError("unsupported_json_tool_configuration")

    @override
    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage]:
        binding, tool, installation = self._binding, self._tool, self._pre_installation
        if (
            not self._healthy
            or binding is None
            or tool is None
            or installation is None
            or tool_runtime is not self._handle
            or self._invoke_started
            or not binding.recorder.healthy
        ):
            raise ToolRuntimeInvocationError("json_tool_runtime_unavailable")
        # Generator creation is lazy, so latch at first iteration, then never retry.
        self._invoke_started = True
        completed = False
        try:
            with (self._session_maker or session_factory.get_session_maker())() as session:
                self._require_no_transaction(session)
                messages = ToolEngine.generic_invoke(
                    session=session,
                    tool=tool,
                    tool_parameters=dict(tool_parameters),
                    user_id=self._run_context.user_id,
                    workflow_tool_callback=DifyWorkflowCallbackHandler(),
                    workflow_call_depth=workflow_call_depth,
                    app_id=self._run_context.app_id,
                    conversation_id=None,
                )
                transformed = ToolFileMessageTransformer.transform_tool_invoke_messages(
                    messages=messages,
                    user_id=self._run_context.user_id,
                    tenant_id=self._run_context.tenant_id,
                    conversation_id=None,
                )
                try:
                    yield from self._adapt_messages(transformed, provider_name=provider_name)
                    self._require_no_transaction(session)
                finally:
                    transformed.close()
                    messages.close()
                    tool.close_stream()
            if not tool.complete:
                raise BuilderExecutionPolicyError("json_tool_stream_incomplete")
            # Metadata is read only after the native stream is fully exhausted.
            with (self._session_maker or session_factory.get_session_maker())() as session:
                self._require_no_transaction(session)
                post = binding.metadata_reader(binding.context.tenant_id)
                self._require_no_transaction(session)
            require_same_json_installation(binding.context.qualified_tool, post)
            if post != installation or not binding.recorder.healthy:
                raise BuilderExecutionPolicyError("json_tool_installation_changed")
            receipt = BuilderExecutionObservation(
                observation_id=binding.native_node_execution_id,
                invocation_id=binding.native_node_execution_id,
                request_id=binding.context.request_id,
                node_id=binding.context.qualified_tool.node_id,
                kind="qualified_json_completed",
                implementation_version=(
                    f"{binding.context.admitted_nodes[1].implementation}:"
                    f"{binding.context.admitted_nodes[1].node_version}"
                ),
                reason_code="completed",
                native_node_execution_id=binding.native_node_execution_id,
                qualification_digest=installation.qualification_digest,
                installed_binding_digest=installation.binding_digest,
                final_parameters_digest=binding.context.qualified_tool.final_parameters_digest,
                pre_binding_digest=installation.binding_digest,
                post_binding_digest=post.binding_digest,
                native_text_output_digest=canonical_digest(tool.text_output),
                text_bytes=tool.text_bytes,
                text_messages=tool.text_messages,
            )
            binding.recorder.record(receipt)
            if not binding.recorder.healthy:
                raise BuilderExecutionPolicyError("json_tool_recorder_unhealthy")
            completed = True
        except Exception as exc:
            self._healthy = False
            reason = exc.reason_code if isinstance(exc, BuilderExecutionPolicyError) else "json_tool_invocation_failed"
            raise ToolRuntimeInvocationError(str(BuilderExecutionPolicyError(reason))) from None
        finally:
            if not completed:
                self._healthy = False
