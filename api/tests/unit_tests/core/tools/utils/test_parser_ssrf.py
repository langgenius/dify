"""Unit tests for SSRF protection in API schema parser."""

import pytest
from flask import Flask

from core.tools.errors import ToolSSRFError
from core.tools.utils.parser import ApiBasedToolSchemaParser


@pytest.fixture
def flask_app():
    """Create a Flask app for testing."""
    app = Flask(__name__)
    return app


class TestApiSchemaParserSSRF:
    """Test SSRF protection in API schema parser."""

    def test_openapi_with_private_ip_blocked(self, flask_app):
        """Test that OpenAPI schema with private IP is blocked."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: http://192.168.1.1/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)

            assert "192.168.1.1" in str(exc_info.value)
            assert "private or local network address" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_with_localhost_blocked(self, flask_app):
        """Test that OpenAPI schema with localhost is blocked."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: http://localhost:8080/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)

            assert "localhost" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_with_local_domain_blocked(self, flask_app):
        """Test that OpenAPI schema with .local domain is blocked."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: http://myserver.local/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)

            assert "myserver.local" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_with_10_network_blocked(self, flask_app):
        """Test that OpenAPI schema with 10.x.x.x network is blocked."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: http://10.0.0.5/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)

            assert "10.0.0.5" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_with_public_url_allowed(self, flask_app):
        """Test that OpenAPI schema with public URL is allowed."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            # Should not raise any exception
            result, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)
            assert result is not None
            assert len(result) > 0

    def test_swagger_with_private_ip_blocked(self, flask_app):
        """Test that Swagger schema with private IP is blocked."""
        swagger_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: http://172.16.0.1/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(swagger_schema)

            assert "172.16.0.1" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_with_multiple_servers_one_private(self, flask_app):
        """Test that OpenAPI with multiple servers including one private is blocked."""
        openapi_schema = """
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
  - url: http://192.168.1.100/api
paths:
  /test:
    get:
      summary: Test endpoint
      operationId: testGet
      responses:
        '200':
          description: Success
"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_schema)

            assert "192.168.1.100" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)

    def test_openapi_json_format_with_private_ip_blocked(self, flask_app):
        """Test that JSON format OpenAPI schema with private IP is blocked."""
        openapi_json = """{
  "openapi": "3.0.0",
  "info": {
    "title": "Test API",
    "version": "1.0.0"
  },
  "servers": [
    {
      "url": "http://127.0.0.1:8080/api"
    }
  ],
  "paths": {
    "/test": {
      "get": {
        "summary": "Test endpoint",
        "operationId": "testGet",
        "responses": {
          "200": {
            "description": "Success"
          }
        }
      }
    }
  }
}"""
        with flask_app.test_request_context():
            with pytest.raises(ToolSSRFError) as exc_info:
                ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(openapi_json)

            assert "127.0.0.1" in str(exc_info.value)
            assert "SSRF protection" in str(exc_info.value)
