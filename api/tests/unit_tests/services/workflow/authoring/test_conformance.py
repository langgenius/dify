import ast
from pathlib import Path

import pytest

import services.workflow.authoring as authoring_package
from core.trigger.constants import TRIGGER_NODE_TYPES
from core.workflow.node_factory import get_node_type_classes_mapping
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import NodeExecutionType
from services.workflow_variable_reference_validator import branch_handles

_BUILTIN_NODE_TYPES_NAME = "BuiltinNodeTypes"
_NAMED_NODE_TYPE_CONSTANTS = frozenset({"KNOWLEDGE_INDEX_NODE_TYPE", "TRIGGER_NODE_TYPES"})
_TRIGGER_PREFIX = "TRIGGER_"


def _branch_node_types() -> list[str]:
    return sorted(
        node_type
        for node_type, versions in get_node_type_classes_mapping().items()
        if any(node_class.execution_type == NodeExecutionType.BRANCH for node_class in versions.values())
    )


def test_branch_node_types_exist() -> None:
    assert _branch_node_types()


@pytest.mark.parametrize("node_type", _branch_node_types())
def test_every_branch_node_type_has_branch_handles(node_type: str) -> None:
    assert branch_handles({"type": node_type, "title": "N"}) is not None


def _is_node_type_reference(node: ast.expr, registered: frozenset[str]) -> bool:
    if isinstance(node, ast.Constant):
        return isinstance(node.value, str) and node.value in registered
    if isinstance(node, ast.Attribute):
        if isinstance(node.value, ast.Name) and node.value.id == _BUILTIN_NODE_TYPES_NAME:
            return True
        return node.attr in _NAMED_NODE_TYPE_CONSTANTS or node.attr.startswith(_TRIGGER_PREFIX)
    if isinstance(node, ast.Name):
        return node.id in _NAMED_NODE_TYPE_CONSTANTS or node.id.startswith(_TRIGGER_PREFIX)
    if isinstance(node, ast.Starred):
        return _is_node_type_reference(node.value, registered)
    return False


def _node_type_tables(tree: ast.AST, registered: frozenset[str]) -> list[int]:
    lines: list[int] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            keys = [key for key in node.keys if key is not None]
            keys += [value for key, value in zip(node.keys, node.values, strict=True) if key is None]
            if any(_is_node_type_reference(key, registered) for key in keys):
                lines.append(node.lineno)
        elif isinstance(node, ast.Set):
            if any(_is_node_type_reference(element, registered) for element in node.elts):
                lines.append(node.lineno)
        elif isinstance(node, ast.MatchValue) and _is_node_type_reference(node.value, registered):
            lines.append(node.value.lineno)
    return lines


def _registered_node_types() -> frozenset[str]:
    return frozenset(get_node_type_classes_mapping())


def _authoring_modules() -> list[Path]:
    return sorted(Path(next(iter(authoring_package.__path__))).glob("*.py"))


def test_the_scan_sees_the_authoring_modules() -> None:
    assert {path.name for path in _authoring_modules()} >= {"fill.py", "checks.py"}


def test_named_node_types_are_registered() -> None:
    assert {KNOWLEDGE_INDEX_NODE_TYPE, *TRIGGER_NODE_TYPES} <= _registered_node_types()


@pytest.mark.parametrize(
    "source",
    [
        "{BuiltinNodeTypes.LLM: 1}",
        "{TRIGGER_WEBHOOK_NODE_TYPE}",
        "frozenset({KNOWLEDGE_INDEX_NODE_TYPE})",
        "{'llm': 1}",
        "{'if-else', 'end'}",
        "{**{}, BuiltinNodeTypes.END: 1}",
        "match t:\n    case BuiltinNodeTypes.LLM:\n        pass",
        "match t:\n    case 'llm':\n        pass",
        "{*TRIGGER_NODE_TYPES}",
    ],
)
def test_the_scan_catches_a_node_type_table(source: str) -> None:
    assert _node_type_tables(ast.parse(source), _registered_node_types())


@pytest.mark.parametrize(
    "source",
    [
        "{AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}",
        "{'mode': 1, 'name': 2}",
        "x = BuiltinNodeTypes.LLM",
    ],
)
def test_the_scan_ignores_other_literals(source: str) -> None:
    assert not _node_type_tables(ast.parse(source), _registered_node_types())


@pytest.mark.parametrize("path", _authoring_modules(), ids=lambda path: path.name)
def test_authoring_has_no_node_type_table(path: Path) -> None:
    lines = _node_type_tables(ast.parse(path.read_text()), _registered_node_types())
    assert not lines, f"{path.name} keys a literal by node type at lines {lines}"
