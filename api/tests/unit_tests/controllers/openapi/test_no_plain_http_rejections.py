import ast
from pathlib import Path
from typing import Final

import controllers.openapi

BANNED: Final = frozenset({"Forbidden", "ServiceUnavailable"})
# Browser SSO redirects (plain blueprint routes); the web page reads their `error`, not ErrorBody.
ALLOWED_FILES: Final = frozenset({"oauth_device_sso.py"})


def _raised_name(node: ast.Raise) -> str | None:
    target = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
    if isinstance(target, ast.Name):
        return target.id
    if isinstance(target, ast.Attribute):
        return target.attr
    return None


def test_openapi_controllers_raise_openapi_errors_not_plain_werkzeug():
    root = Path(controllers.openapi.__file__).parent
    offenders = [
        f"{path.relative_to(root)}:{node.lineno}"
        for path in sorted(root.rglob("*.py"))
        if path.name not in ALLOWED_FILES
        for node in ast.walk(ast.parse(path.read_text()))
        if isinstance(node, ast.Raise) and _raised_name(node) in BANNED
    ]
    assert offenders == []
