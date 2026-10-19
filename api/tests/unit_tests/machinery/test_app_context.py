from machinery.context import AppRequestContext


def test_app_request_context_contains_only_app_scope() -> None:
    context = AppRequestContext(
        tenant_id="tenant-1",
        app_id="app-1",
    )

    assert context.tenant_id == "tenant-1"
    assert context.app_id == "app-1"
    assert not hasattr(context, "account_id")
