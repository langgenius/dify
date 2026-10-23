import ast
from pathlib import Path
from typing import Final

import controllers.openapi

BANNED: Final = frozenset({"Forbidden", "ServiceUnavailable"})
# Browser SSO redirects (plain blueprint routes); the web page reads their `error`, not ErrorBody.
ALLOWED_FILES: Final = frozenset({"oauth_device_sso.py"})


WERKZEUG_EXCEPTIONS: Final = "werkzeug.exceptions"


def _werkzeug_aliases(tree: ast.AST) -> dict[str, str]:
    return {
        (alias.asname or alias.name): alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == WERKZEUG_EXCEPTIONS
        for alias in node.names
    }


def _raised_name(node: ast.Raise, aliases: dict[str, str]) -> str | None:
    target = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
    if isinstance(target, ast.Name):
        return aliases.get(target.id, target.id)
    if isinstance(target, ast.Attribute):
        return target.attr
    return None


def banned_raise_lines(source: str) -> list[int]:
    tree = ast.parse(source)
    aliases = _werkzeug_aliases(tree)
    return [
        node.lineno for node in ast.walk(tree) if isinstance(node, ast.Raise) and _raised_name(node, aliases) in BANNED
    ]


def test_openapi_controllers_raise_openapi_errors_not_plain_werkzeug() -> None:
    root = Path(controllers.openapi.__file__).parent
    offenders = [
        f"{relative}:{line}"
        for path in sorted(root.rglob("*.py"))
        if (relative := path.relative_to(root).as_posix()) not in ALLOWED_FILES
        for line in banned_raise_lines(path.read_text())
    ]
    assert offenders == []
