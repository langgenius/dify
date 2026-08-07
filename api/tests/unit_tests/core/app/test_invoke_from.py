from core.app.entities.app_invoke_entities import InvokeFrom


def test_openapi_variant_present():
    assert InvokeFrom.OPENAPI.value == "openapi"


def test_openapi_distinct_from_service_api():
    assert InvokeFrom.OPENAPI != InvokeFrom.SERVICE_API


def test_runs_as_account_only_for_console_contexts():
    # Console contexts (studio debugger / explore) run as the signed-in Account.
    assert InvokeFrom.DEBUGGER.runs_as_account() is True
    assert InvokeFrom.EXPLORE.runs_as_account() is True
    # Everything else is attributed to an end user.
    for invoke_from in (
        InvokeFrom.WEB_APP,
        InvokeFrom.SERVICE_API,
        InvokeFrom.OPENAPI,
        InvokeFrom.TRIGGER,
        InvokeFrom.PUBLISHED_PIPELINE,
        InvokeFrom.VALIDATION,
    ):
        assert invoke_from.runs_as_account() is False
