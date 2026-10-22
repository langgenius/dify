import ast
from pathlib import Path
from typing import Final

import pytest

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


def test_openapi_controllers_raise_openapi_errors_not_plain_werkzeug():
    root = Path(controllers.openapi.__file__).parent
    offenders = [
        f"{relative}:{line}"
        for path in sorted(root.rglob("*.py"))
        if (relative := path.relative_to(root).as_posix()) not in ALLOWED_FILES
        for line in banned_raise_lines(path.read_text())
    ]
    assert offenders == []


FLAGGED_SNIPPETS: Final = {
    "call": "from werkzeug.exceptions import Forbidden\nraise Forbidden('x')",
    "bare name": "from werkzeug.exceptions import Forbidden\nraise Forbidden",
    "dotted": "import werkzeug.exceptions\nraise werkzeug.exceptions.Forbidden()",
    "module alias": "import werkzeug.exceptions as we\nraise we.Forbidden()",
    "from-module alias": "from werkzeug import exceptions as ex\nraise ex.Forbidden()",
    "name alias": "from werkzeug.exceptions import Forbidden as F\nraise F('x')",
    "unavailable call": "from werkzeug.exceptions import ServiceUnavailable\nraise ServiceUnavailable()",
    "unavailable bare": "from werkzeug.exceptions import ServiceUnavailable\nraise ServiceUnavailable",
    "unavailable dotted": "import werkzeug.exceptions\nraise werkzeug.exceptions.ServiceUnavailable()",
    "unavailable module alias": "import werkzeug.exceptions as we\nraise we.ServiceUnavailable()",
    "unavailable name alias": "from werkzeug.exceptions import ServiceUnavailable as S\nraise S()",
}

CLEAN_SNIPPETS: Final = {
    "similar name": "raise ForbiddenError()",
    "not found": "from werkzeug.exceptions import NotFound\nraise NotFound()",
    "bare raise": "try:\n    pass\nexcept Exception:\n    raise",
    "other alias": "from werkzeug.exceptions import NotFound as F\nraise F()",
}


@pytest.mark.parametrize("source", FLAGGED_SNIPPETS.values(), ids=FLAGGED_SNIPPETS.keys())
def test_scanner_flags_plain_werkzeug_raises(source: str):
    assert banned_raise_lines(source) == [source.count("\n") + 1]


@pytest.mark.parametrize("source", CLEAN_SNIPPETS.values(), ids=CLEAN_SNIPPETS.keys())
def test_scanner_ignores_other_raises(source: str):
    assert banned_raise_lines(source) == []
