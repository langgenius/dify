from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import create_autospec, patch

import controllers.console.spec as spec_module
from dify_app import DifyApp
from extensions import ext_login
from machinery.context import RequestContext
from services.schema_definition_service import SchemaDefinitionService


class TestSpecSchemaDefinitionsApi:
    def test_get_success(self) -> None:
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id="trace-1",
            account_id="account-1",
            active_workspace_id="workspace-1",
        )

        schema_definitions = [
            {
                "name": "conversation-variable",
                "label": "Conversation variable",
                "schema": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}},
                    "required": ["name"],
                },
            }
        ]

        service = create_autospec(SchemaDefinitionService, instance=True, spec_set=True)
        service.list.return_value = tuple(schema_definitions)

        with patch.object(
            spec_module,
            "application_services",
            return_value=SimpleNamespace(schema_definitions=service),
        ):
            resp, status = method(api, request_context)

        assert status == spec_module.HTTPStatus.OK
        assert resp == schema_definitions
        service.list.assert_called_once_with()

    def test_get_documents_tight_response_model(self) -> None:
        response = spec_module.SpecSchemaDefinitionsApi.get.__apidoc__["responses"]["200"]

        assert response[1].name == spec_module.SchemaDefinitionsResponse.__name__

    def test_get_returns_empty_list_from_service(self) -> None:
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)
        request_context = RequestContext(
            request_id="request-1",
            trace_id=None,
            account_id="account-1",
            active_workspace_id=None,
        )
        service = create_autospec(SchemaDefinitionService, instance=True, spec_set=True)
        service.list.return_value = ()

        with patch.object(
            spec_module,
            "application_services",
            return_value=SimpleNamespace(schema_definitions=service),
        ):
            resp, status = method(api, request_context)

        assert status == spec_module.HTTPStatus.OK
        assert resp == []

    def test_get_rejects_unauthenticated_request_before_service_call(self) -> None:
        app = DifyApp(__name__)
        app.config["TESTING"] = True
        ext_login.init_app(app)
        api = spec_module.SpecSchemaDefinitionsApi()
        service = create_autospec(SchemaDefinitionService, instance=True, spec_set=True)

        with (
            app.test_request_context("/console/api/spec/schema-definitions"),
            patch("controllers.console.wraps._is_setup_completed", return_value=True),
            patch("libs.login._resolve_current_user", return_value=None),
            patch.object(
                spec_module,
                "application_services",
                return_value=SimpleNamespace(schema_definitions=service),
            ),
        ):
            response = api.get()

        assert response.status_code == 401
        service.list.assert_not_called()
