from __future__ import annotations

import base64
from collections.abc import Callable, Generator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, cast

from graphon.file.models import File
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.runtime import ToolNodeRuntimeProtocol
from graphon.nodes.tool.entities import ToolInputType, ToolNodeData
from graphon.nodes.tool.exc import ToolNodeError
from graphon.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)
from graphon.runtime.variable_pool import VariablePool
from graphon.variables.template_resolution import convert_template

from .entities import DslToolCredential
from .slim.client import SlimClient, SlimClientConfig, SlimClientError


class SlimToolAction(StrEnum):
    INVOKE_TOOL = "invoke_tool"
    GET_TOOL_RUNTIME_PARAMETERS = "get_tool_runtime_parameters"


class SlimToolParameterForm(StrEnum):
    FORM = "form"
    LLM = "llm"
    SCHEMA = "schema"


class SlimToolParameterType(StrEnum):
    STRING = "string"
    NUMBER = "number"
    BOOLEAN = "boolean"
    ARRAY = "array"
    FILES = "files"
    CHECKBOX = "checkbox"
    OBJECT = "object"
    MODEL_SELECTOR = "model-selector"
    APP_SELECTOR = "app-selector"


_ARRAY_PARAMETER_TYPES = frozenset((
    SlimToolParameterType.ARRAY,
    SlimToolParameterType.FILES,
    SlimToolParameterType.CHECKBOX,
))
_OBJECT_PARAMETER_TYPES = frozenset((
    SlimToolParameterType.OBJECT,
    SlimToolParameterType.MODEL_SELECTOR,
    SlimToolParameterType.APP_SELECTOR,
))

type SlimActionInvoker = Callable[
    [str, str | SlimToolAction, Mapping[str, Any]],
    Iterable[Any],
]


@dataclass(frozen=True, slots=True)
class _SlimToolParameter:
    name: str
    required: bool = False
    form: SlimToolParameterForm = SlimToolParameterForm.LLM
    type: SlimToolParameterType = SlimToolParameterType.STRING
    default: Any = None
    options: tuple[Mapping[str, Any], ...] = ()

    @classmethod
    def from_mapping(cls, parameter: Mapping[str, Any]) -> _SlimToolParameter:
        name = parameter.get("name")
        if not isinstance(name, str) or not name:
            msg = "Slim tool parameter is missing a name."
            raise ToolNodeError(msg)

        raw_options = parameter.get("options") or []
        options = (
            tuple(dict(option) for option in raw_options if isinstance(option, Mapping))
            if isinstance(raw_options, list)
            else ()
        )
        return cls(
            name=name,
            required=bool(parameter.get("required", False)),
            form=_tool_parameter_form(parameter.get("form")),
            type=_tool_parameter_type(parameter.get("type")),
            default=parameter.get("default"),
            options=options,
        )

    @property
    def is_form_parameter(self) -> bool:
        return self.form == SlimToolParameterForm.FORM

    def to_runtime_parameter(self) -> ToolRuntimeParameter:
        return ToolRuntimeParameter(name=self.name, required=self.required)


@dataclass(frozen=True, slots=True)
class _SlimToolDeclaration:
    parameters: tuple[_SlimToolParameter, ...] = ()
    has_runtime_parameters: bool = False


@dataclass(frozen=True, slots=True)
class _SlimPreparedTool:
    plugin_id: str
    provider: str
    provider_id: str
    tool_name: str
    credentials: Mapping[str, Any]
    credential_type: str
    parameters: tuple[_SlimToolParameter, ...]
    form_values: Mapping[str, Any]


