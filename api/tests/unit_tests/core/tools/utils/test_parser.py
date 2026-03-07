from json.decoder import JSONDecodeError
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from yaml import YAMLError

from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolParameter
from core.tools.errors import ToolApiSchemaError, ToolNotSupportedError, ToolProviderNotFoundError
from core.tools.utils.parser import ApiBasedToolSchemaParser


@pytest.fixture
def app():
    app = Flask(__name__)
    return app


def test_parse_openapi_to_tool_bundle_operation_id(app):
    openapi = {
        "openapi": "3.0.0",
        "info": {"title": "Simple API", "version": "1.0.0"},
        "servers": [{"url": "http://localhost:3000"}],
        "paths": {
            "/": {
                "get": {
                    "summary": "Root endpoint",
                    "responses": {
                        "200": {
                            "description": "Successful response",
                        }
                    },
                }
            },
            "/api/resources": {
                "get": {
                    "summary": "Non-root endpoint without an operationId",
                    "responses": {
                        "200": {
                            "description": "Successful response",
                        }
                    },
                },
                "post": {
                    "summary": "Non-root endpoint with an operationId",
                    "operationId": "createResource",
                    "responses": {
                        "201": {
                            "description": "Resource created",
                        }
                    },
                },
            },
        },
    }
    with app.test_request_context():
        tool_bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)

    assert len(tool_bundles) == 3
    assert tool_bundles[0].operation_id == "<root>_get"
    assert tool_bundles[1].operation_id == "apiresources_get"
    assert tool_bundles[2].operation_id == "createResource"


def test_parse_openapi_to_tool_bundle_properties_all_of(app):
    openapi = {
        "openapi": "3.0.0",
        "info": {"title": "Simple API", "version": "1.0.0"},
        "servers": [{"url": "http://localhost:3000"}],
        "paths": {
            "/api/resource": {
                "get": {
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/Request",
                                },
                            },
                        },
                        "required": True,
                    },
                },
            },
        },
        "components": {
            "schemas": {
                "Request": {
                    "type": "object",
                    "properties": {
                        "prop1": {
                            "enum": ["option1"],
                            "description": "desc prop1",
                            "allOf": [
                                {"$ref": "#/components/schemas/AllOfItem"},
                                {
                                    "enum": ["option2"],
                                },
                            ],
                        },
                    },
                },
                "AllOfItem": {
                    "type": "string",
                    "enum": ["option3"],
                    "description": "desc allOf item",
                },
            }
        },
    }
    with app.test_request_context():
        tool_bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)

    assert tool_bundles[0].parameters[0].type == "string"
    assert tool_bundles[0].parameters[0].llm_description == "desc prop1"
    # TODO: support enum in OpenAPI
    # assert set(tool_bundles[0].parameters[0].options) == {"option1", "option2", "option3"}


def test_parse_openapi_to_tool_bundle_default_value_type_casting(app):
    """
    Test that default values are properly cast to match parameter types.
    This addresses the issue where array default values like [] cause validation errors
    when parameter type is inferred as string/number/boolean.
    """
    openapi = {
        "openapi": "3.0.0",
        "info": {"title": "Test API", "version": "1.0.0"},
        "servers": [{"url": "https://example.com"}],
        "paths": {
            "/product/create": {
                "post": {
                    "operationId": "createProduct",
                    "summary": "Create a product",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "categories": {
                                            "description": "List of category identifiers",
                                            "default": [],
                                            "type": "array",
                                            "items": {"type": "string"},
                                        },
                                        "name": {
                                            "description": "Product name",
                                            "default": "Default Product",
                                            "type": "string",
                                        },
                                        "price": {"description": "Product price", "default": 0.0, "type": "number"},
                                        "available": {
                                            "description": "Product availability",
                                            "default": True,
                                            "type": "boolean",
                                        },
                                    },
                                }
                            }
                        }
                    },
                    "responses": {"200": {"description": "Default Response"}},
                }
            }
        },
    }

    with app.test_request_context():
        tool_bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)

    assert len(tool_bundles) == 1
    bundle = tool_bundles[0]
    assert len(bundle.parameters) == 4

    # Find parameters by name
    params_by_name = {param.name: param for param in bundle.parameters}

    # Check categories parameter (array type with [] default)
    categories_param = params_by_name["categories"]
    assert categories_param.type == "array"  # Will be detected by _get_tool_parameter_type
    assert categories_param.default is None  # Array default [] is converted to None

    # Check name parameter (string type with string default)
    name_param = params_by_name["name"]
    assert name_param.type == "string"
    assert name_param.default == "Default Product"

    # Check price parameter (number type with number default)
    price_param = params_by_name["price"]
    assert price_param.type == "number"
    assert price_param.default == 0.0

    # Check available parameter (boolean type with boolean default)
    available_param = params_by_name["available"]
    assert available_param.type == "boolean"
    assert available_param.default is True


