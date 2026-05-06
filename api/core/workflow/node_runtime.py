from __future__ import annotations

from collections.abc import Callable, Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast, overload

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.app.file_access import DatabaseFileAccessController
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_manager import ModelInstance
from core.plugin.impl.exc import PluginDaemonClientSideError, PluginInvokeError
from core.plugin.impl.plugin import PluginInstaller
from core.prompt.utils.prompt_message_util import PromptMessageUtil
from core.repositories.human_input_repository import (
    FormCreateParams,
    HumanInputFormRepository,
    HumanInputFormRepositoryImpl,
)
from core.tools.entities.tool_entities import ToolProviderType as CoreToolProviderType
from core.tools.errors import ToolInvokeError
from core.tools.tool_engine import ToolEngine
from core.tools.tool_file_manager import ToolFileManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.file_reference import build_file_reference
from extensions.ext_database import db
from factories import file_factory
from graphon.file import FileTransferMethod, FileType
from graphon.model_runtime.entities import LLMMode
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import PromptMessage, PromptMessageTool
from graphon.model_runtime.entities.model_entities import AIModelEntity
from graphon.model_runtime.model_providers.base.large_language_model import LargeLanguageModel
from graphon.nodes.human_input.entities import HumanInputNodeData
from graphon.nodes.llm.runtime_protocols import (
    PreparedLLMProtocol,
    PromptMessageSerializerProtocol,
    RetrieverAttachmentLoaderProtocol,
)
from graphon.nodes.protocols import FileReferenceFactoryProtocol, HttpClientProtocol, ToolFileManagerProtocol
from graphon.nodes.runtime import (
    HumanInputFormStateProtocol,
    HumanInputNodeRuntimeProtocol,
    ToolNodeRuntimeProtocol,
)
from graphon.nodes.tool.exc import ToolNodeError, ToolRuntimeInvocationError, ToolRuntimeResolutionError
from graphon.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)
from models.dataset import SegmentAttachmentBinding
from models.model import UploadFile
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

from .human_input_adapter import (
    BoundRecipient,
    DeliveryChannelConfig,
    DeliveryMethodType,
    EmailDeliveryMethod,
    EmailRecipients,
    is_human_input_webapp_enabled,
    parse_human_input_delivery_methods,
)
from .system_variables import SystemVariableKey, get_system_text

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool
    from core.tools.entities.tool_entities import ToolInvokeMessage as CoreToolInvokeMessage
    from graphon.file import File
    from graphon.nodes.llm.file_saver import LLMFileSaver
    from graphon.nodes.tool.entities import ToolNodeData


_file_access_controller = DatabaseFileAccessController()


def resolve_dify_run_context(run_context: Mapping[str, Any] | DifyRunContext) -> DifyRunContext:
    if isinstance(run_context, DifyRunContext):
        return run_context

    raw_ctx = run_context.get(DIFY_RUN_CONTEXT_KEY)
    if raw_ctx is None:
        raise ValueError(f"run_context missing required key: {DIFY_RUN_CONTEXT_KEY}")
    if isinstance(raw_ctx, DifyRunContext):
        return raw_ctx
    return DifyRunContext.model_validate(raw_ctx)


def apply_dify_debug_email_recipient(
    method: DeliveryChannelConfig,
    *,
    enabled: bool,
    actor_id: str | None,
) -> DeliveryChannelConfig:
    """Apply the Dify debugger-specific email recipient override outside `graphon`."""
    if not enabled:
        return method
    if not isinstance(method, EmailDeliveryMethod):
        return method
    if not method.config.debug_mode:
        return method

    if actor_id is None:
        debug_recipients = EmailRecipients(include_bound_group=False, items=[])
    else:
        debug_recipients = EmailRecipients(
            include_bound_group=False,
            items=[BoundRecipient(reference_id=actor_id)],
        )
    debug_config = method.config.with_recipients(debug_recipients)
    return method.model_copy(update={"config": debug_config})


class DifyFileReferenceFactory(FileReferenceFactoryProtocol):
    def __init__(self, run_context: Mapping[str, Any] | DifyRunContext) -> None:
        self._run_context = resolve_dify_run_context(run_context)

    def build_from_mapping(self, *, mapping: Mapping[str, Any]):
        return file_factory.build_from_mapping(
            mapping=mapping,
            tenant_id=self._run_context.tenant_id,
            access_controller=_file_access_controller,
        )


