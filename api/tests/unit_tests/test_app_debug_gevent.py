
import ast
from pathlib import Path

# tests/unit_tests/ -> tests/ -> api/
APP_PY = Path(__file__).parents[2] / "app.py"


def _load_app_module() -> ast.Module:
    return ast.parse(APP_PY.read_text(encoding="utf-8"), filename=str(APP_PY))


def _dotted_name(node: ast.expr) -> str | None:
    """Return the dotted call target, e.g. ``monkey.patch_all`` from a call node."""
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
        return ".".join(reversed(parts))
    return None


def _is_main_guard(node: ast.stmt) -> bool:
    """True for an ``if __name__ == "__main__":`` statement."""
    if not isinstance(node, ast.If):
        return False
    test = node.test
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.ops) == 1
        and isinstance(test.ops[0], ast.Eq)
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def _contains_call(node: ast.AST, dotted_target: str) -> bool:
    return any(
        isinstance(child, ast.Call) and _dotted_name(child.func) == dotted_target for child in ast.walk(node)
    )


def _first_call_lineno(tree: ast.AST, dotted_target: str) -> int | None:
    linenos = [
        child.lineno
        for child in ast.walk(tree)
        if isinstance(child, ast.Call) and _dotted_name(child.func) == dotted_target
    ]
    return min(linenos) if linenos else None


def test_app_py_exists() -> None:
    # Arrange / Act / Assert
    assert APP_PY.is_file(), f"expected api/app.py at {APP_PY}"


def test_debug_server_monkey_patches_inside_main_guard() -> None:
    # Arrange
    module = _load_app_module()

    # Act
    patch_guards = [node for node in module.body if _is_main_guard(node) and _contains_call(node, "monkey.patch_all")]

    # Assert
    assert patch_guards, (
        "api/app.py must call gevent monkey.patch_all() inside an "
        "`if __name__ == '__main__'` guard so the `python -m app` (DEBUG=true) "
        "server is cooperatively scheduled. Removing it re-introduces the "
        "deadlock from issue #39205 (regressed once in PR #27611, fixed in PR #38975)."
    )


def test_monkey_patch_runs_before_app_factory_import() -> None:
    # Arrange
    module = _load_app_module()

    # Act
    patch_lineno = _first_call_lineno(module, "monkey.patch_all")
    app_factory_import_linenos = [
        node.lineno
        for node in ast.walk(module)
        if isinstance(node, ast.ImportFrom) and node.module == "app_factory"
    ]

    # Assert
    assert patch_lineno is not None, "gevent monkey.patch_all() call not found in api/app.py"
    assert app_factory_import_linenos, "expected a `from app_factory import ...` statement in api/app.py"
    assert patch_lineno < min(app_factory_import_linenos), (
        "gevent monkey.patch_all() must run BEFORE app_factory is imported; patching "
        "after other imports leaves blocking I/O (sockets, locks) unpatched and "
        "re-introduces the DEBUG=true deadlock from issue #39205."
    )
