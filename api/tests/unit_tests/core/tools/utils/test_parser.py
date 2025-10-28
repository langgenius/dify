import pytest
from flask import Flask

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
