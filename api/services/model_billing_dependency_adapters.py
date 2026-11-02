"""Typed configuration-owner adapter for saved model dependency inventory.

This is deliberately not a recursive search for dictionaries named `model`.
Only selectors consumed by the named runtime owners are decoded. Incomplete or
dynamic model-bearing selectors are explicit problems, never guessed models.
"""

import hashlib
import json
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Protocol, cast

from pydantic import ValidationError

from core.agent.plugin_entities import AgentStrategyParameter
from core.app.app_config.entities import ModelConfigEntity
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.impl.tool import PluginToolManager
from core.rag.entities.retrieval_settings import RerankingModelConfig, WeightedScoreConfig
from core.tools.entities.tool_entities import ToolParameter
from core.workflow.nodes.agent.entities import AgentNodeData
from graphon.nodes.llm.entities import ModelConfig
from graphon.nodes.tool.entities import ToolNodeData
from models.agent_config_entities import AgentSoulConfig
from models.provider_ids import ModelProviderID
from services.model_billing_dependency_inventory import (
    AgentModelSelectors,
    ClassicModelSelectors,
    DatasetModelSelectors,
    DefaultModelSelector,
    ExtractedModelDependencies,
    ModelDependencyDocument,
    ModelDependencyProblem,
    ReferenceKind,
    SavedModelReference,
    WorkflowModelSelectors,
)


@dataclass(frozen=True, slots=True)
class StrategyModelSelectors:
    selector_names: tuple[str, ...]
    permits_model_callbacks: bool
    tool_selector_names: tuple[str, ...] = ()


class AgentStrategySelectorQuery(Protocol):
    def model_selectors(self, tenant_id: str, provider: str, strategy: str) -> StrategyModelSelectors: ...

    def tool_model_selectors(self, tenant_id: str, provider: str, tool: str | None) -> StrategyModelSelectors: ...


class PluginAgentStrategySelectorQuery:
    def model_selectors(self, tenant_id: str, provider: str, strategy: str) -> StrategyModelSelectors:
        declaration = PluginAgentClient().fetch_agent_strategy_provider(tenant_id, provider)
        selected = next((item for item in declaration.declaration.strategies if item.identity.name == strategy), None)
        if selected is None:
            raise ValueError("agent_strategy_missing")
        manifest = PluginInstaller().fetch_plugin_manifest(tenant_id, declaration.plugin_unique_identifier)
        permission = manifest.resource.permission
        return StrategyModelSelectors(
            tuple(
                item.name
                for item in selected.parameters
                if item.type == AgentStrategyParameter.AgentStrategyParameterType.MODEL_SELECTOR
            ),
            bool(permission and permission.model and permission.model.enabled),
            tuple(
                item.name
                for item in selected.parameters
                if item.type == AgentStrategyParameter.AgentStrategyParameterType.TOOLS_SELECTOR
            ),
        )

    def tool_model_selectors(self, tenant_id: str, provider: str, tool: str | None) -> StrategyModelSelectors:
        declaration = PluginToolManager().fetch_tool_provider(tenant_id, provider)
        selected = [item for item in declaration.declaration.tools if tool is None or item.identity.name == tool]
        if not selected:
            raise ValueError("plugin_tool_missing")
        manifest = PluginInstaller().fetch_plugin_manifest(tenant_id, declaration.plugin_unique_identifier)
        permission = manifest.resource.permission
        return StrategyModelSelectors(
            tuple(
                sorted(
                    {
                        parameter.name
                        for item in selected
                        for parameter in item.parameters
                        if parameter.type == ToolParameter.ToolParameterType.MODEL_SELECTOR
                    }
                )
            ),
            bool(permission and permission.model and permission.model.enabled),
        )


def _digest(value: object) -> str:
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        ).hexdigest()
    )


def _object(value: object) -> dict[str, object]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ValueError("model_selector_not_object")
    return cast(dict[str, object], value)


