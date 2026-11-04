"""Find where a workspace's apps select a given LLM.

The lookup is read-only and scoped to the caller's active workspace. It reads, per Console-addressable app,
the draft workflow and the currently published workflow (historical versions are not read) and the current
model configuration of chat, completion, and agent-chat apps. A reference matches when its model name is
equal to the requested name and its provider resolves to the same canonical provider ID. Usages are listed
only for apps the caller can see in the Console app list; the others are counted, not described.

Workflow nodes that select an LLM: ``llm``, ``question-classifier``, ``parameter-extractor``, and
``knowledge-retrieval`` while its single-retrieval or automatic metadata-filtering mode is active. Nodes
inside iterations and loops are part of the flat node list and are included. Not read: model-selector
parameters of tool and Agent nodes, models held outside the graph (such as Agent configurations), and
secondary models of app features (such as suggested questions).
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from machinery.context import RequestContext


class ModelUsageSource(StrEnum):
    """Stored configuration that holds a model reference."""

    # Declaration order is the listing order within an app.
    WORKFLOW_DRAFT = "workflow_draft"
    WORKFLOW_PUBLISHED = "workflow_published"
    APP_MODEL_CONFIG = "app_model_config"


_SOURCE_ORDER = {source: index for index, source in enumerate(ModelUsageSource)}
_MODEL_NODE_TYPES = frozenset({"llm", "question-classifier", "parameter-extractor"})


@dataclass(frozen=True, slots=True)
class ModelUsageDocument:
    """A stored configuration document of one app; ``content`` is the raw JSON text as persisted."""

    app_id: str
    app_name: str
    app_mode: str
    app_maintainer: str | None
    source: ModelUsageSource
    content: str


@dataclass(frozen=True, slots=True)
class ModelUsage:
    """One place that selects the model; node fields are None when the app model configuration holds it."""

    app_id: str
    app_name: str
    app_mode: str
    source: ModelUsageSource
    node_id: str | None
    node_title: str | None
    node_type: str | None


@dataclass(frozen=True, slots=True)
class ModelUsageList:
    """Usages in apps the caller can view, plus how many matching usages are in apps it cannot view."""

    usages: list[ModelUsage]
    inaccessible_count: int


class ModelUsageDocumentQuery(Protocol):
    def list_documents(
        self, *, workspace_id: str, model_fragments: Sequence[str], provider_fragment: str
    ) -> Sequence[ModelUsageDocument]:
        """Return documents of normal, Console-addressable apps in ``workspace_id`` only.

        A returned document's text contains ``provider_fragment`` and at least one of ``model_fragments``,
        matched literally. The result may include documents that do not reference the model; every
        document that does reference it is returned. Each call uses one short read session.
        """
        ...


class ModelProviderIdentity(Protocol):
    def canonical_provider_id(self, provider: str) -> str | None:
        """Return the canonical ``organization/plugin/provider`` ID, or None when ``provider`` is not a valid ID.

        The provider segment of the result equals the provider segment of the input.
        """
        ...


class AppVisibility(Protocol):
    def visible_app_ids(self, request_context: RequestContext, maintainers: Mapping[str, str | None]) -> set[str]:
        """Return the app ids, among ``maintainers`` (app id to maintainer account id), the caller can view.

        Uses the same rule as the Console app list. Called at most once per lookup.
        """
        ...


class ModelUsageQueryService:
    def __init__(
        self, *, documents: ModelUsageDocumentQuery, providers: ModelProviderIdentity, visibility: AppVisibility
    ) -> None:
        self._documents = documents
        self._providers = providers
        self._visibility = visibility

    def list_llm_usages(self, request_context: RequestContext, *, provider: str, model: str) -> ModelUsageList:
        """List the active workspace's references to ``provider``/``model``, ordered by app name, app, and source.

        Precondition: ``model`` is a non-empty model name. An invalid ``provider`` matches nothing.
        Postcondition: every usage belongs to ``request_context.active_workspace_id`` and to an app the caller
        can view; matching usages in other apps of the workspace are only counted. Each app, source, and node
        appears once. Documents that are not valid JSON yield no usage. No state is changed.
        """
        target = self._providers.canonical_provider_id(provider)
        if target is None:
            return ModelUsageList(usages=[], inaccessible_count=0)
        documents = self._documents.list_documents(
            workspace_id=request_context.active_workspace_id,
            # Workflow graphs are stored with ASCII escapes, so also look for the JSON-escaped spelling.
            model_fragments=tuple(sorted({model, json.dumps(model)[1:-1]})),
            provider_fragment=target.rsplit("/", 1)[-1],
        )
        usages = {
            (usage.app_id, usage.source, usage.node_id): usage
            for document in documents
            for usage, reference in _references(document)
            if reference[1] == model and self._providers.canonical_provider_id(reference[0]) == target
        }
        if not usages:
            return ModelUsageList(usages=[], inaccessible_count=0)
        maintainers = {document.app_id: document.app_maintainer for document in documents}
        visible = self._visibility.visible_app_ids(
            request_context, {usage.app_id: maintainers[usage.app_id] for usage in usages.values()}
        )
        listed = [usage for usage in usages.values() if usage.app_id in visible]
        return ModelUsageList(
            usages=sorted(listed, key=lambda usage: (usage.app_name, usage.app_id, _SOURCE_ORDER[usage.source])),
            inaccessible_count=len(usages) - len(listed),
        )


def _references(document: ModelUsageDocument) -> list[tuple[ModelUsage, tuple[str, str]]]:
    """Return each (usage, (provider, model name)) pair a document declares; unreadable content declares none."""
    try:
        content = json.loads(document.content)
    except ValueError:
        content = None
    if not isinstance(content, Mapping):
        return []
    if document.source == ModelUsageSource.APP_MODEL_CONFIG:
        return [(_usage(document, None), reference) for reference in _reference(content)]
    nodes = content.get("nodes")
    return [
        (_usage(document, node), reference)
        for node in (nodes if isinstance(nodes, list) else [])
        if isinstance(node, Mapping) and isinstance(node.get("data"), Mapping)
        for reference in _node_references(node["data"])
    ]


def _node_references(data: Mapping[str, object]) -> list[tuple[str, str]]:
    node_type = data.get("type")
    if node_type in _MODEL_NODE_TYPES:
        return _reference(data.get("model"))
    if node_type != "knowledge-retrieval":
        return []
    single = data.get("single_retrieval_config")
    references: list[tuple[str, str]] = []
    if data.get("retrieval_mode") == "single" and isinstance(single, Mapping):
        references.extend(_reference(single.get("model")))
    if data.get("metadata_filtering_mode") == "automatic":
        references.extend(_reference(data.get("metadata_model_config")))
    return references


def _reference(value: object) -> list[tuple[str, str]]:
    if not isinstance(value, Mapping):
        return []
    provider, name = value.get("provider"), value.get("name")
    return [(provider, name)] if isinstance(provider, str) and isinstance(name, str) else []


def _usage(document: ModelUsageDocument, node: Mapping[str, object] | None) -> ModelUsage:
    data = node.get("data") if node is not None else None
    title = data.get("title") if isinstance(data, Mapping) else None
    node_type = data.get("type") if isinstance(data, Mapping) else None
    node_id = node.get("id") if node is not None else None
    return ModelUsage(
        app_id=document.app_id,
        app_name=document.app_name,
        app_mode=document.app_mode,
        source=document.source,
        node_id=str(node_id) if node_id is not None else None,
        node_title=title if isinstance(title, str) else None,
        node_type=node_type if isinstance(node_type, str) else None,
    )