class _SlimToolActionClient:
    def __init__(
        self,
        *,
        config: SlimClientConfig,
        plugin_id: str,
        action_invoker: SlimActionInvoker | None = None,
    ) -> None:
        self._plugin_id = plugin_id
        self._action_invoker = action_invoker
        self._client = None if action_invoker is not None else SlimClient(config=config)

    def extract(self) -> Mapping[str, Any]:
        client = self._require_client()
        try:
            return client.extract(plugin_id=self._plugin_id)
        except SlimClientError as error:
            raise ToolNodeError(str(error)) from error

    def invoke(
        self,
        *,
        action: str | SlimToolAction,
        data: Mapping[str, Any],
    ) -> Generator[Any, None, None]:
        if self._action_invoker is not None:
            yield from self._action_invoker(self._plugin_id, action, data)
            return

        client = self._require_client()
        try:
            yield from client.invoke_chunks(
                plugin_id=self._plugin_id,
                action=action,
                data=data,
            )
        except SlimClientError as error:
            raise ToolNodeError(str(error)) from error

    def invoke_mapping(
        self,
        *,
        action: str | SlimToolAction,
        data: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        chunks = list(self.invoke(action=action, data=data))
        if not chunks:
            return {}
        payload = chunks[-1]
        if not isinstance(payload, Mapping):
            msg = f"Unexpected Slim {action} payload: {payload!r}"
            raise ToolNodeError(msg)
        unwrapped = _unwrap_daemon_response(payload)
        if not isinstance(unwrapped, Mapping):
            msg = f"Unexpected Slim {action} response data: {unwrapped!r}"
            raise ToolNodeError(msg)
        return unwrapped

    def _require_client(self) -> SlimClient:
        if self._client is not None:
            return self._client
        msg = "Slim client was not initialized."
        raise ToolNodeError(msg)


@dataclass(slots=True)
class _SlimToolParameterResolver:
    variable_pool: VariablePool | None

    def resolve_form_values(
        self,
        *,
        parameters: Sequence[_SlimToolParameter],
        tool_configurations: Mapping[str, Any],
    ) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for parameter in parameters:
            if not parameter.is_form_parameter:
                continue
            if parameter.name not in tool_configurations:
                continue
            resolved = self._resolve_configured_value(
                parameter=parameter,
                raw_config=tool_configurations[parameter.name],
            )
            if resolved is not _MISSING:
                result[parameter.name] = _cast_tool_parameter_value(
                    parameter=parameter,
                    value=resolved,
                )
        return result

    def _resolve_configured_value(
        self,
        *,
        parameter: _SlimToolParameter,
        raw_config: Any,
    ) -> Any:
        selector_value = _extract_selector_value(
            parameter=parameter,
            raw_config=raw_config,
        )
        if selector_value is not None:
            return selector_value
        if isinstance(raw_config, Mapping) and "type" in raw_config:
            return self._resolve_tool_input_value(
                name=parameter.name,
                raw_tool_input=raw_config,
            )
        if isinstance(raw_config, Mapping) and set(raw_config) == {"value"}:
            return raw_config["value"]
        return _init_frontend_parameter(parameter=parameter, value=raw_config)

    def _resolve_tool_input_value(
        self,
        *,
        name: str,
        raw_tool_input: Mapping[str, Any],
    ) -> Any:
        input_type = _tool_input_type(raw_tool_input.get("type"))
        value = raw_tool_input.get("value")
        match input_type:
            case ToolInputType.CONSTANT:
                return value
            case ToolInputType.MIXED:
                if self.variable_pool is None:
                    return str(value)
                return convert_template(self.variable_pool, str(value)).text
            case ToolInputType.VARIABLE:
                if self.variable_pool is None:
                    return _MISSING
                if not isinstance(value, list) or not all(
                    isinstance(part, str) for part in value
                ):
                    msg = f"Variable tool configuration {name!r} must be a selector."
                    raise ToolNodeError(msg)
                variable = self.variable_pool.get(value)
                if variable is None:
                    msg = f"Variable {value} does not exist"
                    raise ToolNodeError(msg)
                return variable.value
            case None:
                return value if value is not None else _MISSING
            case _:
                msg = f"Unsupported tool input type: {input_type}"
                raise ToolNodeError(msg)


@dataclass(slots=True)
class SlimToolNodeRuntime(ToolNodeRuntimeProtocol):
    """Slim-backed adapter for one prepared plugin tool node.

    The Slim daemon receives ``plugin_id`` out of band and receives
    ``provider`` as the plugin-local provider slug in the action payload.
    The pair ``(plugin_id, provider)`` is the actual runtime identity.
    """

    config: SlimClientConfig
    plugin_id: str
    provider: str
    provider_id: str
    tool_name: str
    credentials: Mapping[str, Any]
    credential_type: str = "api-key"
    action_invoker: SlimActionInvoker | None = None
    _actions: _SlimToolActionClient = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.credentials = dict(self.credentials)
        self._actions = _SlimToolActionClient(
            config=self.config,
            plugin_id=self.plugin_id,
            action_invoker=self.action_invoker,
        )

    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool: VariablePool | None,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle:
        _ = node_id, node_execution_id
        if node_data.tool_name != self.tool_name:
            msg = (
                f"Slim tool runtime was prepared for {self.tool_name!r}, "
                f"got {node_data.tool_name!r}."
            )
            raise ToolNodeError(msg)

        parameters = self._load_tool_parameters(node_data)
        resolver = _SlimToolParameterResolver(variable_pool=variable_pool)
        form_values = resolver.resolve_form_values(
            parameters=parameters,
            tool_configurations=node_data.tool_configurations,
        )
        return ToolRuntimeHandle(
            raw=_SlimPreparedTool(
                plugin_id=self.plugin_id,
                provider=self.provider,
                provider_id=self.provider_id,
                tool_name=self.tool_name,
                credentials=self.credentials,
                credential_type=self.credential_type,
                parameters=parameters,
                form_values=form_values,
            ),
        )

    def get_runtime_parameters(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> Sequence[ToolRuntimeParameter]:
        prepared = self._prepared_tool(tool_runtime)
        return [parameter.to_runtime_parameter() for parameter in prepared.parameters]

    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]:
        _ = workflow_call_depth, provider_name
        prepared = self._prepared_tool(tool_runtime)
        data = {
            "provider": prepared.provider,
            "tool": prepared.tool_name,
            "credentials": dict(prepared.credentials),
            "credential_type": prepared.credential_type,
            "tool_parameters": _merge_invocation_parameters(
                llm_parameters=tool_parameters,
                form_values=prepared.form_values,
            ),
        }
        for payload in self._actions.invoke(
            action=SlimToolAction.INVOKE_TOOL,
            data=data,
        ):
            if not isinstance(payload, Mapping):
                msg = f"Unexpected Slim tool chunk payload: {payload!r}"
                raise ToolNodeError(msg)
            yield tool_runtime_message_from_payload(payload)

    def get_usage(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> LLMUsage:
        _ = tool_runtime
        return LLMUsage.empty_usage()

    def build_file_reference(self, *, mapping: Mapping[str, Any]) -> File:
        _ = mapping
        msg = "Slim DSL tool runtime does not support file tool messages yet."
        raise ToolNodeError(msg)

    def _load_tool_parameters(
        self,
        node_data: ToolNodeData,
    ) -> tuple[_SlimToolParameter, ...]:
        declaration = self._load_tool_declaration()
        if declaration.has_runtime_parameters:
            dynamic_parameters = self._load_dynamic_tool_parameters()
            if dynamic_parameters:
                return dynamic_parameters

        if declaration.parameters:
            return declaration.parameters

        return _parameters_from_node_data(node_data)

    def _load_tool_declaration(self) -> _SlimToolDeclaration:
        if self.action_invoker is not None:
            return _SlimToolDeclaration(has_runtime_parameters=True)

        return tool_declaration_from_extract_payload(
            self._actions.extract(),
            provider=self.provider,
            tool_name=self.tool_name,
        )

    def _load_dynamic_tool_parameters(self) -> tuple[_SlimToolParameter, ...]:
        payload = self._actions.invoke_mapping(
            action=SlimToolAction.GET_TOOL_RUNTIME_PARAMETERS,
            data={
                "provider": self.provider,
                "tool": self.tool_name,
                "credentials": dict(self.credentials),
            },
        )
        raw_parameters = payload.get("parameters")
        if raw_parameters is None:
            return ()
        if not isinstance(raw_parameters, list):
            msg = "Slim get_tool_runtime_parameters returned invalid parameters."
            raise ToolNodeError(msg)
        return _parameters_from_mappings(raw_parameters)

    @staticmethod
    def _prepared_tool(tool_runtime: ToolRuntimeHandle) -> _SlimPreparedTool:
        if isinstance(tool_runtime.raw, _SlimPreparedTool):
            return tool_runtime.raw
        msg = "Tool runtime handle was not created by SlimToolNodeRuntime."
        raise ToolNodeError(msg)


def _merge_invocation_parameters(
    *,
    llm_parameters: Mapping[str, Any],
    form_values: Mapping[str, Any],
) -> dict[str, Any]:
    merged = dict(llm_parameters)
    merged.update(form_values)
    return merged


def resolve_dsl_tool_credential(
    *,
    credentials: Sequence[DslToolCredential],
    plugin_id: str,
    provider_id: str,
    provider: str,
    tool_name: str,
) -> DslToolCredential:
    best_credential: DslToolCredential | None = None
    best_score = -1
    for credential in credentials:
        score = _tool_credential_match_score(
            credential=credential,
            plugin_id=plugin_id,
            provider_id=provider_id,
            provider=provider,
            tool_name=tool_name,
        )
        if score is not None and score > best_score:
            best_credential = credential
            best_score = score

    return best_credential or DslToolCredential()


def _tool_credential_match_score(
    *,
    credential: DslToolCredential,
    plugin_id: str,
    provider_id: str,
    provider: str,
    tool_name: str,
) -> int | None:
    score = 0
    selectors = (
        (credential.plugin_unique_identifier, plugin_id, 16),
        (credential.provider_id, provider_id, 8),
        (credential.provider, provider, 4),
        (credential.tool_name, tool_name, 2),
    )
    for actual, expected, weight in selectors:
        if not actual:
            continue
        if actual != expected:
            return None
        score += weight
    return score


def tool_declaration_from_extract_payload(
    payload: Mapping[str, Any],
    *,
    provider: str,
    tool_name: str,
) -> _SlimToolDeclaration:
    manifest = _extract_manifest(payload)
    tool_provider = _extract_tool_provider(manifest)
    provider_name = _provider_name_from_tool_provider(tool_provider, fallback=provider)
    if provider_name != provider:
        msg = f"Slim plugin provider {provider_name!r} does not match {provider!r}."
        raise ToolNodeError(msg)

    raw_tools = tool_provider.get("tools") or []
    if not isinstance(raw_tools, list):
        msg = "Slim plugin manifest has invalid tool declarations."
        raise ToolNodeError(msg)

    for raw_tool in raw_tools:
        if not isinstance(raw_tool, Mapping):
            continue
        if _tool_name(raw_tool) != tool_name:
            continue
        raw_parameters = raw_tool.get("parameters") or []
        if not isinstance(raw_parameters, list):
            msg = f"Slim tool {tool_name!r} has invalid parameters."
            raise ToolNodeError(msg)
        return _SlimToolDeclaration(
            parameters=_parameters_from_mappings(raw_parameters),
            has_runtime_parameters=bool(raw_tool.get("has_runtime_parameters")),
        )

    msg = f"Slim plugin provider {provider!r} does not declare tool {tool_name!r}."
    raise ToolNodeError(msg)


def _extract_manifest(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    data = payload.get("data")
    data_payload = data if isinstance(data, Mapping) else payload
    manifest = data_payload.get("manifest")
    if not isinstance(manifest, Mapping):
        msg = "Slim extract did not return a plugin manifest."
        raise ToolNodeError(msg)
    return manifest


def _extract_tool_provider(manifest: Mapping[str, Any]) -> Mapping[str, Any]:
    tool_provider = manifest.get("tool")
    if not isinstance(tool_provider, Mapping):
        msg = "Slim plugin manifest does not declare a tool provider."
        raise ToolNodeError(msg)
    return tool_provider


def _provider_name_from_tool_provider(
    tool_provider: Mapping[str, Any],
    *,
    fallback: str,
) -> str:
    identity = tool_provider.get("identity")
    if isinstance(identity, Mapping) and identity.get("name"):
        return str(identity["name"])
    return fallback


def _tool_name(raw_tool: Mapping[str, Any]) -> str:
    tool_identity = raw_tool.get("identity")
    if isinstance(tool_identity, Mapping) and tool_identity.get("name"):
        return str(tool_identity["name"])
    return ""


def _parameters_from_mappings(
    raw_parameters: Sequence[Any],
) -> tuple[_SlimToolParameter, ...]:
    return tuple(
        _SlimToolParameter.from_mapping(parameter)
        for parameter in raw_parameters
        if isinstance(parameter, Mapping)
    )


def _parameters_from_node_data(
    node_data: ToolNodeData,
) -> tuple[_SlimToolParameter, ...]:
    names = dict.fromkeys(
        [*node_data.tool_parameters.keys(), *node_data.tool_configurations.keys()],
    )
    return tuple(_SlimToolParameter(name=name) for name in names)


def _tool_parameter_form(value: Any) -> SlimToolParameterForm:
    try:
        return SlimToolParameterForm(value or SlimToolParameterForm.LLM)
    except (TypeError, ValueError):
        return SlimToolParameterForm.LLM


def _tool_parameter_type(value: Any) -> SlimToolParameterType:
    try:
        return SlimToolParameterType(value or SlimToolParameterType.STRING)
    except (TypeError, ValueError):
        return SlimToolParameterType.STRING


def _tool_input_type(value: Any) -> ToolInputType | None:
    try:
        return ToolInputType(value)
    except (TypeError, ValueError):
        return None


class _Missing:
    pass


_MISSING = _Missing()


def _extract_selector_value(
    *,
    parameter: _SlimToolParameter,
    raw_config: Any,
) -> Mapping[str, Any] | None:
    if parameter.type not in _OBJECT_PARAMETER_TYPES:
        return None
    if not isinstance(raw_config, Mapping):
        return None

    value = raw_config.get("value")
    if isinstance(value, Mapping) and _is_selector_value(parameter, value):
        return value
    if _is_selector_value(parameter, raw_config):
        selector_value = dict(raw_config)
        selector_value.pop("type", None)
        selector_value.pop("value", None)
        return selector_value
    return None


def _is_selector_value(
    parameter: _SlimToolParameter,
    value: Mapping[str, Any],
) -> bool:
    if parameter.type == SlimToolParameterType.MODEL_SELECTOR:
        return (
            isinstance(value.get("provider"), str)
            and isinstance(value.get("model"), str)
            and isinstance(value.get("model_type"), str)
        )
    if parameter.type == SlimToolParameterType.APP_SELECTOR:
        return isinstance(value.get("app_id"), str)
    return False


def _init_frontend_parameter(
    *,
    parameter: _SlimToolParameter,
    value: Any,
) -> Any:
    if value is not None:
        return value
    if parameter.default is not None:
        return parameter.default
    if parameter.options:
        return parameter.options[0].get("value")

    return _empty_parameter_value(parameter.type)


def _empty_parameter_value(parameter_type: SlimToolParameterType) -> Any:
    if parameter_type == SlimToolParameterType.NUMBER:
        return 0
    if parameter_type == SlimToolParameterType.BOOLEAN:
        return False
    if parameter_type in _ARRAY_PARAMETER_TYPES:
        return []
    if parameter_type in _OBJECT_PARAMETER_TYPES:
        return {}
    return ""


def _cast_tool_parameter_value(
    *,
    parameter: _SlimToolParameter,
    value: Any,
) -> Any:
    match parameter.type:
        case SlimToolParameterType.NUMBER:
            return _cast_number(value)
        case SlimToolParameterType.BOOLEAN:
            return _cast_bool(value)
        case (
            SlimToolParameterType.ARRAY
            | SlimToolParameterType.FILES
            | SlimToolParameterType.CHECKBOX
        ):
            return value if isinstance(value, list) else []
        case (
            SlimToolParameterType.OBJECT
            | SlimToolParameterType.MODEL_SELECTOR
            | SlimToolParameterType.APP_SELECTOR
        ):
            return value if isinstance(value, Mapping) else {}
        case _:
            return value
    return value


def _cast_number(value: Any) -> Any:
    if value is None or isinstance(value, int | float):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return int(number) if number.is_integer() else number


def _cast_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return bool(value)


def tool_runtime_message_from_payload(
    payload: Mapping[str, Any],
) -> ToolRuntimeMessage:
    payload = _unwrap_daemon_response(payload)
    message_type = payload.get("type") or ToolRuntimeMessage.MessageType.TEXT
    try:
        kind = ToolRuntimeMessage.MessageType(message_type)
    except ValueError as error:
        msg = (
            "Slim DSL tool runtime does not support tool message type "
            f"{message_type!r}."
        )
        raise ToolNodeError(msg) from error

    return ToolRuntimeMessage(
        type=kind,
        message=_tool_message_payload(kind=kind, payload=payload.get("message")),
        meta=_message_meta(payload.get("meta")),
    )


def _unwrap_daemon_response(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    code = payload.get("code")
    if code is None:
        return payload
    if code != 0:
        msg = str(payload.get("message") or "Slim daemon returned an error.")
        raise ToolNodeError(msg)

    data = payload.get("data")
    if isinstance(data, Mapping):
        return data
    msg = "Slim daemon response did not contain object data."
    raise ToolNodeError(msg)


def _tool_message_payload(
    *,
    kind: ToolRuntimeMessage.MessageType,
    payload: object,
) -> (
    ToolRuntimeMessage.JsonMessage
    | ToolRuntimeMessage.TextMessage
    | ToolRuntimeMessage.BlobChunkMessage
    | ToolRuntimeMessage.BlobMessage
    | ToolRuntimeMessage.LogMessage
    | ToolRuntimeMessage.FileMessage
    | ToolRuntimeMessage.VariableMessage
    | ToolRuntimeMessage.RetrieverResourceMessage
    | None
):
    adapter = _TOOL_MESSAGE_ADAPTERS.get(kind)
    if adapter is None:
        msg = f"Slim DSL tool runtime does not support tool message type {kind!r}."
        raise ToolNodeError(msg)
    return adapter(payload)


def _message_meta(payload: object) -> dict[str, Any] | None:
    if not isinstance(payload, Mapping):
        return None
    return {str(key): value for key, value in payload.items()}


def _text_message(payload: object) -> ToolRuntimeMessage.TextMessage:
    if isinstance(payload, Mapping):
        message_payload = cast(Mapping[str, Any], payload)
        return ToolRuntimeMessage.TextMessage(
            text=str(message_payload.get("text") or ""),
        )
    return ToolRuntimeMessage.TextMessage(text=str(payload or ""))


def _json_message(payload: object) -> ToolRuntimeMessage.JsonMessage:
    if isinstance(payload, list):
        return ToolRuntimeMessage.JsonMessage(json_object=payload)
    if not isinstance(payload, Mapping):
        msg = "Slim JSON tool message must be an object or array."
        raise ToolNodeError(msg)

    message_payload = cast(Mapping[str, Any], payload)
    json_object = message_payload.get("json_object", message_payload)
    if not isinstance(json_object, dict | list):
        msg = "Slim JSON tool message must contain object or array json_object."
        raise ToolNodeError(msg)
    return ToolRuntimeMessage.JsonMessage(
        json_object=json_object,
        suppress_output=bool(message_payload.get("suppress_output", False)),
    )


def _blob_message(payload: object) -> ToolRuntimeMessage.BlobMessage:
    blob = (
        cast(Mapping[str, Any], payload).get("blob")
        if isinstance(payload, Mapping)
        else payload
    )
    return ToolRuntimeMessage.BlobMessage(blob=_decode_blob(blob))


def _blob_chunk_message(payload: object) -> ToolRuntimeMessage.BlobChunkMessage:
    if not isinstance(payload, Mapping):
        msg = "Slim blob_chunk tool message must be a mapping."
        raise ToolNodeError(msg)
    message_payload = cast(Mapping[str, Any], payload)
    return ToolRuntimeMessage.BlobChunkMessage(
        id=str(message_payload.get("id") or ""),
        sequence=int(message_payload.get("sequence") or 0),
        total_length=int(message_payload.get("total_length") or 0),
        blob=_decode_blob(message_payload.get("blob")),
        end=bool(message_payload.get("end", False)),
    )


def _file_message(payload: object) -> ToolRuntimeMessage.FileMessage:
    if payload is None:
        return ToolRuntimeMessage.FileMessage()
    if not isinstance(payload, Mapping):
        msg = "Slim file tool message must be a mapping."
        raise ToolNodeError(msg)
    return ToolRuntimeMessage.FileMessage.model_validate(payload)


def _variable_message(payload: object) -> ToolRuntimeMessage.VariableMessage:
    return ToolRuntimeMessage.VariableMessage.model_validate(payload)


def _log_message(payload: object) -> ToolRuntimeMessage.LogMessage:
    return ToolRuntimeMessage.LogMessage.model_validate(payload)


def _retriever_resources_message(
    payload: object,
) -> ToolRuntimeMessage.RetrieverResourceMessage:
    return ToolRuntimeMessage.RetrieverResourceMessage.model_validate(payload)


type _ToolMessageAdapter = Callable[
    [object],
    ToolRuntimeMessage.JsonMessage
    | ToolRuntimeMessage.TextMessage
    | ToolRuntimeMessage.BlobChunkMessage
    | ToolRuntimeMessage.BlobMessage
    | ToolRuntimeMessage.LogMessage
    | ToolRuntimeMessage.FileMessage
    | ToolRuntimeMessage.VariableMessage
    | ToolRuntimeMessage.RetrieverResourceMessage
    | None,
]


_TOOL_MESSAGE_ADAPTERS: Mapping[
    ToolRuntimeMessage.MessageType,
    _ToolMessageAdapter,
] = {
    ToolRuntimeMessage.MessageType.TEXT: _text_message,
    ToolRuntimeMessage.MessageType.LINK: _text_message,
    ToolRuntimeMessage.MessageType.IMAGE: _text_message,
    ToolRuntimeMessage.MessageType.IMAGE_LINK: _text_message,
    ToolRuntimeMessage.MessageType.BINARY_LINK: _text_message,
    ToolRuntimeMessage.MessageType.JSON: _json_message,
    ToolRuntimeMessage.MessageType.BLOB: _blob_message,
    ToolRuntimeMessage.MessageType.BLOB_CHUNK: _blob_chunk_message,
    ToolRuntimeMessage.MessageType.FILE: _file_message,
    ToolRuntimeMessage.MessageType.VARIABLE: _variable_message,
    ToolRuntimeMessage.MessageType.LOG: _log_message,
    ToolRuntimeMessage.MessageType.RETRIEVER_RESOURCES: _retriever_resources_message,
}


def _decode_blob(value: object) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        try:
            return base64.b64decode(value, validate=True)
        except Exception as error:
            msg = "Slim blob payload is not valid base64."
            raise ToolNodeError(msg) from error
    msg = "Slim blob payload must be bytes or base64 text."
    raise ToolNodeError(msg)
