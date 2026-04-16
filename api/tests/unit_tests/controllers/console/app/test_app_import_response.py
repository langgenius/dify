from types import SimpleNamespace

from controllers.console.app import app_import as app_import_module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class _DependencyValue:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, mode="json"):
        return self._payload


def test_leaked_dependency_response_normalizes_model_values():
    payload = app_import_module.AppImportCheckDependenciesResponse.model_validate(
        {
            "leaked_dependencies": [
                {
                    "type": "package",
                    "value": _DependencyValue({"plugin_unique_identifier": "plugin-1", "version": "1.0.0"}),
                    "current_identifier": "plugin-1@1.0.0",
                }
            ]
        }
    ).model_dump(mode="json")

    assert payload["leaked_dependencies"][0]["value"] == {
        "plugin_unique_identifier": "plugin-1",
        "version": "1.0.0",
    }


def test_check_dependencies_api_accepts_dict_result(app, monkeypatch):
    api = app_import_module.AppImportCheckDependenciesApi()
    method = unwrap(api.get)

    class _DummySessionContext:
        def __enter__(self):
            return object()

        def __exit__(self, exc_type, exc, tb):
            return False

    class _DummySessionMaker:
        def __init__(self, *args, **kwargs):
            pass

        def begin(self):
            return _DummySessionContext()

    monkeypatch.setattr(
        app_import_module.AppDslService,
        "check_dependencies",
        lambda *_args, **_kwargs: {
            "leaked_dependencies": [
                {
                    "type": "marketplace",
                    "value": {"marketplace_plugin_unique_identifier": "plugin-2"},
                    "current_identifier": None,
                }
            ]
        },
    )
    monkeypatch.setattr(app_import_module, "sessionmaker", _DummySessionMaker)
    monkeypatch.setattr(app_import_module, "db", SimpleNamespace(engine=object()))

    with app.test_request_context("/console/api/apps/imports/app-1/check-dependencies", method="GET"):
        response, status = method(api, app_model=SimpleNamespace(id="app-1"))

    assert status == 200
    assert response["leaked_dependencies"][0]["value"] == {"marketplace_plugin_unique_identifier": "plugin-2"}
