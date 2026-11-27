from __future__ import annotations

import importlib
import os
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, ClassVar

from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, NodeExecutionType
from graphon.file.enums import FileType
from graphon.file.models import File
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.message_entities import PromptMessage
from graphon.nodes.answer.answer_node import AnswerNode
from graphon.nodes.base.node import Node
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.http_request.config import build_http_request_config
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.nodes.http_request.exc import FileFetchError, HttpRequestNodeError
from graphon.nodes.http_request.node import (
    HttpRequestNode,
    HttpRequestNodeDependencies,
)
from graphon.nodes.if_else.if_else_node import IfElseNode
from graphon.nodes.iteration.iteration_node import IterationNode
from graphon.nodes.iteration.iteration_start_node import IterationStartNode
from graphon.nodes.list_operator.entities import ListOperatorNodeData
from graphon.nodes.list_operator.node import ListOperatorNode
from graphon.nodes.llm import LLMNode, LLMNodeData
from graphon.nodes.llm.exc import LLMNodeError
from graphon.nodes.loop.loop_end_node import LoopEndNode
from graphon.nodes.loop.loop_node import LoopNode
from graphon.nodes.loop.loop_start_node import LoopStartNode
from graphon.nodes.parameter_extractor.entities import ParameterExtractorNodeData
from graphon.nodes.parameter_extractor.parameter_extractor_node import (
    ParameterExtractorNode,
)
from graphon.nodes.question_classifier import (
    QuestionClassifierNode,
    QuestionClassifierNodeData,
    QuestionClassifierNodeDependencies,
)
from graphon.nodes.start import StartNode
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.template_transform.template_transform_node import (
    TemplateTransformNode,
)
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData
from graphon.nodes.variable_aggregator.variable_aggregator_node import (
    VariableAggregatorNode,
)
from graphon.nodes.variable_assigner.v1.node import (
    VariableAssignerNode as VariableAssignerNodeV1,
)
from graphon.nodes.variable_assigner.v1.node_data import VariableAssignerData
from graphon.nodes.variable_assigner.v2.entities import VariableAssignerNodeData
from graphon.nodes.variable_assigner.v2.node import (
    VariableAssignerNode as VariableAssignerNodeV2,
)
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError

from .code_runtime import SandboxCodeExecutor
from .entities import (
    DslCodeSettings,
    DslCredentials,
    DslDependency,
    DslModelCredential,
    DslToolCredential,
)
from .errors import DslError
from .slim import SlimClientConfig, SlimLLM
from .tool_runtime import SlimToolNodeRuntime, resolve_dsl_tool_credential

_OPENAI_CREDENTIAL_ALIASES = ("openai_api_key", "OPENAI_API_KEY", "api_key")
_OPENAI_OPTIONAL_CREDENTIAL_ALIASES = {
    "openai_api_base": (
        "openai_api_base",
        "OPENAI_API_BASE",
        "OPENAI_BASE_URL",
        "api_base",
        "base_url",
    ),
    "openai_organization": (
        "openai_organization",
        "OPENAI_ORGANIZATION",
        "organization",
    ),
    "validate_model": ("validate_model", "OPENAI_VALIDATE_MODEL"),
    "api_protocol": ("api_protocol", "OPENAI_API_PROTOCOL"),
}
_DEFAULT_SLIM_PLUGIN_FOLDER = ".slim/plugins"
_PLUGIN_PROVIDER_PARTS = 2
_SIMPLE_JINJA_VARIABLE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def _dsl_error(
    message: str,
    *,
    code: str,
    path: str | None = None,
    kind: str | None = None,
    details: Mapping[str, Any] | None = None,
) -> DslError:
    return DslError(
        message,
        code=code,
        path=path,
        kind=kind,
        details=details,
    )


class _PassthroughPromptMessageSerializer:
    def serialize(
        self,
        *,
        model_mode: LLMMode,
        prompt_messages: Sequence[PromptMessage],
    ) -> object:
        _ = model_mode
        return list(prompt_messages)


