import importlib

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


def test_rag_pipeline_routes_are_registered_on_service_api_namespace(service_api_route_urls: set[str]):
    assert "/datasets/<uuid:dataset_id>/pipeline/datasource-plugins" in service_api_route_urls
    assert "/datasets/<uuid:dataset_id>/pipeline/datasource/nodes/<string:node_id>/run" in service_api_route_urls
    assert "/datasets/<uuid:dataset_id>/pipeline/run" in service_api_route_urls


def test_rag_pipeline_routes_do_not_use_legacy_brace_style_converters(service_api_route_urls: set[str]):
    assert all("{uuid:dataset_id}" not in route for route in service_api_route_urls)
