from core.app.entities.app_invoke_entities import InvokeFrom


def test_openapi_variant_present():
    assert InvokeFrom.OPENAPI.value == "openapi"


def test_openapi_distinct_from_service_api():
    assert InvokeFrom.OPENAPI != InvokeFrom.SERVICE_API
