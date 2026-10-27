"""Export community Console schemas to stdout for the OpenAPI content mapper."""

import ast
import contextlib
import inspect
import json
import sys
import textwrap
from pathlib import Path
from typing import Any


def attach_source_location(document: dict[str, Any], path: str, method: str, handler: Any) -> None:
    """Attach editor-only origins to exported operations, leaving live schemas unchanged."""
    operation = document["paths"].get(path, {}).get(method.lower())
    if not isinstance(operation, dict) or handler is None:
        return
    try:
        handler = inspect.unwrap(handler)
        filename = inspect.getsourcefile(handler)
        lines, start = inspect.getsourcelines(handler)
        definition = ast.parse(textwrap.dedent("".join(lines))).body[0]
    except (OSError, TypeError, ValueError, SyntaxError):
        # Dynamically created or native handlers have no navigable Python source.
        return
    if filename and isinstance(definition, (ast.FunctionDef, ast.AsyncFunctionDef)):
        operation["x-source-location"] = {
            "file": str(Path(filename).resolve()),
            "line": start + definition.lineno - 1,
        }


def main() -> None:
    # Backend initialization may log to stdout. Keep the protocol output pure JSON.
    with contextlib.redirect_stdout(sys.stderr):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from dev.generate_fastopenapi_specs import export_fastopenapi_specs
        from dev.generate_swagger_specs import export_console_spec

        documents = {
            "console": export_console_spec(),
            "fast": export_fastopenapi_specs()["fastopenapi-console-openapi.json"],
        }
        from flask_restx.swagger import extract_path

        from controllers.console import api
        from controllers.fastopenapi import console_router

        for namespace in api.namespaces:
            for resource in namespace.resources:
                cls = resource.resource
                for url in api.ns_urls(namespace, resource.urls):
                    path = extract_path(url)
                    for method in cls.methods:
                        handler = getattr(cls, method.lower(), None)  # guard-ignore: no-new-getattr -- HTTP method
                        attach_source_location(documents["console"], path, method, handler)
        for path, method, handler in console_router.get_routes():
            attach_source_location(documents["fast"], f"/console/api{path}", method, handler)
    json.dump(documents, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