class TypedModelDependencyExtractor:
    def __init__(self, *, strategies: AgentStrategySelectorQuery) -> None:
        self._strategies = strategies

    def extract(self, tenant_id: str, documents: Sequence[ModelDependencyDocument]) -> ExtractedModelDependencies:
        references: list[SavedModelReference] = []
        problems: list[ModelDependencyProblem] = []
        for document in documents:
            writer = _Selectors(document, references, problems)
            payload = document.payload
            try:
                if isinstance(payload, ClassicModelSelectors):
                    self._classic(tenant_id, writer, payload)
                elif isinstance(payload, WorkflowModelSelectors):
                    self._workflow(tenant_id, writer, payload)
                elif isinstance(payload, AgentModelSelectors):
                    self._agent(tenant_id, writer, payload)
                elif isinstance(payload, DatasetModelSelectors):
                    if not payload.external:
                        if payload.indexing_technique == "high_quality":
                            writer.fixed(
                                "embedding",
                                payload.embedding_provider,
                                payload.embedding_model,
                                "text-embedding",
                                {"indexing_technique": payload.indexing_technique},
                            )
                        self._retrieval(writer, "retrieval", _object(payload.retrieval))
                        self._summary(writer, "summary", payload.summary)
                        if payload.has_qa_documents:
                            writer.default("qa_generation", "llm")
                elif isinstance(payload, DefaultModelSelector):
                    writer.fixed("default", payload.provider, payload.model, payload.model_type, {})
                else:
                    writer.problem("document", "unknown_dependency_document", {})
            except (ValueError, KeyError, TypeError, ValidationError):
                # No exception text/configuration is emitted: schemas may carry
                # prompts or model settings. Partial earlier refs stay visible.
                owned_payload = (
                    asdict(payload)
                    if isinstance(
                        payload,
                        (
                            ClassicModelSelectors,
                            WorkflowModelSelectors,
                            AgentModelSelectors,
                            DatasetModelSelectors,
                            DefaultModelSelector,
                        ),
                    )
                    else {"type": type(payload).__name__}
                )
                writer.problem("document", "invalid_saved_model_selectors", owned_payload)
        return ExtractedModelDependencies(tuple(references), tuple(problems))

    def _classic(self, tenant_id: str, writer: "_Selectors", payload: ClassicModelSelectors) -> None:
        config: dict[str, object] = {
            "model": _object(payload.model) if payload.model else None,
            "dataset_configs": _object(payload.dataset) if payload.dataset else {},
            "agent_mode": _object(payload.agent) if payload.agent else {},
            "suggested_questions_after_answer": _object(payload.suggested_questions)
            if payload.suggested_questions
            else {},
            "speech_to_text": _object(payload.speech_to_text) if payload.speech_to_text else {},
            "text_to_speech": _object(payload.text_to_speech) if payload.text_to_speech else {},
        }
        if payload.override:
            override = _object(payload.override)
            # This is the actual Conversation owner format, not a recursive
            # merge. Old `configs`-only overrides retain model_provider/model_id.
            if "model" in override:
                config = override
        if config.get("model"):
            writer.llm("model", config["model"])
        self._features(writer, config, "features")
        datasets = _object(config.get("dataset_configs") or {})
        enabled = False
        collection = _object(datasets.get("datasets") or {}).get("datasets", [])
        if isinstance(collection, list):
            enabled = any(
                isinstance(item, dict)
                and isinstance(item.get("dataset"), dict)
                and item["dataset"].get("enabled") is True
                for item in collection
            )
        agent = _object(config.get("agent_mode") or {})
        if agent.get("enabled") is True and isinstance(agent.get("tools"), list):
            enabled = enabled or any(
                isinstance(item, dict)
                and isinstance(item.get("dataset"), dict)
                and item["dataset"].get("enabled") is True
                for item in cast(list[object], agent["tools"])
            )
            for index, value in enumerate(cast(list[object], agent["tools"])):
                tool = _object(value)
                if len(tool) >= 4 and tool.get("enabled") is True:
                    self._plugin_tool(
                        tenant_id,
                        writer,
                        "agent_mode.tools." + str(index),
                        tool.get("provider_type"),
                        tool.get("provider_id"),
                        tool.get("tool_name"),
                        _object(tool.get("tool_parameters") or {}),
                    )
        if enabled:
            # Classic single-retrieval uses the App's primary LLM; multiple
            # retrieval owns rerank/weighted embedding selectors.
            if datasets.get("retrieval_model", "single") != "single":
                self._retrieval(writer, "dataset_configs", datasets, enabled_key="reranking_enabled")
            if datasets.get("metadata_filtering_mode") == "automatic":
                writer.llm("dataset_configs.metadata_model_config", datasets.get("metadata_model_config"))
        if payload.annotation_binding_id is not None:
            writer.fixed(
                "annotation.embedding",
                payload.annotation_provider,
                payload.annotation_model,
                "text-embedding",
                {"collection_binding_id": payload.annotation_binding_id},
            )

    def _features(self, writer: "_Selectors", config: dict[str, object], path: str) -> None:
        for key, kind in (("speech_to_text", "speech2text"), ("text_to_speech", "tts")):
            feature = config.get(key)
            if isinstance(feature, dict) and feature.get("enabled") is True:
                writer.default(path + "." + key, kind)
        suggested = config.get("suggested_questions_after_answer")
        if isinstance(suggested, dict) and suggested.get("enabled") is True:
            if suggested.get("model"):
                writer.llm(path + ".suggested_questions.model", suggested["model"])
            # Generator uses the tenant default for history and as fallback.
            writer.default(path + ".suggested_questions.default", "llm")

    def _retrieval(
        self, writer: "_Selectors", path: str, config: dict[str, object], *, enabled_key: str = "reranking_enable"
    ) -> None:
        if config.get(enabled_key, True) is not True:
            return
        mode = config.get("reranking_mode", "reranking_model")
        if mode == "reranking_model" and config.get("reranking_model"):
            model = RerankingModelConfig.model_validate(config["reranking_model"])
            writer.fixed(
                path + ".reranking_model", model.provider, model.model, "rerank", model.model_dump(mode="json")
            )
        elif mode == "weighted_score" and config.get("weights"):
            weights = WeightedScoreConfig.model_validate(config["weights"])
            vector = weights.vector_setting
            if vector.vector_weight > 0:
                writer.fixed(
                    path + ".weights.vector",
                    vector.embedding_provider_name,
                    vector.embedding_model_name,
                    "text-embedding",
                    vector.model_dump(mode="json"),
                )

    def _workflow(self, tenant_id: str, writer: "_Selectors", payload: WorkflowModelSelectors) -> None:
        graph = _object(payload.graph)
        nodes = graph.get("nodes", [])
        if not isinstance(nodes, list):
            raise ValueError("invalid_nodes")
        for index, raw in enumerate(nodes):
            node = _object(raw)
            data = _object(node.get("data"))
            path = "nodes." + str(node.get("id", index))
            kind = data.get("type")
            if kind in {"llm", "question-classifier", "parameter-extractor"}:
                # Validate only the model-bearing owned schema. Draft prompts
                # and unrelated node fields need not be complete to inventory.
                writer.graph_llm(path + ".model", data.get("model"))
            elif kind == "knowledge-retrieval":
                if data.get("retrieval_mode") == "single":
                    single = _object(data.get("single_retrieval_config"))
                    writer.llm(path + ".single.model", single.get("model"))
                elif data.get("retrieval_mode") == "multiple":
                    self._retrieval(writer, path + ".multiple", _object(data.get("multiple_retrieval_config") or {}))
                if data.get("metadata_filtering_mode") == "automatic":
                    writer.llm(path + ".metadata_model_config", data.get("metadata_model_config"))
            elif kind == "agent":
                agent = AgentNodeData.model_validate(data)
                selectors = self._strategies.model_selectors(
                    tenant_id, agent.agent_strategy_provider_name, agent.agent_strategy_name
                )
                if not selectors.selector_names and selectors.permits_model_callbacks:
                    writer.dynamic(path + ".strategy.model_callback", {})
                for name in selectors.selector_names:
                    parameter = agent.agent_parameters.get(name)
                    if parameter is None or parameter.type != "constant":
                        writer.dynamic(
                            path + ".agent_parameters." + name, parameter.model_dump(mode="json") if parameter else {}
                        )
                        continue
                    value = _object(parameter.value)
                    writer.fixed(
                        path + ".agent_parameters." + name,
                        value.get("provider"),
                        value.get("model"),
                        value.get("model_type"),
                        value,
                    )
                for name in selectors.tool_selector_names:
                    parameter = agent.agent_parameters.get(name)
                    if parameter is None or parameter.type != "constant" or not isinstance(parameter.value, list):
                        writer.dynamic(path + ".agent_tools." + name, {})
                        continue
                    for index, raw_tool in enumerate(parameter.value):
                        tool = _object(raw_tool)
                        if tool.get("enabled") is not True:
                            continue
                        # Agent strategy input resolves manual constant
                        # parameters/settings; auto/variable tool model inputs
                        # remain unknown, never a guessed workspace default.
                        values = {
                            key: _object(value).get("value")
                            for key, value in _object(tool.get("settings") or {}).items()
                        }
                        for key, raw_parameter in _object(tool.get("parameters") or {}).items():
                            binding = _object(raw_parameter)
                            configured = _object(binding.get("value") or {})
                            if binding.get("auto", 1) == 0 and configured.get("type") == "constant":
                                values[key] = configured.get("value")
                        self._plugin_tool(
                            tenant_id,
                            writer,
                            path + ".agent_tools." + name + "." + str(index),
                            tool.get("type", "builtin"),
                            tool.get("provider_name"),
                            tool.get("tool_name"),
                            values,
                        )
            elif kind == "tool":
                tool_node = ToolNodeData.model_validate(data)
                values = dict(tool_node.tool_configurations)
                values.update(
                    {
                        name: parameter.value
                        for name, parameter in tool_node.tool_parameters.items()
                        if parameter.type == "constant"
                    }
                )
                self._plugin_tool(
                    tenant_id,
                    writer,
                    path + ".tool",
                    tool_node.provider_type.value,
                    tool_node.provider_id,
                    tool_node.tool_name,
                    values,
                )
            elif kind == "knowledge-index":
                self._summary(writer, path + ".summary", data.get("summary_index_setting"))
        if payload.features:
            self._features(writer, _object(payload.features), "features")

    def _agent(self, tenant_id: str, writer: "_Selectors", payload: AgentModelSelectors) -> None:
        agent = AgentSoulConfig.model_validate(payload.configuration)
        if agent.model is not None:
            # credential_ref is metadata only here: AgentLLMInnerService.prepare
            # resolves provider selection and does NOT consume that reference.
            writer.fixed(
                "model",
                agent.model.model_provider,
                agent.model.model,
                "llm",
                agent.model.model_settings.model_dump(mode="json"),
            )
        for item in agent.knowledge.sets:
            path = "knowledge.sets." + item.id
            retrieval = item.retrieval
            if retrieval.mode == "single" and retrieval.model is not None:
                writer.llm(path + ".retrieval.model", retrieval.model.model_dump(mode="json"))
            elif retrieval.mode == "multiple":
                self._retrieval(writer, path + ".retrieval", retrieval.model_dump(mode="json"))
            metadata = item.metadata_filtering
            if metadata.mode == "automatic":
                writer.llm(
                    path + ".metadata.model",
                    metadata.metadata_model_config.model_dump(mode="json") if metadata.metadata_model_config else None,
                )
        self._features(writer, agent.app_features.model_dump(mode="json"), "app_features")
        for index, tool in enumerate(agent.tools.dify_tools):
            if tool.enabled:
                provider = tool.provider_id or f"{tool.plugin_id}/{tool.provider}"
                self._plugin_tool(
                    tenant_id,
                    writer,
                    "tools." + str(index),
                    tool.provider_type.value,
                    provider,
                    tool.tool_name,
                    dict(tool.runtime_parameters),
                )

    def _plugin_tool(
        self,
        tenant_id: str,
        writer: "_Selectors",
        path: str,
        provider_type: object,
        provider: object,
        tool: object,
        values: dict[str, object],
    ) -> None:
        # Workflow/App tools have their owned configuration inventoried above;
        # API/MCP transports do not use Core's plugin model-callback capability.
        if provider_type not in {"plugin", "builtin"}:
            return
        if not isinstance(provider, str) or tool is not None and not isinstance(tool, str):
            writer.dynamic(path + ".model_callback", {})
            return
        selectors = self._strategies.tool_model_selectors(tenant_id, provider, tool)
        if not selectors.selector_names and selectors.permits_model_callbacks:
            writer.dynamic(path + ".model_callback", {})
        for name in selectors.selector_names:
            value = values.get(name)
            if value is None:
                writer.dynamic(path + "." + name, {})
                continue
            model = _object(value)
            wrapped = model.get("value")
            if isinstance(wrapped, dict) and all(
                isinstance(wrapped.get(key), str) for key in ("provider", "model", "model_type")
            ):
                # ToolManager's declared MODEL_SELECTOR normalization accepts
                # this frontend configuration wrapper as a fixed selector.
                model = _object(wrapped)
            writer.fixed(path + "." + name, model.get("provider"), model.get("model"), model.get("model_type"), model)

    def _summary(self, writer: "_Selectors", path: str, value: object) -> None:
        if value is None:
            return
        setting = _object(value)
        if setting.get("enable") is True:
            writer.fixed(path, setting.get("model_provider_name"), setting.get("model_name"), "llm", setting)