def test_sanitize_default_value_and_type_detection():
    assert ApiBasedToolSchemaParser._sanitize_default_value([]) is None
    assert ApiBasedToolSchemaParser._sanitize_default_value({}) is None
    assert ApiBasedToolSchemaParser._sanitize_default_value("ok") == "ok"

    assert (
        ApiBasedToolSchemaParser._get_tool_parameter_type({"format": "binary"}) == ToolParameter.ToolParameterType.FILE
    )
    assert (
        ApiBasedToolSchemaParser._get_tool_parameter_type({"type": "integer"}) == ToolParameter.ToolParameterType.NUMBER
    )
    assert (
        ApiBasedToolSchemaParser._get_tool_parameter_type({"schema": {"type": "boolean"}})
        == ToolParameter.ToolParameterType.BOOLEAN
    )
    assert (
        ApiBasedToolSchemaParser._get_tool_parameter_type({"type": "array", "items": {"format": "binary"}})
        == ToolParameter.ToolParameterType.FILES
    )
    assert (
        ApiBasedToolSchemaParser._get_tool_parameter_type({"type": "array", "items": {"type": "string"}})
        == ToolParameter.ToolParameterType.ARRAY
    )
    assert ApiBasedToolSchemaParser._get_tool_parameter_type({"type": "object"}) is None


def test_parse_openapi_to_tool_bundle_server_env_and_refs(app):
    openapi = {
        "openapi": "3.0.0",
        "info": {"title": "API", "version": "1.0.0", "description": "API description"},
        "servers": [
            {"url": "https://dev.example.com", "env": "dev"},
            {"url": "https://prod.example.com", "env": "prod"},
        ],
        "paths": {
            "/items": {
                "post": {
                    "description": "Create item",
                    "parameters": [
                        {"$ref": "#/components/parameters/token"},
                        {"name": "token", "schema": {"type": "string"}},
                    ],
                    "requestBody": {
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ItemRequest"}}}
                    },
                }
            }
        },
        "components": {
            "parameters": {
                "token": {"name": "token", "required": True, "schema": {"type": "string"}},
            },
            "schemas": {
                "ItemRequest": {
                    "type": "object",
                    "required": ["age"],
                    "properties": {"age": {"type": "integer", "description": "Age", "default": 18}},
                }
            },
        },
    }

    extra_info: dict = {}
    warning: dict = {}
    with app.test_request_context(headers={"X-Request-Env": "prod"}):
        bundles = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)

    assert len(bundles) == 1
    assert bundles[0].server_url == "https://prod.example.com/items"
    assert warning["duplicated_parameter"].startswith("Parameter token")
    assert extra_info["description"] == "API description"


def test_parse_openapi_to_tool_bundle_no_server_raises(app):
    openapi = {"info": {"title": "x"}, "servers": [], "paths": {}}
    with app.test_request_context():
        with pytest.raises(ToolProviderNotFoundError, match="No server found"):
            ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)


def test_parse_openapi_yaml_to_tool_bundle_invalid_yaml(app):
    with app.test_request_context():
        with pytest.raises(ToolApiSchemaError, match="Invalid openapi yaml"):
            ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle("null")


