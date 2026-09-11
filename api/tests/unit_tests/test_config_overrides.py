"""Contract tests for the shared unit-test config override fixture."""

import ast
from collections.abc import Callable
from pathlib import Path
from typing import override

import pytest

from configs import dify_config
from enums import DeploymentEdition

_UNIT_TEST_ROOT = Path(__file__).parent
_AUTHORIZED_MUTATION_FILE = _UNIT_TEST_ROOT / "config_override.py"


def _references_shared_config(node: ast.AST) -> bool:
    """Return whether an expression resolves through the shared ``dify_config`` object."""
    return any(
        (isinstance(child, ast.Name) and child.id == "dify_config")
        or (isinstance(child, ast.Attribute) and child.attr == "dify_config")
        for child in ast.walk(node)
    )


def _attribute_chain(node: ast.AST) -> tuple[str, ...]:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return tuple(reversed(parts))


def _is_config_field(name: object) -> bool:
    return isinstance(name, str) and bool(name) and name.isupper()


class _DirectConfigMutationVisitor(ast.NodeVisitor):
    """Find test code that bypasses the validated config override helper."""

    def __init__(self) -> None:
        self.lines: list[int] = []

    @override
    def visit_Call(self, node: ast.Call) -> None:
        chain = _attribute_chain(node.func)
        if chain[-2:] == ("patch", "object") and len(node.args) >= 2:
            field = node.args[1]
            if (
                _references_shared_config(node.args[0])
                and isinstance(field, ast.Constant)
                and _is_config_field(field.value)
            ):
                self.lines.append(node.lineno)
        elif chain[-1:] == ("patch",) and node.args:
            target = node.args[0]
            if (
                isinstance(target, ast.Constant)
                and isinstance(target.value, str)
                and ".dify_config." in target.value
                and _is_config_field(target.value.rsplit(".", 1)[-1])
            ):
                self.lines.append(node.lineno)
        elif chain[-2:] == ("monkeypatch", "setattr") and node.args:
            target = node.args[0]
            field = node.args[1] if len(node.args) >= 2 else None
            string_target_is_config = (
                isinstance(target, ast.Constant) and isinstance(target.value, str) and ".dify_config." in target.value
            )
            object_target_is_config = (
                field is not None
                and _references_shared_config(target)
                and isinstance(field, ast.Constant)
                and _is_config_field(field.value)
            )
            if string_target_is_config or object_target_is_config:
                self.lines.append(node.lineno)
        self.generic_visit(node)

    @override
    def visit_Assign(self, node: ast.Assign) -> None:
        for target in node.targets:
            if (
                isinstance(target, ast.Attribute)
                and _is_config_field(target.attr)
                and _references_shared_config(target)
            ):
                self.lines.append(node.lineno)
        self.generic_visit(node)


def _find_direct_config_mutations(path: Path) -> list[int]:
    visitor = _DirectConfigMutationVisitor()
    visitor.visit(ast.parse(path.read_text(), filename=str(path)))
    return visitor.lines


def test_config_overrides_updates_shared_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    assert dify_config.DEPLOYMENT_EDITION is DeploymentEdition.CLOUD


def test_config_overrides_rejects_unknown_fields(config_overrides: Callable[..., None]) -> None:
    with pytest.raises(ValueError, match=r"Unknown DifyConfig fields: \['NOT_A_CONFIG_FIELD'\]"):
        config_overrides(NOT_A_CONFIG_FIELD=True)


def test_unit_tests_use_validated_config_overrides() -> None:
    """Keep global application config mutations centralized and automatically restored."""
    violations = {
        str(path.relative_to(_UNIT_TEST_ROOT)): lines
        for path in _UNIT_TEST_ROOT.rglob("*.py")
        if path != _AUTHORIZED_MUTATION_FILE and (lines := _find_direct_config_mutations(path))
    }

    assert violations == {}, f"Use config_overrides or config_overrides_context instead: {violations}"
