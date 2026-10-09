from machinery.context import ServiceApiRequestContext


def test_service_api_request_context_contains_only_app_scope() -> None:
    context = ServiceApiRequestContext(
        tenant_id="tenant-1",
        app_id="app-1",
    )

    assert context.tenant_id == "tenant-1"
    assert context.app_id == "app-1"
    assert not hasattr(context, "account_id")
