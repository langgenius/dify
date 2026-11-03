"""What a node, as written, still needs: its data schema, its plugin's declared parameters, and its open fields."""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final

from pydantic import BaseModel

from core.workflow.node_factory import node_data_model
from graphon.nodes.base.node import Node
from services.workflow.authoring.plugins import (
    NO_DEFAULT,
    DeclarationStatus,
    DeclaredParameter,
    PluginDeclaration,
    PluginReference,
    node_class,
    node_references,
)
from services.workflow.node_defaults import node_data_schema

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

type Loc = tuple[str | int, ...]
type _Step = Callable[[Mapping[str, Any], Mapping[str, Any], str | int], Mapping[str, Any] | None]

_DEFS_REF_PREFIX: Final = "#/$defs/"
_BRANCH_KEYS: Final = ("anyOf", "oneOf")
_TYPE_SEPARATOR: Final = " | "


@dataclass(frozen=True)
class FieldHint:
    """A field the agent still has to write, located relative to the node data."""

    loc: Loc
    type: str | None
    options: tuple[str, ...]
    description: str | None
    required: bool
    default: object


@dataclass(frozen=True)
class NodeSpec:
    node_id: str
    type: str
    version: str
    schema: Mapping[str, Any]
    plugin_parameters: tuple[DeclaredParameter, ...]
    open_fields: tuple[FieldHint, ...]


def _resolved(root: Mapping[str, Any], node: Mapping[str, Any]) -> Mapping[str, Any]:
    """`node` with its `$ref` replaced by the definition; the node's own keys, such as a description, win."""
    ref = node.get("$ref")
    if not isinstance(ref, str):
        return node
    definition = root.get("$defs", {}).get(ref.removeprefix(_DEFS_REF_PREFIX))
    if not isinstance(definition, Mapping):
        return node
    return {**definition, **{key: value for key, value in node.items() if key != "$ref"}}


def _branches(node: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for key in _BRANCH_KEYS:
        for branch in node.get(key, ()):
            if isinstance(branch, Mapping):
                yield branch


def _property(_root: Mapping[str, Any], node: Mapping[str, Any], part: str | int) -> Mapping[str, Any] | None:
    if not isinstance(part, str):
        return None
    child = node.get("properties", {}).get(part)
    return child if isinstance(child, Mapping) else None


def _mapping_value(_root: Mapping[str, Any], node: Mapping[str, Any], part: str | int) -> Mapping[str, Any] | None:
    if not isinstance(part, str):
        return None
    child = node.get("additionalProperties")
    return child if isinstance(child, Mapping) else None


def _item(_root: Mapping[str, Any], node: Mapping[str, Any], part: str | int) -> Mapping[str, Any] | None:
    if not isinstance(part, int):
        return None
    child = node.get("items")
    return child if isinstance(child, Mapping) else None


def _branch_child(root: Mapping[str, Any], node: Mapping[str, Any], part: str | int) -> Mapping[str, Any] | None:
    return next((child for branch in _branches(node) if (child := _child(root, branch, part)) is not None), None)


_STEPS: Final[tuple[_Step, ...]] = (_property, _mapping_value, _item, _branch_child)


def _child(root: Mapping[str, Any], node: Mapping[str, Any], part: str | int) -> Mapping[str, Any] | None:
    node = _resolved(root, node)
    child = next((found for step in _STEPS if (found := step(root, node, part)) is not None), None)
    return None if child is None else _resolved(root, child)


def schema_at(schema: Mapping[str, Any], loc: Sequence[str | int]) -> Mapping[str, Any] | None:
    """The JSON schema of the value at `loc` in data `schema` describes; None once the path leaves the schema."""
    node: Mapping[str, Any] | None = _resolved(schema, schema)
    for part in loc:
        if node is None:
            return None
        node = _child(schema, node, part)
    return node


def _type_names(root: Mapping[str, Any], node: Mapping[str, Any]) -> tuple[str, ...]:
    node = _resolved(root, node)
    declared = node.get("type")
    if isinstance(declared, str):
        return (declared,)
    if isinstance(declared, list):
        return tuple(str(name) for name in declared)
    return tuple(dict.fromkeys(name for branch in _branches(node) for name in _type_names(root, branch)))


def _options(root: Mapping[str, Any], node: Mapping[str, Any]) -> tuple[str, ...]:
    node = _resolved(root, node)
    values = [*node.get("enum", ())]
    if "const" in node:
        values.append(node["const"])
    values.extend(option for branch in _branches(node) for option in _options(root, branch))
    return tuple(dict.fromkeys(str(value) for value in values if value is not None))


def _field_hint(schema: Mapping[str, Any], loc: Loc, *, required: bool) -> FieldHint:
    found = schema_at(schema, loc)
    if found is None:
        return FieldHint(loc=loc, type=None, options=(), description=None, required=required, default=NO_DEFAULT)
    description = found.get("description")
    return FieldHint(
        loc=loc,
        type=_TYPE_SEPARATOR.join(_type_names(schema, found)) or None,
        options=_options(schema, found),
        description=description if isinstance(description, str) else None,
        required=required,
        default=found.get("default", NO_DEFAULT),
    )


def field_hint(model: type[BaseModel], loc: Sequence[str | int], *, required: bool) -> FieldHint:
    """What the agent needs to write the field at `loc` of `model`'s data."""
    return _field_hint(model.model_json_schema(), tuple(loc), required=required)


@dataclass(frozen=True)
class ResolvedReference:
    reference: PluginReference
    declaration: PluginDeclaration


@dataclass(frozen=True)
class NodeTarget:
    """A graph node of a known type, read once per check: every check and its spec share these lookups."""

    id: str
    data: Mapping[str, Any]
    node_class: type[Node]
    top_level: bool
    references: tuple[ResolvedReference, ...]

    @property
    def model(self) -> type[BaseModel]:
        return node_data_model(self.node_class)


def read_node(raw_node: Mapping[str, Any], ctx: FillContext) -> NodeTarget | None:
    """The node with its plugins looked up once; None for a node it cannot read or of an unknown type, such as a
    canvas note. Never raises: a failed lookup is a declaration status.
    """
    node_id = raw_node.get("id")
    if not isinstance(node_id, str):
        return None
    data = raw_node.get("data")
    if not isinstance(data, Mapping):
        return None
    resolved = node_class(data)
    if resolved is None:
        return None
    return NodeTarget(
        id=node_id,
        data=data,
        node_class=resolved,
        top_level=not raw_node.get("parentId"),
        references=tuple(ResolvedReference(ref, ref.resolve(ctx)) for ref in node_references(data)),
    )


def _declared_parameters(node: NodeTarget) -> tuple[DeclaredParameter, ...]:
    return tuple(
        parameter
        for resolved in node.references
        if resolved.declaration.status == DeclarationStatus.FOUND
        for parameter in resolved.declaration.parameters
    )


def node_spec(node: NodeTarget) -> NodeSpec:
    """What the node still needs: its data schema, its found plugins' parameters, and each top-level field it lacks."""
    schema = node_data_schema(node.node_class)
    open_fields = tuple(
        _field_hint(schema, (key,), required=field.is_required())
        for name, field in node.model.model_fields.items()
        if (key := field.alias or name) not in node.data
    )
    return NodeSpec(
        node_id=node.id,
        type=str(node.data["type"]),
        version=node.node_class.version(),
        schema=schema,
        plugin_parameters=_declared_parameters(node),
        open_fields=open_fields,
    )
