from inspect import unwrap
from unittest.mock import patch

import pytest

import controllers.console.spec as spec_module


class TestSpecSchemaDefinitionsApi:
    def test_get_success(self):
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)

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

        with patch.object(
            spec_module,
            "SchemaManager",
        ) as schema_manager_cls:
            schema_manager_cls.return_value.get_all_schema_definitions.return_value = schema_definitions

            resp, status = method(api)

        assert status == 200
        assert resp == schema_definitions
        assert spec_module.SchemaDefinitionsResponse.model_validate(resp).model_dump(mode="json") == schema_definitions

    def test_get_documents_tight_response_model(self):
        response = spec_module.SpecSchemaDefinitionsApi.get.__apidoc__["responses"]["200"]

        assert response[1].name == spec_module.SchemaDefinitionsResponse.__name__

    def test_get_exception_returns_empty_list(self, caplog: pytest.LogCaptureFixture):
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)

        with patch.object(
            spec_module,
            "SchemaManager",
            side_effect=Exception("boom"),
        ):
            resp, status = method(api)

        assert status == 200
        assert resp == []
        assert "boom" in caplog.text