class DifyPreparedLLM(PreparedLLMProtocol):
    """Workflow-layer adapter that hides the full `ModelInstance` API from `graphon` nodes."""

    def __init__(self, model_instance: ModelInstance) -> None:
        self._model_instance = model_instance

    @property
    def provider(self) -> str:
        return self._model_instance.provider

    @property
    def model_name(self) -> str:
        return self._model_instance.model_name

    @property
    def parameters(self) -> Mapping[str, Any]:
        return self._model_instance.parameters

    @parameters.setter
    def parameters(self, value: Mapping[str, Any]) -> None:
        self._model_instance.parameters = value

    @property
    def stop(self) -> Sequence[str] | None:
        return self._model_instance.stop

    def get_model_schema(self) -> AIModelEntity:
        model_schema = cast(LargeLanguageModel, self._model_instance.model_type_instance).get_model_schema(
            self._model_instance.model_name,
            self._model_instance.credentials,
        )
        if model_schema is None:
            raise ValueError(f"Model schema not found for {self._model_instance.model_name}")
        return model_schema

    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        return self._model_instance.get_llm_num_tokens(prompt_messages)

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunk, None, None]: ...

    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]:
        return self._model_instance.invoke_llm(
            prompt_messages=list(prompt_messages),
            model_parameters=dict(model_parameters),
            tools=list(tools or []),
            stop=list(stop or []),
            stream=stream,
        )

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResultWithStructuredOutput: ...

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...

    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput, None, None]:
        return invoke_llm_with_structured_output(
            provider=self.provider,
            model_schema=self.get_model_schema(),
            model_instance=self._model_instance,
            prompt_messages=prompt_messages,
            json_schema=json_schema,
            model_parameters=model_parameters,
            stop=list(stop or []),
            stream=stream,
        )

    def is_structured_output_parse_error(self, error: Exception) -> bool:
        return isinstance(error, OutputParserError)


class DifyPromptMessageSerializer(PromptMessageSerializerProtocol):
    def serialize(
        self,
        *,
        model_mode: LLMMode,
        prompt_messages: Sequence[PromptMessage],
    ) -> Any:
        return PromptMessageUtil.prompt_messages_to_prompt_for_saving(
            model_mode=model_mode,
            prompt_messages=prompt_messages,
        )


class DifyRetrieverAttachmentLoader(RetrieverAttachmentLoaderProtocol):
    """Resolve retriever attachments through Dify persistence and return graph file references."""

    def __init__(self, *, file_reference_factory: FileReferenceFactoryProtocol) -> None:
        self._file_reference_factory = file_reference_factory

    def load(self, *, segment_id: str) -> Sequence[File]:
        with Session(db.engine, expire_on_commit=False) as session:
            attachments_with_bindings = session.execute(
                select(SegmentAttachmentBinding, UploadFile)
                .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                .where(SegmentAttachmentBinding.segment_id == segment_id)
            ).all()

        return [
            self._file_reference_factory.build_from_mapping(
                mapping={
                    "id": upload_file.id,
                    "filename": upload_file.name,
                    "extension": "." + upload_file.extension,
                    "mime_type": upload_file.mime_type,
                    "type": FileType.IMAGE,
                    "transfer_method": FileTransferMethod.LOCAL_FILE,
                    "remote_url": upload_file.source_url,
                    "reference": build_file_reference(record_id=str(upload_file.id)),
                    "size": upload_file.size,
                }
            )
            for _, upload_file in attachments_with_bindings
        ]