class _TextOnlyFileSaver:
    def save_binary_string(
        self,
        data: bytes,
        mime_type: str,
        file_type: FileType,
        extension_override: str | None = None,
    ) -> File:
        _ = data, mime_type, file_type, extension_override
        msg = "DSL import default LLM file saver only supports text responses."
        raise LLMNodeError(msg)

    def save_remote_url(self, url: str, file_type: FileType) -> File:
        _ = url, file_type
        msg = "DSL import default LLM file saver only supports text responses."
        raise LLMNodeError(msg)


class _UnsupportedToolFileManager:
    def create_file_by_raw(
        self,
        *,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> object:
        _ = file_binary, mimetype, filename
        msg = "DSL import default Slim tool runtime does not support tool files yet."
        raise RuntimeError(msg)

    def get_file_generator_by_tool_file_id(
        self,
        tool_file_id: str,
    ) -> tuple[None, None]:
        _ = tool_file_id
        return None, None


class _UnsupportedHttpRequestFileManager:
    def download(self, f: File, /) -> bytes:
        _ = f
        msg = "DSL import default HTTP request runtime only supports text requests."
        raise FileFetchError(msg)


class _TextOnlyHttpResponseFileManager:
    def create_file_by_raw(
        self,
        *,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ) -> object:
        _ = file_binary, mimetype, filename
        msg = "DSL import default HTTP request runtime only supports text responses."
        raise HttpRequestNodeError(msg)

    def get_file_generator_by_tool_file_id(
        self,
        tool_file_id: str,
    ) -> tuple[None, None]:
        _ = tool_file_id
        return None, None


class _UnsupportedHttpFileReferenceFactory:
    def build_from_mapping(self, *, mapping: Mapping[str, Any]) -> File:
        _ = mapping
        msg = "DSL import default HTTP request runtime only supports text responses."
        raise HttpRequestNodeError(msg)


class _DefaultJinja2TemplateRenderer(Jinja2TemplateRenderer):
    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            jinja2 = importlib.import_module("jinja2")
        except ImportError:
            return _render_simple_jinja_template(template, variables)

        try:
            environment = jinja2.Environment(
                autoescape=False,
                undefined=jinja2.StrictUndefined,
            )
            return str(environment.from_string(template).render(**dict(variables)))
        except jinja2.TemplateError as error:
            raise TemplateRenderError(str(error)) from error


def _render_simple_jinja_template(
    template: str,
    variables: Mapping[str, Any],
) -> str:
    def replace(match: re.Match[str]) -> str:
        return str(variables.get(match.group(1), ""))

    return _SIMPLE_JINJA_VARIABLE.sub(replace, template)


def _canonical_vendor(provider: str | None) -> str | None:
    if not provider:
        return None
    parts = [part for part in provider.split("/") if part]
    return parts[-1] if parts else provider


def _plugin_prefix(provider: str | None) -> str | None:
    if not provider:
        return None
    parts = [part for part in provider.split("/") if part]
    if len(parts) >= _PLUGIN_PROVIDER_PARTS:
        return "/".join(parts[:_PLUGIN_PROVIDER_PARTS])
    return None


def _find_plugin_id(
    *,
    provider: str | None,
    dependencies: Sequence[DslDependency],
) -> str | None:
    prefix = _plugin_prefix(provider)
    for dependency in dependencies:
        plugin_unique_identifier = dependency.plugin_unique_identifier
        if not plugin_unique_identifier:
            continue
        if prefix is not None and plugin_unique_identifier.startswith(f"{prefix}:"):
            return plugin_unique_identifier
        if provider and f"/{provider}:" in plugin_unique_identifier:
            return plugin_unique_identifier
    return None


def _find_tool_plugin_id(
    *,
    node_data: ToolNodeData,
    dependencies: Sequence[DslDependency],
) -> str | None:
    plugin_unique_identifier = node_data.plugin_unique_identifier
    if plugin_unique_identifier:
        for dependency in dependencies:
            if dependency.plugin_unique_identifier == plugin_unique_identifier:
                return plugin_unique_identifier

    for provider in (node_data.provider_id, node_data.provider_name):
        plugin_id = _find_plugin_id(provider=provider, dependencies=dependencies)
        if plugin_id is not None:
            return plugin_id
    return None


def _normalize_openai_credentials(values: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for alias in _OPENAI_CREDENTIAL_ALIASES:
        value = values.get(alias)
        if isinstance(value, str) and value:
            result["openai_api_key"] = value
            break
    if "openai_api_key" not in result:
        return {}

    for target, aliases in _OPENAI_OPTIONAL_CREDENTIAL_ALIASES.items():
        for alias in aliases:
            value = values.get(alias)
            if isinstance(value, str) and value:
                result[target] = value
                break
    return result


def _resolve_credentials(
    *,
    credentials: DslCredentials,
    provider: str,
    vendor: str,
    plugin_id: str | None,
) -> dict[str, Any]:
    model_credential = _resolve_model_credential(
        credentials=credentials.model_credentials,
        provider=provider,
        vendor=vendor,
        plugin_id=plugin_id,
    )
    values = dict(model_credential.values) if model_credential is not None else {}

    if vendor == "openai":
        normalized = _normalize_openai_credentials(values)
        if normalized:
            return normalized
        msg = "Missing OpenAI credential for LLM node."
        raise _dsl_error(
            msg,
            code="credential.missing_required_key",
            details={"required_keys": ["openai_api_key"], "vendor": vendor},
        )

    return values


def _resolve_model_credential(
    *,
    credentials: Sequence[DslModelCredential],
    provider: str,
    vendor: str,
    plugin_id: str | None,
) -> DslModelCredential | None:
    best_credential: DslModelCredential | None = None
    best_score = -1
    for credential in credentials:
        score = _model_credential_match_score(
            credential=credential,
            provider=provider,
            vendor=vendor,
            plugin_id=plugin_id,
        )
        if score is not None and score > best_score:
            best_credential = credential
            best_score = score
    return best_credential


def _model_credential_match_score(
    *,
    credential: DslModelCredential,
    provider: str,
    vendor: str,
    plugin_id: str | None,
) -> int | None:
    score = 0
    if credential.plugin_unique_identifier:
        if credential.plugin_unique_identifier != plugin_id:
            return None
        score += 8
    if credential.provider:
        if credential.provider != provider:
            return None
        score += 4
    if credential.vendor:
        if credential.vendor != vendor:
            return None
        score += 2
    return score


def _resolve_plugin_folder(credentials: DslCredentials) -> Path:
    if credentials.slim.plugin_folder:
        return Path(credentials.slim.plugin_folder).expanduser()

    env_folder = os.environ.get("SLIM_PLUGIN_FOLDER", "").strip()
    if env_folder:
        return Path(env_folder).expanduser()

    return Path(_DEFAULT_SLIM_PLUGIN_FOLDER)


def _code_limits(settings: DslCodeSettings) -> CodeNodeLimits:
    return CodeNodeLimits(
        max_string_length=settings.max_string_length,
        max_number=settings.max_number,
        min_number=settings.min_number,
        max_precision=settings.max_precision,
        max_depth=settings.max_depth,
        max_number_array_length=settings.max_number_array_length,
        max_string_array_length=settings.max_string_array_length,
        max_object_array_length=settings.max_object_array_length,
    )


def _node_data_payload(data: BaseNodeData | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(data, BaseNodeData):
        return data.model_dump(mode="python")
    return dict(data)


@dataclass(slots=True)
class _NodeBuildRequest:
    node_id: str
    data: BaseNodeData | Mapping[str, Any]
    data_payload: dict[str, Any]
    node_type: Any


type _NodeBuilder = Callable[[Any, _NodeBuildRequest], Node]


@dataclass(slots=True)
class SlimDslNodeFactory:
    graph_config: Mapping[str, Any]
    init_params: InitParams
    runtime_state: RuntimeState
    credentials: DslCredentials
    dependencies: list[DslDependency]
    slim_client_config: SlimClientConfig = field(init=False)

    def __post_init__(self) -> None:
        slim = self.credentials.slim
        self.slim_client_config = SlimClientConfig(
            folder=_resolve_plugin_folder(self.credentials),
            mode=slim.mode,
            daemon_addr=slim.daemon_addr,
            daemon_key=slim.daemon_key,
            python_path=slim.python_path,
            uv_path=slim.uv_path,
            python_env_init_timeout=slim.python_env_init_timeout,
            max_execution_timeout=slim.max_execution_timeout,
            pip_mirror_url=slim.pip_mirror_url,
            pip_extra_args=slim.pip_extra_args,
            marketplace_url=slim.marketplace_url,
            ignore_uv_lock=slim.ignore_uv_lock,
        )

    def with_runtime_state(
        self,
        runtime_state: RuntimeState,
    ) -> SlimDslNodeFactory:
        """Return a copied factory bound to one execution frame's state.

        Args:
            runtime_state: State that every node created by the copy must use.

        Returns:
            An independent factory preserving the current graph and dependencies.

        """
        return replace(self, runtime_state=runtime_state)

    def with_graph_config(
        self,
        graph_config: Mapping[str, Any],
    ) -> SlimDslNodeFactory:
        """Return an independent factory bound to one materialized graph scope.

        ``Node.__init__`` invokes ``post_init()`` immediately, so both legacy
        ``factory.graph_config`` access and the canonical
        ``node.init_params.graph_config`` path must already point at the
        scoped config before ``create_node()`` runs. Copying the Pydantic model
        also keeps parent and sibling factories isolated.

        Args:
            graph_config: Container-subtree configuration visible to new nodes.

        Returns:
            A copied factory carrying copied, scope-correct initialization params.

        """
        return replace(
            self,
            graph_config=graph_config,
            init_params=self.init_params.model_copy(
                update={"graph_config": graph_config},
            ),
        )

    def validate_node(
        self,
        node_config: NodeConfigDict,
    ) -> NodeExecutionType:
        """Validate a DSL node without constructing runtime collaborators.

        This method follows the same type and legacy Variable Assigner version
        dispatch as :meth:`create_node`, validates the concrete Pydantic schema,
        and resolves static plugin and credential settings. It deliberately avoids
        builders because builders construct Nodes, invoke ``post_init()``, and may
        initialize Slim or sandbox runtimes. Graph can therefore validate nested
        nodes before any executable node is created.

        Args:
            node_config: Base-validated node configuration from the graph loader.

        Returns:
            The execution type of the concrete node implementation selected by
            the same type and version dispatch used for construction.

        Raises:
            DslError: If the node type, payload, plugin dependency, or required
                credentials cannot be resolved.

        """
        request = self._node_request(node_config)
        model_node_labels = {
            BuiltinNodeTypes.LLM: "LLM",
            BuiltinNodeTypes.QUESTION_CLASSIFIER: "Question classifier",
            BuiltinNodeTypes.PARAMETER_EXTRACTOR: "Parameter extractor",
        }
        if node_type_label := model_node_labels.get(request.node_type):
            model = request.data_payload.get("model")
            provider = model.get("provider") if isinstance(model, Mapping) else None
            if not provider:
                msg = f"{node_type_label} node is missing model provider."
                raise DslError(
                    msg,
                    code="node.llm_missing_provider",
                    path=f"/nodes/{request.node_id}/data/model/provider",
                    details={"node_id": request.node_id},
                )
        if request.node_type == BuiltinNodeTypes.VARIABLE_ASSIGNER:
            data = self._validate_variable_assigner_data(request)
            node_cls = (
                VariableAssignerNodeV2
                if isinstance(data, VariableAssignerNodeData)
                else VariableAssignerNodeV1
            )
            return node_cls.execution_type

        if request.node_type not in self.NODE_BUILDERS:
            raise self._unsupported_node_error(request)
        node_mapping = Node.get_node_type_classes_mapping()
        node_classes = node_mapping.get(request.node_type)
        node_version = str(request.data_payload.get("version") or "1")
        node_cls = node_classes.get(node_version) if node_classes is not None else None
        if node_cls is None:
            raise self._unsupported_node_error(request)
        node_cls.validate_node_data(request.data)
        if request.node_type in model_node_labels:
            self._resolve_slim_llm_settings(
                node_id=request.node_id,
                data=request.data_payload,
                node_type_label=model_node_labels[request.node_type],
            )
        elif request.node_type == BuiltinNodeTypes.TOOL:
            self._resolve_tool_runtime_settings(
                ToolNodeData.model_validate(request.data_payload),
            )
        return node_cls.execution_type

    def create_node(self, node_config: NodeConfigDict) -> Node:
        request = self._node_request(node_config)
        builder = self.NODE_BUILDERS.get(request.node_type)
        if builder is None:
            raise self._unsupported_node_error(request)
        return builder(self, request)

    def _node_request(
        self,
        node_config: NodeConfigDict,
    ) -> _NodeBuildRequest:
        node_id = str(node_config["id"])
        data = node_config["data"]
        data_payload = _node_data_payload(data)
        return _NodeBuildRequest(
            node_id=node_id,
            data=data,
            data_payload=data_payload,
            node_type=data_payload["type"],
        )

    def _create_start_node(self, request: _NodeBuildRequest) -> StartNode:
        return StartNode(
            node_id=request.node_id,
            data=StartNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_end_node(self, request: _NodeBuildRequest) -> EndNode:
        return EndNode(
            node_id=request.node_id,
            data=EndNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_answer_node(self, request: _NodeBuildRequest) -> AnswerNode:
        return AnswerNode(
            node_id=request.node_id,
            data=AnswerNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_if_else_node(self, request: _NodeBuildRequest) -> IfElseNode:
        return IfElseNode(
            node_id=request.node_id,
            data=IfElseNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_iteration_node(self, request: _NodeBuildRequest) -> IterationNode:
        return IterationNode(
            node_id=request.node_id,
            data=IterationNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_iteration_start_node(
        self,
        request: _NodeBuildRequest,
    ) -> IterationStartNode:
        return IterationStartNode(
            node_id=request.node_id,
            data=IterationStartNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_loop_node(self, request: _NodeBuildRequest) -> LoopNode:
        return LoopNode(
            node_id=request.node_id,
            data=LoopNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_loop_start_node(self, request: _NodeBuildRequest) -> LoopStartNode:
        return LoopStartNode(
            node_id=request.node_id,
            data=LoopStartNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_loop_end_node(self, request: _NodeBuildRequest) -> LoopEndNode:
        return LoopEndNode(
            node_id=request.node_id,
            data=LoopEndNode.validate_node_data(request.data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_template_transform_node(
        self,
        request: _NodeBuildRequest,
    ) -> TemplateTransformNode:
        return TemplateTransformNode(
            node_id=request.node_id,
            data=TemplateTransformNodeData.model_validate(request.data_payload),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            jinja2_template_renderer=_DefaultJinja2TemplateRenderer(),
        )

    def _create_code_node(self, request: _NodeBuildRequest) -> CodeNode:
        return CodeNode(
            node_id=request.node_id,
            data=CodeNodeData.model_validate(request.data_payload),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            code_executor=SandboxCodeExecutor(self.credentials.code),
            code_limits=_code_limits(self.credentials.code),
        )

    def _create_tool_node(self, request: _NodeBuildRequest) -> ToolNode:
        tool_data = ToolNodeData.model_validate(request.data_payload)
        try:
            runtime = self._create_tool_runtime(tool_data)
        except DslError:
            raise
        except Exception as error:
            raise _dsl_error(
                str(error),
                code="runtime.slim_unavailable",
                path=f"/nodes/{request.node_id}/data",
                details={
                    "node_id": request.node_id,
                    "node_type": BuiltinNodeTypes.TOOL,
                },
            ) from error
        return ToolNode(
            node_id=request.node_id,
            data=tool_data,
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            tool_file_manager=_UnsupportedToolFileManager(),
            runtime=runtime,
        )

    def _create_http_request_node(
        self,
        request: _NodeBuildRequest,
    ) -> HttpRequestNode:
        return HttpRequestNode(
            node_id=request.node_id,
            data=HttpRequestNodeData.model_validate(request.data_payload),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            http_request_config=build_http_request_config(),
            dependencies=HttpRequestNodeDependencies(
                tool_file_manager_factory=_TextOnlyHttpResponseFileManager,
                file_manager=_UnsupportedHttpRequestFileManager(),
                file_reference_factory=_UnsupportedHttpFileReferenceFactory(),
            ),
        )

    def _create_variable_aggregator_node(
        self,
        request: _NodeBuildRequest,
    ) -> VariableAggregatorNode:
        return VariableAggregatorNode(
            node_id=request.node_id,
            data=VariableAggregatorNodeData.model_validate(request.data_payload),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_list_operator_node(
        self,
        request: _NodeBuildRequest,
    ) -> ListOperatorNode:
        return ListOperatorNode(
            node_id=request.node_id,
            data=ListOperatorNodeData.model_validate(request.data_payload),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _unsupported_node_error(self, request: _NodeBuildRequest) -> DslError:
        msg = f"Unsupported DSL node type: {request.node_type}"
        return _dsl_error(
            msg,
            code="node.unsupported_type",
            path=f"/nodes/{request.node_id}",
            details={"node_id": request.node_id, "node_type": request.node_type},
        )

    def _validate_variable_assigner_data(
        self,
        request: _NodeBuildRequest,
    ) -> VariableAssignerData | VariableAssignerNodeData:
        """Resolve and validate one legacy or current Variable Assigner payload.

        Variable Assigner versions use different payload shapes and older DSLs
        are not always explicitly versioned. Keeping shape detection and concrete
        Pydantic validation here gives preflight validation and node construction
        exactly one dispatch rule without creating a Node or runtime dependency.

        Args:
            request: Normalized node ID and data prepared by this factory.

        Returns:
            Concrete version 1 or version 2 node data ready for construction.

        Raises:
            DslError: If the payload matches neither supported version.

        """
        data = request.data_payload
        version = str(data.get("version") or "")
        if "items" in data or version == VariableAssignerNodeV2.version():
            return VariableAssignerNodeData.model_validate(data)
        if {
            "assigned_variable_selector",
            "write_mode",
            "input_variable_selector",
        }.issubset(data):
            return VariableAssignerData.model_validate(data)

        msg = "Variable assigner DSL node data is not recognized."
        raise DslError(
            msg,
            code="node.assigner_invalid_payload",
            path=f"/nodes/{request.node_id}/data",
            details={"node_id": request.node_id},
        )

    def _create_variable_assigner_node(
        self,
        request: _NodeBuildRequest,
    ) -> VariableAssignerNodeV1 | VariableAssignerNodeV2:
        data = self._validate_variable_assigner_data(request)
        if isinstance(data, VariableAssignerNodeData):
            return VariableAssignerNodeV2(
                node_id=request.node_id,
                data=data,
                init_params=self.init_params,
                runtime_state=self.runtime_state,
            )
        return VariableAssignerNodeV1(
            node_id=request.node_id,
            data=data,
            init_params=self.init_params,
            runtime_state=self.runtime_state,
        )

    def _create_question_classifier_node(
        self,
        request: _NodeBuildRequest,
    ) -> QuestionClassifierNode:
        normalized_data, model_instance = self._create_slim_llm_runtime(
            node_id=request.node_id,
            data=request.data_payload,
            node_type_label="Question classifier",
        )
        return QuestionClassifierNode(
            node_id=request.node_id,
            data=QuestionClassifierNodeData.model_validate(normalized_data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            dependencies=QuestionClassifierNodeDependencies(
                model_instance=model_instance,
                template_renderer=_DefaultJinja2TemplateRenderer(),
                llm_file_saver=_TextOnlyFileSaver(),
                prompt_message_serializer=_PassthroughPromptMessageSerializer(),
            ),
        )

    def _create_parameter_extractor_node(
        self,
        request: _NodeBuildRequest,
    ) -> ParameterExtractorNode:
        normalized_data, model_instance = self._create_slim_llm_runtime(
            node_id=request.node_id,
            data=request.data_payload,
            node_type_label="Parameter extractor",
        )
        return ParameterExtractorNode(
            node_id=request.node_id,
            data=ParameterExtractorNodeData.model_validate(normalized_data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            model_instance=model_instance,
            prompt_message_serializer=_PassthroughPromptMessageSerializer(),
        )

    def _create_llm_node(self, request: _NodeBuildRequest) -> LLMNode:
        normalized_data, model_instance = self._create_slim_llm_runtime(
            node_id=request.node_id,
            data=request.data_payload,
            node_type_label="LLM",
        )
        return LLMNode(
            node_id=request.node_id,
            data=LLMNodeData.model_validate(normalized_data),
            init_params=self.init_params,
            runtime_state=self.runtime_state,
            model_instance=model_instance,
            llm_file_saver=_TextOnlyFileSaver(),
            prompt_message_serializer=_PassthroughPromptMessageSerializer(),
            default_query_selector=("sys", "query"),
        )

    def _create_slim_llm_runtime(
        self,
        *,
        node_id: str,
        data: Mapping[str, Any],
        node_type_label: str,
    ) -> tuple[dict[str, Any], SlimLLM]:
        normalized_data, vendor, plugin_id, credentials = (
            self._resolve_slim_llm_settings(
                node_id=node_id,
                data=data,
                node_type_label=node_type_label,
            )
        )
        model = normalized_data["model"]
        try:
            model_instance = SlimLLM(
                config=self.slim_client_config,
                plugin_id=plugin_id,
                provider=vendor,
                model_name=str(model.get("name") or ""),
                credentials=credentials,
                parameters=model.get("completion_params") or {},
            )
        except Exception as error:
            raise _dsl_error(
                str(error),
                code="runtime.slim_unavailable",
                path=f"/nodes/{node_id}/data/model",
                details={"node_id": node_id, "vendor": vendor},
            ) from error
        return normalized_data, model_instance

    def _resolve_slim_llm_settings(
        self,
        *,
        node_id: str,
        data: Mapping[str, Any],
        node_type_label: str,
    ) -> tuple[dict[str, Any], str, str, dict[str, Any]]:
        """Resolve model identity and credentials without creating a runtime.

        Both graph preflight and node construction use this path so descendant
        nodes fail on missing providers, plugin dependencies, or required model
        credentials before any root node is constructed. The returned values are
        plain configuration data; this method does not create a ``SlimClient``,
        initialize a Node, invoke ``post_init()``, or mutate runtime state.

        Args:
            node_id: Persisted node ID used in actionable DSL error paths.
            data: Concrete-schema-compatible model node payload.
            node_type_label: Human-readable node kind for error messages.

        Returns:
            Normalized node data, provider vendor, resolved plugin ID, and the
            credential values to pass to the eventual Slim runtime.

        Raises:
            DslError: If provider, dependency, or required credentials cannot be
                resolved from the imported DSL and supplied credentials.

        """
        normalized_data = dict(data)
        model = dict(normalized_data.get("model") or {})
        raw_provider = str(model.get("provider") or "")
        vendor = _canonical_vendor(raw_provider)
        if not vendor:
            msg = f"{node_type_label} node is missing model provider."
            raise DslError(
                msg,
                code="node.llm_missing_provider",
                path=f"/nodes/{node_id}/data/model/provider",
                details={"node_id": node_id},
            )
        model["provider"] = vendor
        normalized_data["model"] = model

        plugin_id = _find_plugin_id(
            provider=raw_provider,
            dependencies=self.dependencies,
        )
        if plugin_id is None:
            msg = f"{node_type_label} node dependency could not be resolved."
            raise DslError(
                msg,
                code="dependency.missing_plugin",
                path=f"/nodes/{node_id}/data/model/provider",
                details={"node_id": node_id, "provider": raw_provider},
            )

        credentials = _resolve_credentials(
            credentials=self.credentials,
            provider=raw_provider,
            vendor=vendor,
            plugin_id=plugin_id,
        )
        return normalized_data, vendor, plugin_id, credentials

    def _create_tool_runtime(self, node_data: ToolNodeData) -> SlimToolNodeRuntime:
        plugin_id, provider, tool_credential = self._resolve_tool_runtime_settings(
            node_data,
        )
        return SlimToolNodeRuntime(
            config=self.slim_client_config,
            plugin_id=plugin_id,
            provider=provider,
            provider_id=node_data.provider_id,
            tool_name=node_data.tool_name,
            credentials=tool_credential.values,
            credential_type=tool_credential.credential_type,
        )

    def _resolve_tool_runtime_settings(
        self,
        node_data: ToolNodeData,
    ) -> tuple[str, str, DslToolCredential]:
        """Resolve a tool plugin and credential without creating its runtime.

        This pure resolver is shared by descendant preflight and direct-node
        construction. It checks the imported dependency list and applies the
        same credential selectors used at runtime, while deliberately avoiding
        ``SlimToolNodeRuntime`` and its client initialization.

        Args:
            node_data: Concrete, Pydantic-validated tool configuration.

        Returns:
            Resolved plugin ID, canonical provider name, and selected credential.

        Raises:
            DslError: If the tool's plugin dependency or provider is missing.

        """
        plugin_dependencies = [
            dependency
            for dependency in self.dependencies
            if dependency.plugin_unique_identifier
        ]
        plugin_id = _find_tool_plugin_id(
            node_data=node_data,
            dependencies=plugin_dependencies,
        )
        if plugin_id is None:
            msg = "Tool node dependency could not be resolved."
            raise DslError(
                msg,
                code="dependency.missing_plugin",
                details={"node_type": BuiltinNodeTypes.TOOL},
            )
        provider = _canonical_vendor(node_data.provider_id) or _canonical_vendor(
            node_data.provider_name,
        )
        if provider is None:
            msg = "Tool node is missing provider."
            raise DslError(
                msg,
                code="node.tool_missing_provider",
                details={"node_type": BuiltinNodeTypes.TOOL},
            )
        tool_credential = resolve_dsl_tool_credential(
            credentials=self.credentials.tool_credentials,
            plugin_id=plugin_id,
            provider_id=node_data.provider_id,
            provider=provider,
            tool_name=node_data.tool_name,
        )
        return plugin_id, provider, tool_credential

    NODE_BUILDERS: ClassVar[Mapping[Any, _NodeBuilder]] = {
        BuiltinNodeTypes.START: _create_start_node,
        BuiltinNodeTypes.END: _create_end_node,
        BuiltinNodeTypes.ANSWER: _create_answer_node,
        BuiltinNodeTypes.IF_ELSE: _create_if_else_node,
        BuiltinNodeTypes.ITERATION: _create_iteration_node,
        BuiltinNodeTypes.ITERATION_START: _create_iteration_start_node,
        BuiltinNodeTypes.LOOP: _create_loop_node,
        BuiltinNodeTypes.LOOP_START: _create_loop_start_node,
        BuiltinNodeTypes.LOOP_END: _create_loop_end_node,
        BuiltinNodeTypes.TEMPLATE_TRANSFORM: _create_template_transform_node,
        BuiltinNodeTypes.CODE: _create_code_node,
        BuiltinNodeTypes.LLM: _create_llm_node,
        BuiltinNodeTypes.TOOL: _create_tool_node,
        BuiltinNodeTypes.HTTP_REQUEST: _create_http_request_node,
        BuiltinNodeTypes.VARIABLE_AGGREGATOR: _create_variable_aggregator_node,
        BuiltinNodeTypes.VARIABLE_ASSIGNER: _create_variable_assigner_node,
        BuiltinNodeTypes.LIST_OPERATOR: _create_list_operator_node,
        BuiltinNodeTypes.QUESTION_CLASSIFIER: _create_question_classifier_node,
        BuiltinNodeTypes.PARAMETER_EXTRACTOR: _create_parameter_extractor_node,
    }


SUPPORTED_DEFAULT_FACTORY_NODE_TYPES = frozenset(SlimDslNodeFactory.NODE_BUILDERS)
