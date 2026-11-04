"""Plugin-backed nodes: each plugin kind is a `PluginReference` subclass, chosen by the node's data-model class."""

from __future__ import annotations

import functools
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import Enum, StrEnum, auto
from typing import TYPE_CHECKING, Any, Final, Self

from core.workflow.node_factory import node_data_model, resolve_workflow_node_class
from core.workflow.nodes.datasource.entities import DatasourceEntity
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from graphon.entities.base_node_data import BaseNodeData
from graphon.nodes.base.node import Node

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

# A node without a version runs as the data model's default version.
_RUNTIME_DEFAULT_VERSION: Final = str(BaseNodeData.model_fields["version"].default)


class _NoDefault(Enum):
    NO_DEFAULT = auto()


NO_DEFAULT: Final = _NoDefault.NO_DEFAULT


class DeclarationStatus(StrEnum):
    FOUND = auto()
    NOT_INSTALLED = auto()
    NOT_FOUND = auto()


@dataclass(frozen=True)
class DeclaredParameter:
    name: str
    form: str | None
    type: str
    required: bool
    default: object
    options: tuple[str, ...]
    help: str | None


@dataclass(frozen=True)
class PluginDeclaration:
    status: DeclarationStatus
    parameters: tuple[DeclaredParameter, ...] = ()


class PluginReference(ABC):
    """One plugin a node uses: read from the raw node, looked up for the tenant, and written back as stored values."""

    @classmethod
    @abstractmethod
    def extract(cls, raw: Mapping[str, Any]) -> Sequence[Self]: ...

    @property
    @abstractmethod
    def key(self) -> str: ...

    @abstractmethod
    def resolve(self, ctx: FillContext) -> PluginDeclaration: ...

    @abstractmethod
    def apply(self, raw: dict[str, Any], declaration: PluginDeclaration) -> None: ...

    @abstractmethod
    def value_loc(self, parameter: DeclaredParameter) -> tuple[str, ...]:
        """Where in the node data a declared parameter's value is stored."""


@functools.singledispatch
def _reference_class(_data_model: type) -> type[PluginReference] | None:
    return None


def references_for(data_model: type) -> type[PluginReference] | None:
    """The plugin kind of nodes whose data model is `data_model` or a subclass of it."""
    return _reference_class.dispatch(data_model)(data_model)


def plugin_reference_for[R: type[PluginReference]](data_model: type) -> Callable[[R], R]:
    """Register the decorated reference class for `data_model` and its subclasses.

    A kind defined in its own module registers only once that module is imported in `authoring/__init__.py`.
    """

    def register(reference: R) -> R:
        _reference_class.register(data_model, lambda _data_model: reference)
        return reference

    return register


class _DeferredReference(PluginReference):
    """A plugin kind fill does not write yet: its nodes are plugin-backed but carry no references."""

    @classmethod
    def extract(cls, raw: Mapping[str, Any]) -> Sequence[Self]:
        return ()

    @property
    def key(self) -> str:
        raise NotImplementedError("a deferred plugin kind has no references")

    def resolve(self, ctx: FillContext) -> PluginDeclaration:
        raise NotImplementedError("a deferred plugin kind has no references")

    def apply(self, raw: dict[str, Any], declaration: PluginDeclaration) -> None:
        raise NotImplementedError("a deferred plugin kind has no references")

    def value_loc(self, parameter: DeclaredParameter) -> tuple[str, ...]:
        raise NotImplementedError("a deferred plugin kind has no references")


@plugin_reference_for(TriggerEventNodeData)
class TriggerEventReference(_DeferredReference):
    """Trigger event parameters; deferred with trigger subscriptions."""


@plugin_reference_for(DatasourceEntity)
class DatasourceReference(_DeferredReference):
    """Datasource parameters; nothing reads them at run time and the web writes none for a new node."""


def node_version(raw: Mapping[str, Any]) -> str:
    """The version a raw node runs as: its own, or the data model's default when it has none."""
    return str(raw.get("version", _RUNTIME_DEFAULT_VERSION))


def node_class(raw: Mapping[str, Any]) -> type[Node] | None:
    """The class a raw node runs as; None for a node of no type or of an unknown type."""
    node_type = raw.get("type")
    if not isinstance(node_type, str):
        return None
    try:
        return resolve_workflow_node_class(node_type=node_type, node_version=node_version(raw), node_data=raw)
    except ValueError:
        return None


def node_references(raw: Mapping[str, Any]) -> list[PluginReference]:
    """The plugins a raw node uses; a node of an unknown type or of no plugin kind uses none."""
    resolved = node_class(raw)
    if resolved is None:
        return []
    reference = references_for(node_data_model(resolved))
    if reference is None:
        return []
    return list(reference.extract(raw))


def fill_plugin_values(raw: dict[str, Any], ctx: FillContext) -> None:
    """Write each found plugin's declared values the node lacks; a plugin that is not found leaves the node as it is."""
    for reference in node_references(raw):
        declaration = reference.resolve(ctx)
        if declaration.status == DeclarationStatus.FOUND:
            reference.apply(raw, declaration)
