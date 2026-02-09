"""
Unit tests for Service API knowledge pipeline route registration.
"""

import ast
import importlib
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def service_api_route_urls() -> set[str]:
    # Import console first to avoid the schema import cycle when service_api is imported in isolation.
    import controllers.console  # noqa: F401

    service_api_module = importlib.import_module("controllers.service_api")
    return {
        url
        for resource in service_api_module.service_api_ns.resources
        for url in getattr(resource, "urls", [])
    }


def test_rag_pipeline_routes_registered():
    api_dir = Path(__file__).resolve().parents[5]

    service_api_init = api_dir / "controllers" / "service_api" / "__init__.py"
    rag_pipeline_workflow = (
        api_dir / "controllers" / "service_api" / "dataset" / "rag_pipeline" / "rag_pipeline_workflow.py"
    )

    assert service_api_init.exists()
    assert rag_pipeline_workflow.exists()

    init_tree = ast.parse(service_api_init.read_text(encoding="utf-8"))
    import_found = False
    for node in ast.walk(init_tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        if node.module != "dataset.rag_pipeline" or node.level != 1:
            continue
        if any(alias.name == "rag_pipeline_workflow" for alias in node.names):
            import_found = True
            break

    assert import_found, "from .dataset.rag_pipeline import rag_pipeline_workflow not found in service_api/__init__.py"

    workflow_tree = ast.parse(rag_pipeline_workflow.read_text(encoding="utf-8"))
    route_paths: set[str] = set()

    for node in ast.walk(workflow_tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            if not isinstance(decorator.func, ast.Attribute):
                continue
            if decorator.func.attr != "route":
                continue
            if not decorator.args:
                continue
            first_arg = decorator.args[0]
            if isinstance(first_arg, ast.Constant) and isinstance(first_arg.value, str):
                route_paths.add(first_arg.value)

    assert "/datasets/<uuid:dataset_id>/pipeline/datasource-plugins" in route_paths
    assert "/datasets/<uuid:dataset_id>/pipeline/datasource/nodes/<string:node_id>/run" in route_paths
    assert "/datasets/<uuid:dataset_id>/pipeline/run" in route_paths
    assert "/datasets/pipeline/file-upload" in route_paths


def test_rag_pipeline_routes_are_registered_on_service_api_namespace(service_api_route_urls: set[str]):
    assert "/datasets/<uuid:dataset_id>/pipeline/datasource-plugins" in service_api_route_urls
    assert "/datasets/<uuid:dataset_id>/pipeline/datasource/nodes/<string:node_id>/run" in service_api_route_urls
    assert "/datasets/<uuid:dataset_id>/pipeline/run" in service_api_route_urls


def test_rag_pipeline_routes_do_not_use_legacy_brace_style_converters(service_api_route_urls: set[str]):
    assert all("{uuid:dataset_id}" not in route for route in service_api_route_urls)