class DifyToolFileManager(ToolFileManagerProtocol):
    """Workflow adapter that resolves conversation scope outside `graphon`."""

    _conversation_id_getter: Callable[[], str | None] | None

    def __init__(
        self,
        run_context: Mapping[str, Any] | DifyRunContext,
        *,
        conversation_id_getter: Callable[[], str | None] | None = None,
    ) -> None:
        self._run_context = resolve_dify_run_context(run_context)
        self._manager = ToolFileManager()
        self._conversation_id_getter = conversation_id_getter

    def create_file_by_raw(
        self,
        *,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> Any:
        conversation_id = self._conversation_id_getter() if self._conversation_id_getter is not None else None
        return self._manager.create_file_by_raw(
            user_id=self._run_context.user_id,
            tenant_id=self._run_context.tenant_id,
            conversation_id=conversation_id,
            file_binary=file_binary,
            mimetype=mimetype,
            filename=filename,
        )

    def get_file_generator_by_tool_file_id(self, tool_file_id: str):
        return self._manager.get_file_generator_by_tool_file_id(tool_file_id)


@dataclass(frozen=True, slots=True)
class _WorkflowToolRuntimeSpec:
    provider_type: CoreToolProviderType
    provider_id: str
    tool_name: str
    tool_configurations: dict[str, Any]
    credential_id: str | None = None


@dataclass(frozen=True, slots=True)
class _WorkflowToolRuntimeBinding:
    """Workflow-private runtime state stored inside the opaque graph handle.

    The binding keeps conversation scope in `core.workflow` while `graphon`
    continues to treat the handle as an opaque token.
    """

    tool: Tool
    conversation_id: str | None = None


class DifyToolNodeRuntime(ToolNodeRuntimeProtocol):
    def __init__(self, run_context: Mapping[str, Any] | DifyRunContext) -> None:
        self._run_context = resolve_dify_run_context(run_context)
        self._file_reference_factory = DifyFileReferenceFactory(self._run_context)

    @property
    def file_reference_factory(self) -> FileReferenceFactoryProtocol:
        return self._file_reference_factory

    def build_file_reference(self, *, mapping: Mapping[str, Any]):
        return self._file_reference_factory.build_from_mapping(mapping=mapping)

    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool,
    ) -> ToolRuntimeHandle:
        try:
            tool_runtime = ToolManager.get_workflow_tool_runtime(
                self._run_context.tenant_id,
                self._run_context.app_id,
                node_id,
                self._build_tool_runtime_spec(node_data),
                self._run_context.user_id,
                self._run_context.invoke_from,
                variable_pool,
            )
        except ToolNodeError:
            raise
        except Exception as exc:
            raise ToolRuntimeResolutionError(str(exc)) from exc

        conversation_id = (
            None if variable_pool is None else get_system_text(variable_pool, SystemVariableKey.CONVERSATION_ID)
        )
        return ToolRuntimeHandle(raw=_WorkflowToolRuntimeBinding(tool=tool_runtime, conversation_id=conversation_id))

    def get_runtime_parameters(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> Sequence[ToolRuntimeParameter]:
        tool = self._tool_from_handle(tool_runtime)
        return [
            ToolRuntimeParameter(name=parameter.name, required=parameter.required)
            for parameter in (tool.get_merged_runtime_parameters() or [])
        ]

    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]:
        runtime_binding = self._binding_from_handle(tool_runtime)
        tool = runtime_binding.tool
        callback = DifyWorkflowCallbackHandler()

        try:
            messages = ToolEngine.generic_invoke(
                tool=tool,
                tool_parameters=dict(tool_parameters),
                user_id=self._run_context.user_id,
                workflow_tool_callback=callback,
                workflow_call_depth=workflow_call_depth,
                app_id=self._run_context.app_id,
                conversation_id=runtime_binding.conversation_id,
            )
        except Exception as exc:
            raise self._map_invocation_exception(exc, provider_name=provider_name) from exc

        transformed_messages = ToolFileMessageTransformer.transform_tool_invoke_messages(
            messages=messages,
            user_id=self._run_context.user_id,
            tenant_id=self._run_context.tenant_id,
            conversation_id=runtime_binding.conversation_id,
        )

        return self._adapt_messages(transformed_messages, provider_name=provider_name)

    def get_usage(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> LLMUsage:
        latest = getattr(self._binding_from_handle(tool_runtime).tool, "latest_usage", None)
        if isinstance(latest, LLMUsage):
            return latest
        if isinstance(latest, dict):
            return LLMUsage.model_validate(latest)
        return LLMUsage.empty_usage()

    def resolve_provider_icons(
        self,
        *,
        provider_name: str,
        default_icon: str | None = None,
    ) -> tuple[str | Mapping[str, str] | None, str | Mapping[str, str] | None]:
        icon: str | Mapping[str, str] | None = default_icon
        icon_dark: str | Mapping[str, str] | None = None

        manager = PluginInstaller()
        plugins = manager.list_plugins(self._run_context.tenant_id)
        try:
            current_plugin = next(plugin for plugin in plugins if f"{plugin.plugin_id}/{plugin.name}" == provider_name)
            icon = current_plugin.declaration.icon
        except StopIteration:
            pass

        try:
            builtin_tool = next(
                provider
                for provider in BuiltinToolManageService.list_builtin_tools(
                    self._run_context.user_id,
                    self._run_context.tenant_id,
                )
                if provider.name == provider_name
            )
            icon = builtin_tool.icon
            icon_dark = builtin_tool.icon_dark
        except StopIteration:
            pass

        return icon, icon_dark

    @staticmethod
    def _tool_from_handle(tool_runtime: ToolRuntimeHandle) -> Tool:
        return DifyToolNodeRuntime._binding_from_handle(tool_runtime).tool

    @staticmethod
    def _binding_from_handle(tool_runtime: ToolRuntimeHandle) -> _WorkflowToolRuntimeBinding:
        if isinstance(tool_runtime.raw, _WorkflowToolRuntimeBinding):
            return tool_runtime.raw
        return _WorkflowToolRuntimeBinding(tool=cast("Tool", tool_runtime.raw))

    @staticmethod
    def _build_tool_runtime_spec(node_data: ToolNodeData) -> _WorkflowToolRuntimeSpec:
        tool_configurations = dict(node_data.tool_configurations)
        tool_configurations.update(
            {name: tool_input.model_dump(mode="python") for name, tool_input in node_data.tool_parameters.items()}
        )
        return _WorkflowToolRuntimeSpec(
            provider_type=CoreToolProviderType(node_data.provider_type.value),
            provider_id=node_data.provider_id,
            tool_name=node_data.tool_name,
            tool_configurations=tool_configurations,
            credential_id=node_data.credential_id,
        )

    def _adapt_messages(
        self,
        messages: Generator[CoreToolInvokeMessage, None, None],
        *,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]:
        try:
            for message in messages:
                yield self._convert_message(message)
        except Exception as exc:
            raise self._map_invocation_exception(exc, provider_name=provider_name) from exc

    def _convert_message(self, message: CoreToolInvokeMessage) -> ToolRuntimeMessage:
        graph_message_type = ToolRuntimeMessage.MessageType(message.type.value)
        graph_message = self._convert_message_payload(message.message)
        graph_meta = message.meta.copy() if message.meta is not None else None
        return ToolRuntimeMessage(type=graph_message_type, message=graph_message, meta=graph_meta)

    def _convert_message_payload(
        self,
        message: CoreToolInvokeMessage.TextMessage
        | CoreToolInvokeMessage.JsonMessage
        | CoreToolInvokeMessage.BlobChunkMessage
        | CoreToolInvokeMessage.BlobMessage
        | CoreToolInvokeMessage.LogMessage
        | CoreToolInvokeMessage.FileMessage
        | CoreToolInvokeMessage.VariableMessage
        | CoreToolInvokeMessage.RetrieverResourceMessage
        | None,
    ) -> (
        ToolRuntimeMessage.TextMessage
        | ToolRuntimeMessage.JsonMessage
        | ToolRuntimeMessage.BlobChunkMessage
        | ToolRuntimeMessage.BlobMessage
        | ToolRuntimeMessage.LogMessage
        | ToolRuntimeMessage.FileMessage
        | ToolRuntimeMessage.VariableMessage
        | ToolRuntimeMessage.RetrieverResourceMessage
        | None
    ):
        if message is None:
            return None

        from core.tools.entities.tool_entities import ToolInvokeMessage as CoreToolInvokeMessage

        if isinstance(message, CoreToolInvokeMessage.TextMessage):
            return ToolRuntimeMessage.TextMessage(text=message.text)
        if isinstance(message, CoreToolInvokeMessage.JsonMessage):
            return ToolRuntimeMessage.JsonMessage(
                json_object=message.json_object,
                suppress_output=message.suppress_output,
            )
        if isinstance(message, CoreToolInvokeMessage.BlobMessage):
            return ToolRuntimeMessage.BlobMessage(blob=message.blob)
        if isinstance(message, CoreToolInvokeMessage.BlobChunkMessage):
            return ToolRuntimeMessage.BlobChunkMessage(
                id=message.id,
                sequence=message.sequence,
                total_length=message.total_length,
                blob=message.blob,
                end=message.end,
            )
        if isinstance(message, CoreToolInvokeMessage.FileMessage):
            return ToolRuntimeMessage.FileMessage(file_marker=message.file_marker)
        if isinstance(message, CoreToolInvokeMessage.VariableMessage):
            return ToolRuntimeMessage.VariableMessage(
                variable_name=message.variable_name,
                variable_value=message.variable_value,
                stream=message.stream,
            )
        if isinstance(message, CoreToolInvokeMessage.LogMessage):
            return ToolRuntimeMessage.LogMessage(
                id=message.id,
                label=message.label,
                parent_id=message.parent_id,
                error=message.error,
                status=ToolRuntimeMessage.LogMessage.LogStatus(message.status.value),
                data=dict(message.data),
                metadata=dict(message.metadata),
            )
        if isinstance(message, CoreToolInvokeMessage.RetrieverResourceMessage):
            retriever_resources = [
                resource.model_dump() if hasattr(resource, "model_dump") else dict(resource)
                for resource in message.retriever_resources
            ]
            return ToolRuntimeMessage.RetrieverResourceMessage(
                retriever_resources=retriever_resources,
                context=message.context,
            )

        raise TypeError(f"unsupported tool message payload: {type(message).__name__}")

    @staticmethod
    def _map_invocation_exception(exc: Exception, *, provider_name: str) -> ToolNodeError:
        if isinstance(exc, ToolNodeError):
            return exc
        if isinstance(exc, PluginInvokeError):
            return ToolRuntimeInvocationError(exc.to_user_friendly_error(plugin_name=provider_name))
        if isinstance(exc, PluginDaemonClientSideError):
            return ToolRuntimeInvocationError(f"Failed to invoke tool, error: {exc.description}")
        if isinstance(exc, ToolInvokeError):
            return ToolRuntimeInvocationError(f"Failed to invoke tool {provider_name}: {exc}")
        return ToolRuntimeInvocationError(str(exc))


class DifyHumanInputNodeRuntime(HumanInputNodeRuntimeProtocol):
    def __init__(
        self,
        run_context: Mapping[str, Any] | DifyRunContext,
        *,
        workflow_execution_id_getter: Callable[[], str | None] | None = None,
        form_repository: HumanInputFormRepository | None = None,
    ) -> None:
        self._run_context = resolve_dify_run_context(run_context)
        self._workflow_execution_id_getter = workflow_execution_id_getter
        self._form_repository = form_repository

    def _invoke_source(self) -> str:
        invoke_from = self._run_context.invoke_from
        if isinstance(invoke_from, str):
            return invoke_from
        return str(getattr(invoke_from, "value", invoke_from))

    def _resolve_delivery_methods(self, *, node_data: HumanInputNodeData) -> Sequence[DeliveryChannelConfig]:
        invoke_source = self._invoke_source()
        methods = [method for method in parse_human_input_delivery_methods(node_data) if method.enabled]
        if invoke_source in {"debugger", "explore"}:
            methods = [method for method in methods if method.type != DeliveryMethodType.WEBAPP]
        return [
            apply_dify_debug_email_recipient(
                method,
                enabled=invoke_source == "debugger",
                actor_id=self._run_context.user_id,
            )
            for method in methods
        ]

    def _display_in_ui(self, *, node_data: HumanInputNodeData) -> bool:
        if self._invoke_source() == "debugger":
            return True
        return is_human_input_webapp_enabled(node_data)

    def build_form_repository(self) -> HumanInputFormRepository:
        if self._form_repository is not None:
            return self._form_repository

        return self._build_form_repository()

    def _build_form_repository(self) -> HumanInputFormRepository:
        invoke_source = self._invoke_source()
        return HumanInputFormRepositoryImpl(
            tenant_id=self._run_context.tenant_id,
            app_id=self._run_context.app_id,
            workflow_execution_id=self._workflow_execution_id_getter() if self._workflow_execution_id_getter else None,
            invoke_source=invoke_source,
            submission_actor_id=self._run_context.user_id if invoke_source in {"debugger", "explore"} else None,
        )

    def with_form_repository(self, form_repository: HumanInputFormRepository) -> DifyHumanInputNodeRuntime:
        return DifyHumanInputNodeRuntime(
            self._run_context,
            workflow_execution_id_getter=self._workflow_execution_id_getter,
            form_repository=form_repository,
        )

    def get_form(self, *, node_id: str) -> HumanInputFormStateProtocol | None:
        repo = self.build_form_repository()
        return repo.get_form(node_id)

    def create_form(
        self,
        *,
        node_id: str,
        node_data: HumanInputNodeData,
        rendered_content: str,
        resolved_default_values: Mapping[str, Any],
    ) -> HumanInputFormStateProtocol:
        repo = self.build_form_repository()
        params = FormCreateParams(
            workflow_execution_id=self._workflow_execution_id_getter() if self._workflow_execution_id_getter else None,
            node_id=node_id,
            form_config=node_data,
            rendered_content=rendered_content,
            delivery_methods=self._resolve_delivery_methods(node_data=node_data),
            display_in_ui=self._display_in_ui(node_data=node_data),
            resolved_default_values=resolved_default_values,
        )
        return repo.create_form(params)


def build_dify_llm_file_saver(
    *,
    run_context: Mapping[str, Any] | DifyRunContext,
    http_client: HttpClientProtocol,
    conversation_id_getter: Callable[[], str | None] | None = None,
) -> LLMFileSaver:
    from graphon.nodes.llm.file_saver import FileSaverImpl

    return FileSaverImpl(
        tool_file_manager=DifyToolFileManager(run_context, conversation_id_getter=conversation_id_getter),
        file_reference_factory=DifyFileReferenceFactory(run_context),
        http_client=http_client,
    )
