from unittest.mock import patch

import controllers.console.spec as spec_module


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestSpecSchemaDefinitionsApi:
    def test_get_success(self):
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)

        schema_definitions = [{"type": "string"}]

        with patch.object(
            spec_module,
            "SchemaManager",
        ) as schema_manager_cls:
            schema_manager_cls.return_value.get_all_schema_definitions.return_value = schema_definitions

            resp, status = method(api)

        assert status == 200
        assert resp == schema_definitions

    def test_get_exception_returns_empty_list(self):
        api = spec_module.SpecSchemaDefinitionsApi()
        method = unwrap(api.get)

        with (
            patch.object(
                spec_module,
                "SchemaManager",
                side_effect=Exception("boom"),
            ),
            patch.object(
                spec_module.logger,
                "exception",
            ) as log_exception,
        ):
            resp, status = method(api)

        assert status == 200
        assert resp == []
        log_exception.assert_called_once()