class _Selectors:
    def __init__(
        self,
        document: ModelDependencyDocument,
        references: list[SavedModelReference],
        problems: list[ModelDependencyProblem],
    ) -> None:
        self.document, self.references, self.problems = document, references, problems

    def problem(self, path: str, code: str, config: object, *, provider: str | None = None) -> None:
        doc = self.document
        self.problems.append(
            ModelDependencyProblem(doc.kind, doc.owner_id, doc.revision, path, code, _digest(config), provider)
        )

    def fixed(self, path: str, provider: object, model: object, model_type: object, config: object) -> None:
        if not all(isinstance(value, str) and value for value in (provider, model, model_type)):
            normalized = str(ModelProviderID(provider)) if isinstance(provider, str) and provider else None
            self.problem(path, "incomplete_model_selector", config, provider=normalized)
            return
        provider, model, model_type = cast(str, provider), cast(str, model), cast(str, model_type)
        self._add(path, "fixed", str(ModelProviderID(provider)), model_type, model, config)

    def llm(self, path: str, value: object) -> None:
        config = _object(value)
        try:
            model = ModelConfigEntity.model_validate(
                {
                    "provider": config.get("provider"),
                    "model": config.get("name"),
                    "mode": config.get("mode"),
                    "parameters": config.get("completion_params") or {},
                }
            )
        except ValidationError:
            self._invalid_model(path, config)
            return
        self.fixed(path, model.provider, model.model, "llm", model.model_dump(mode="json"))

    def graph_llm(self, path: str, value: object) -> None:
        config = _object(value)
        try:
            model = ModelConfig.model_validate(config)
        except ValidationError:
            self._invalid_model(path, config)
            return
        self.fixed(path, model.provider, model.name, "llm", model.model_dump(mode="json"))

    def _invalid_model(self, path: str, config: dict[str, object]) -> None:
        provider = config.get("provider")
        normalized = str(ModelProviderID(provider)) if isinstance(provider, str) and provider else None
        self.problem(path, "invalid_model_selector", config, provider=normalized)

    def dynamic(self, path: str, config: object) -> None:
        self._add(path, "dynamic", None, None, None, config)

    def default(self, path: str, model_type: str) -> None:
        self._add(path, "tenant_default", None, model_type, None, {})

    def _add(
        self,
        path: str,
        kind: ReferenceKind,
        provider: str | None,
        model_type: str | None,
        model: str | None,
        config: object,
    ) -> None:
        doc = self.document
        self.references.append(
            SavedModelReference(
                doc.kind,
                doc.owner_id,
                doc.revision,
                path,
                kind,
                provider,
                model_type,
                model,
                configuration_digest=_digest(config),
            )
        )
