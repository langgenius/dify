"""Guard all migrated dataset endpoints against transport/persistence regressions."""

import ast
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    ("filename", "count"),
    [("data_source.py", 7), ("datasets.py", 20), ("datasets_document.py", 24), ("external.py", 8)],
)
def test_every_endpoint_declares_admission_context_and_application_service(filename: str, count: int) -> None:
    root = Path(__file__).resolve().parents[5]
    tree = ast.parse((root / "controllers/console/datasets" / filename).read_text())
    # This namespace package is not traversed by import-linter's package graph.
    forbidden = (
        "sqlalchemy",
        "repositories",
        "controllers.common.session",
        "libs.login",
        "services.knowledge.dataset_service",
        "services.knowledge.external.service",
        "services.hit_testing_service",
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
    assert len(endpoints) == count
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
