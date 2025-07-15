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