def test_parse_swagger_to_openapi_branches():
    with pytest.raises(ToolApiSchemaError, match="No server found"):
        ApiBasedToolSchemaParser.parse_swagger_to_openapi({"info": {}, "paths": {}})

    with pytest.raises(ToolApiSchemaError, match="No paths found"):
        ApiBasedToolSchemaParser.parse_swagger_to_openapi({"servers": [{"url": "https://x"}], "paths": {}})

    with pytest.raises(ToolApiSchemaError, match="No operationId found"):
        ApiBasedToolSchemaParser.parse_swagger_to_openapi(
            {
                "servers": [{"url": "https://x"}],
                "paths": {"/a": {"get": {"summary": "x", "responses": {}}}},
            }
        )

    warning: dict = {"seed": True}
    converted = ApiBasedToolSchemaParser.parse_swagger_to_openapi(
        {
            "servers": [{"url": "https://x"}],
            "paths": {"/a": {"get": {"operationId": "getA", "responses": {}}}},
            "definitions": {"A": {"type": "object"}},
        },
        warning=warning,
    )
    assert converted["openapi"] == "3.0.0"
    assert converted["components"]["schemas"]["A"]["type"] == "object"
    assert warning["missing_summary"].startswith("No summary or description found")


def test_parse_openai_plugin_json_branches(app):
    with app.test_request_context():
        with pytest.raises(ToolProviderNotFoundError, match="Invalid openai plugin json"):
            ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle("{bad")

        with pytest.raises(ToolNotSupportedError, match="Only openapi is supported"):
            ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(
                '{"api": {"url": "https://x", "type": "graphql"}}'
            )


def test_parse_openai_plugin_json_http_branches(app):
    with app.test_request_context():
        response = type("Resp", (), {"status_code": 500, "text": "", "close": Mock()})()
        with patch("core.tools.utils.parser.httpx.get", return_value=response):
            with pytest.raises(ToolProviderNotFoundError, match="cannot get openapi yaml"):
                ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(
                    '{"api": {"url": "https://x", "type": "openapi"}}'
                )
        response.close.assert_called_once()

        success_response = type("Resp", (), {"status_code": 200, "text": "openapi: 3.0.0", "close": Mock()})()
        with patch("core.tools.utils.parser.httpx.get", return_value=success_response):
            with patch(
                "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle",
                return_value=["bundle"],
            ) as mock_parse:
                bundles = ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(
                    '{"api": {"url": "https://x", "type": "openapi"}}'
                )
        assert bundles == ["bundle"]
        mock_parse.assert_called_once()
        success_response.close.assert_called_once()


def test_auto_parse_json_yaml_failure():
    with patch("core.tools.utils.parser.json_loads", side_effect=JSONDecodeError("bad", "x", 0)):
        with patch("core.tools.utils.parser.safe_load", side_effect=YAMLError("bad yaml")):
            with pytest.raises(ToolApiSchemaError, match="Invalid api schema, schema is neither json nor yaml"):
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(":::")


def test_auto_parse_openapi_success():
    openapi_content = '{"openapi": "3.0.0", "servers": [{"url": "https://x"}], "info": {"title": "x"}, "paths": {}}'
    with patch(
        "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle",
        return_value=["openapi-bundle"],
    ):
        bundles, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_content)

    assert bundles == ["openapi-bundle"]
    assert schema_type == ApiProviderSchemaType.OPENAPI


def test_auto_parse_openapi_then_swagger():
    openapi_content = '{"openapi": "3.0.0", "servers": [{"url": "https://x"}], "info": {"title": "x"}, "paths": {}}'

    def _openapi_parser(schema, **kwargs):
        if isinstance(schema, str):
            raise ToolApiSchemaError("openapi error")
        return ["swagger-bundle"]

    with patch(
        "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle",
        side_effect=_openapi_parser,
    ):
        with patch(
            "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_swagger_to_openapi",
            return_value={"openapi": "3.0.0", "servers": [{"url": "https://x"}], "info": {"title": "x"}, "paths": {}},
        ):
            bundles, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_content)

    assert bundles == ["swagger-bundle"]
    assert schema_type == ApiProviderSchemaType.OPENAPI


def test_auto_parse_openapi_swagger_then_plugin():
    openapi_content = '{"openapi": "3.0.0", "servers": [{"url": "https://x"}], "info": {"title": "x"}, "paths": {}}'
    with patch(
        "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle",
        side_effect=ToolApiSchemaError("openapi error"),
    ):
        with patch(
            "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_swagger_to_openapi",
            side_effect=ToolApiSchemaError("swagger error"),
        ):
            with patch(
                "core.tools.utils.parser.ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle",
                return_value=["plugin-bundle"],
            ):
                bundles, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_content)

    assert bundles == ["plugin-bundle"]
    assert schema_type == ApiProviderSchemaType.OPENAI_PLUGIN
