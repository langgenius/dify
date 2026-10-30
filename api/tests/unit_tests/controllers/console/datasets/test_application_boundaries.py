"""Guard all migrated dataset endpoints against transport/persistence regressions."""

import ast
from pathlib import Path

import pytest


@pytest.mark.parametrize("filename", ["external.py", "hit_testing.py"])
def test_migrated_error_boundaries_do_not_import_werkzeug(filename: str) -> None:
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "controllers/console/datasets" / filename).read_text())

    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            modules = [node.module or ""]
        elif isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        else:
            continue
        assert not any(module == "werkzeug" or module.startswith("werkzeug.") for module in modules), modules


@pytest.mark.parametrize(
    "filename",
    ["data_source.py", "datasets.py", "datasets_document.py", "external.py"],
)
def test_every_endpoint_declares_admission_context_and_application_service(filename: str) -> None:
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "controllers/console/datasets" / filename).read_text())
    # This namespace package is not traversed by import-linter's package graph.
    forbidden = (
        "sqlalchemy",
        "repositories",
        "controllers.common.session",
        "libs.login",
        "services.knowledge.external.service",
        "services.knowledge.hit_testing.adapters",
        "services.knowledge.dataset_read_service",
        "services.knowledge.datasets.adapters",
        "services.knowledge.documents.adapters",
        "services.knowledge.external.adapters",
    )
    for node in ast.walk(tree):
        modules = (
            [node.module or ""]
            if isinstance(node, ast.ImportFrom)
            else [item.name for item in node.names]
            if isinstance(node, ast.Import)
            else []
        )
        for module in modules:
            assert not any(module == name or module.startswith(name + ".") for name in forbidden), module
    endpoints = [
        method
        for resource in tree.body
        if isinstance(resource, ast.ClassDef)
        for method in resource.body
        if isinstance(method, ast.FunctionDef) and method.name in {"get", "post", "patch", "put", "delete"}
    ]
    assert endpoints
    for endpoint in endpoints:
        assert any(
            isinstance(d, ast.Call) and ast.unparse(d.func) == "console_account_admission"
            for d in endpoint.decorator_list
        ), endpoint.name
        assert any(
            arg.arg == "request_context"
            and arg.annotation is not None
            and ast.unparse(arg.annotation) == "RequestContext"
            for arg in endpoint.args.args
        ), endpoint.name
        assert any(
            isinstance(n, ast.Call) and ast.unparse(n.func) == "application_services" for n in ast.walk(endpoint)
        ), endpoint.name
        assert not {"session", "current_user", "current_tenant_id"}.intersection(arg.arg for arg in endpoint.args.args)
