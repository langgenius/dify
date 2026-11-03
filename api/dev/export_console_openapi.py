"""Export community Console schemas to stdout for the OpenAPI content mapper."""

import ast
import contextlib
import inspect
import json
import sys
import textwrap
from pathlib import Path
from typing import Any


def source_location(target: Any) -> dict[str, Any] | None:
    """Locate the actual class or function definition, skipping decorators."""
    try:
        target = inspect.unwrap(target)
        filename = inspect.getsourcefile(target)
        lines, start = inspect.getsourcelines(target)
        definition = ast.parse(textwrap.dedent("".join(lines))).body[0]
    except (OSError, TypeError, ValueError, SyntaxError):
        # Dynamically created or native handlers have no navigable Python source.
        return None
    if filename and isinstance(definition, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
        return {
            "file": str(Path(filename).resolve()),
            "line": start + definition.lineno - 1,
        }
    return None


def resolve_source_type(source: str) -> Any:
    """Resolve registered identities only, including nested classes and generic origins."""
    parts = source.split("[", 1)[0].split(".")
    for end in range(len(parts) - 1, 0, -1):
        target = sys.modules.get(".".join(parts[:end]))
        if target is None:
            continue
        for part in parts[end:]:
            if not inspect.ismodule(target) and not inspect.isclass(target):
                return None
            target = vars(target).get(part)
        return target if inspect.isclass(target) else None
    return None


def attach_source_location(document: dict[str, Any], path: str, method: str, handler: Any) -> None:
    """Attach editor-only origins to exported operations, leaving live schemas unchanged."""
    operation = document["paths"].get(path, {}).get(method.lower())
    if isinstance(operation, dict) and (location := source_location(handler)):
        operation["x-source-location"] = location


def attach_api_sources(document: dict[str, Any], api: Any) -> None:
    """Annotate exported RESTX models and operations from their registered Python owners."""
    from flask_restx.swagger import extract_path

    from controllers.common.schema import registered_schema_sources

    schemas = document.get("components", {}).get("schemas", {})
    for namespace in api.namespaces:
        for name, source in registered_schema_sources(namespace).items():
            if name in schemas and (location := source_location(resolve_source_type(source))):
                schemas[name]["x-source-location"] = location
        for resource in namespace.resources:
            cls = resource.resource
            for url in api.ns_urls(namespace, resource.urls):
                for method in cls.methods:
                    handler = getattr(cls, method.lower(), None)  # guard-ignore: no-new-getattr -- HTTP method
                    attach_source_location(document, extract_path(url), method, handler)


def export_all_with_sources() -> dict[str, dict[str, Any]]:
    """Export every RESTX surface with editor metadata, without writing spec files."""
    from dev.generate_swagger_specs import SPEC_TARGETS, _target_apis, export_specs

    documents = export_specs()
    apis = _target_apis()
    for target in SPEC_TARGETS:
        attach_api_sources(documents[target.filename], apis[target.route])
    return documents


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
        from controllers.console import api
        from controllers.fastopenapi import console_router

        attach_api_sources(documents["console"], api)
        for path, method, handler in console_router.get_routes():
            attach_source_location(documents["fast"], f"/console/api{path}", method, handler)
    json.dump(documents, sys.stdout, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
