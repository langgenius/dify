import pytest
from flask import Request, Response

from core.plugin.utils.http_parser import (
    deserialize_request,
    deserialize_response,
    serialize_request,
    serialize_response,
)


class TestSerializeRequest:
    def test_serialize_simple_get_request(self):
        # Create a simple GET request
        environ = {
            "REQUEST_METHOD": "GET",
            "PATH_INFO": "/api/test",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": None,
            "wsgi.url_scheme": "http",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert raw_data.startswith(b"GET /api/test HTTP/1.1\r\n")
        assert b"\r\n\r\n" in raw_data  # Empty line between headers and body

    def test_serialize_request_with_query_params(self):
        # Create a GET request with query parameters
        environ = {
            "REQUEST_METHOD": "GET",
            "PATH_INFO": "/api/search",
            "QUERY_STRING": "q=test&limit=10",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": None,
            "wsgi.url_scheme": "http",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert raw_data.startswith(b"GET /api/search?q=test&limit=10 HTTP/1.1\r\n")

    def test_serialize_post_request_with_body(self):
        # Create a POST request with body
        from io import BytesIO

        body = b'{"name": "test", "value": 123}'
        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/api/data",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "http",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": "application/json",
            "HTTP_CONTENT_TYPE": "application/json",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert b"POST /api/data HTTP/1.1\r\n" in raw_data
        assert b"Content-Type: application/json" in raw_data
        assert raw_data.endswith(body)

    def test_serialize_request_with_custom_headers(self):
        # Create a request with custom headers
        environ = {
            "REQUEST_METHOD": "GET",
            "PATH_INFO": "/api/test",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": None,
            "wsgi.url_scheme": "http",
            "HTTP_AUTHORIZATION": "Bearer token123",
            "HTTP_X_CUSTOM_HEADER": "custom-value",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert b"Authorization: Bearer token123" in raw_data
        assert b"X-Custom-Header: custom-value" in raw_data


class TestDeserializeRequest:
    def test_deserialize_simple_get_request(self):
        raw_data = b"GET /api/test HTTP/1.1\r\nHost: localhost:8000\r\n\r\n"

        request = deserialize_request(raw_data)

        assert request.method == "GET"
        assert request.path == "/api/test"
        assert request.headers.get("Host") == "localhost:8000"

    def test_deserialize_request_with_query_params(self):
        raw_data = b"GET /api/search?q=test&limit=10 HTTP/1.1\r\nHost: example.com\r\n\r\n"

        request = deserialize_request(raw_data)

        assert request.method == "GET"
        assert request.path == "/api/search"
        assert request.query_string == b"q=test&limit=10"
        assert request.args.get("q") == "test"
        assert request.args.get("limit") == "10"

    def test_deserialize_post_request_with_body(self):
        body = b'{"name": "test", "value": 123}'
        raw_data = (
            b"POST /api/data HTTP/1.1\r\n"
            b"Host: localhost\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"
            b"\r\n" + body
        )

        request = deserialize_request(raw_data)

        assert request.method == "POST"
        assert request.path == "/api/data"
        assert request.content_type == "application/json"
        assert request.get_data() == body

    def test_deserialize_request_with_custom_headers(self):
        raw_data = (
            b"GET /api/protected HTTP/1.1\r\n"
            b"Host: api.example.com\r\n"
            b"Authorization: Bearer token123\r\n"
            b"X-Custom-Header: custom-value\r\n"
            b"User-Agent: TestClient/1.0\r\n"
            b"\r\n"
        )

        request = deserialize_request(raw_data)

        assert request.method == "GET"
        assert request.headers.get("Authorization") == "Bearer token123"
        assert request.headers.get("X-Custom-Header") == "custom-value"
        assert request.headers.get("User-Agent") == "TestClient/1.0"

    def test_deserialize_request_with_multiline_body(self):
        body = b"line1\r\nline2\r\nline3"
        raw_data = b"PUT /api/text HTTP/1.1\r\nHost: localhost\r\nContent-Type: text/plain\r\n\r\n" + body

        request = deserialize_request(raw_data)

        assert request.method == "PUT"
        assert request.get_data() == body

    def test_deserialize_invalid_request_line(self):
        raw_data = b"INVALID\r\n\r\n"  # Only one part, should fail

        with pytest.raises(ValueError, match="Invalid request line"):
            deserialize_request(raw_data)

    def test_roundtrip_request(self):
        # Test that serialize -> deserialize produces equivalent request
        from io import BytesIO

        body = b"test body content"
        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/api/echo",
            "QUERY_STRING": "format=json",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8080",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "http",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": "text/plain",
            "HTTP_CONTENT_TYPE": "text/plain",
            "HTTP_X_REQUEST_ID": "req-123",
        }
        original_request = Request(environ)

        # Serialize and deserialize
        raw_data = serialize_request(original_request)
        restored_request = deserialize_request(raw_data)

        # Verify key properties are preserved
        assert restored_request.method == original_request.method
        assert restored_request.path == original_request.path
        assert restored_request.query_string == original_request.query_string
        assert restored_request.get_data() == body
        assert restored_request.headers.get("X-Request-Id") == "req-123"


class TestSerializeResponse:
    def test_serialize_simple_response(self):
        response = Response("Hello, World!", status=200)

        raw_data = serialize_response(response)

        assert raw_data.startswith(b"HTTP/1.1 200 OK\r\n")
        assert b"\r\n\r\n" in raw_data
        assert raw_data.endswith(b"Hello, World!")

    def test_serialize_response_with_headers(self):
        response = Response(
            '{"status": "success"}',
            status=201,
            headers={
                "Content-Type": "application/json",
                "X-Request-Id": "req-456",
            },
        )

        raw_data = serialize_response(response)

        assert b"HTTP/1.1 201 CREATED\r\n" in raw_data
        assert b"Content-Type: application/json" in raw_data
        assert b"X-Request-Id: req-456" in raw_data
        assert raw_data.endswith(b'{"status": "success"}')

    def test_serialize_error_response(self):
        response = Response(
            "Not Found",
            status=404,
            headers={"Content-Type": "text/plain"},
        )

        raw_data = serialize_response(response)

        assert b"HTTP/1.1 404 NOT FOUND\r\n" in raw_data
        assert b"Content-Type: text/plain" in raw_data
        assert raw_data.endswith(b"Not Found")

    def test_serialize_response_without_body(self):
        response = Response(status=204)  # No Content

        raw_data = serialize_response(response)

        assert b"HTTP/1.1 204 NO CONTENT\r\n" in raw_data
        assert raw_data.endswith(b"\r\n\r\n")  # Should end with empty line

    def test_serialize_response_with_binary_body(self):
        binary_data = b"\x00\x01\x02\x03\x04\x05"
        response = Response(
            binary_data,
            status=200,
            headers={"Content-Type": "application/octet-stream"},
        )

        raw_data = serialize_response(response)

        assert b"HTTP/1.1 200 OK\r\n" in raw_data
        assert b"Content-Type: application/octet-stream" in raw_data
        assert raw_data.endswith(binary_data)


class TestDeserializeResponse:
    def test_deserialize_simple_response(self):
        raw_data = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello, World!"

        response = deserialize_response(raw_data)

        assert response.status_code == 200
        assert response.get_data() == b"Hello, World!"
        assert response.headers.get("Content-Type") == "text/plain"

    def test_deserialize_response_with_json(self):
        body = b'{"result": "success", "data": [1, 2, 3]}'
        raw_data = (
            b"HTTP/1.1 201 Created\r\n"
            b"Content-Type: application/json\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"
            b"X-Custom-Header: test-value\r\n"
            b"\r\n" + body
        )

        response = deserialize_response(raw_data)

        assert response.status_code == 201
        assert response.get_data() == body
        assert response.headers.get("Content-Type") == "application/json"
        assert response.headers.get("X-Custom-Header") == "test-value"

    def test_deserialize_error_response(self):
        raw_data = b"HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\n\r\n<html><body>Page not found</body></html>"

        response = deserialize_response(raw_data)

        assert response.status_code == 404
        assert response.get_data() == b"<html><body>Page not found</body></html>"

    def test_deserialize_response_without_body(self):
        raw_data = b"HTTP/1.1 204 No Content\r\n\r\n"

        response = deserialize_response(raw_data)

        assert response.status_code == 204
        assert response.get_data() == b""

    def test_deserialize_response_with_multiline_body(self):
        body = b"Line 1\r\nLine 2\r\nLine 3"
        raw_data = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\n" + body

        response = deserialize_response(raw_data)

        assert response.status_code == 200
        assert response.get_data() == body

    def test_deserialize_response_minimal_status_line(self):
        # Test with minimal status line (no status text)
        raw_data = b"HTTP/1.1 200\r\n\r\nOK"

        response = deserialize_response(raw_data)

        assert response.status_code == 200
        assert response.get_data() == b"OK"

    def test_deserialize_invalid_status_line(self):
        raw_data = b"INVALID\r\n\r\n"

        with pytest.raises(ValueError, match="Invalid status line"):
            deserialize_response(raw_data)

    def test_roundtrip_response(self):
        # Test that serialize -> deserialize produces equivalent response
        original_response = Response(
            '{"message": "test"}',
            status=200,
            headers={
                "Content-Type": "application/json",
                "X-Request-Id": "abc-123",
                "Cache-Control": "no-cache",
            },
        )

        # Serialize and deserialize
        raw_data = serialize_response(original_response)
        restored_response = deserialize_response(raw_data)

        # Verify key properties are preserved
        assert restored_response.status_code == original_response.status_code
        assert restored_response.get_data() == original_response.get_data()
        assert restored_response.headers.get("Content-Type") == "application/json"
        assert restored_response.headers.get("X-Request-Id") == "abc-123"
        assert restored_response.headers.get("Cache-Control") == "no-cache"


class TestEdgeCases:
    def test_request_with_empty_headers(self):
        raw_data = b"GET / HTTP/1.1\r\n\r\n"

        request = deserialize_request(raw_data)

        assert request.method == "GET"
        assert request.path == "/"

    def test_response_with_empty_headers(self):
        raw_data = b"HTTP/1.1 200 OK\r\n\r\nSuccess"

        response = deserialize_response(raw_data)

        assert response.status_code == 200
        assert response.get_data() == b"Success"

    def test_request_with_special_characters_in_path(self):
        raw_data = b"GET /api/test%20path?key=%26value HTTP/1.1\r\n\r\n"

        request = deserialize_request(raw_data)

        assert request.method == "GET"
        assert "/api/test%20path" in request.full_path

    def test_response_with_binary_content(self):
        binary_body = bytes(range(256))  # All possible byte values
        raw_data = b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n" + binary_body

        response = deserialize_response(raw_data)

        assert response.status_code == 200
        assert response.get_data() == binary_body


class TestFileUploads:
    def test_serialize_request_with_text_file_upload(self):
        # Test multipart/form-data request with text file
        from io import BytesIO

        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        text_content = "Hello, this is a test file content!\nWith multiple lines."
        body = (
            f"------{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n'
            f"Content-Type: text/plain\r\n"
            f"\r\n"
            f"{text_content}\r\n"
            f"------{boundary}\r\n"
            f'Content-Disposition: form-data; name="description"\r\n'
            f"\r\n"
            f"Test file upload\r\n"
            f"------{boundary}--\r\n"
        ).encode()

        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/api/upload",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "http",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert b"POST /api/upload HTTP/1.1\r\n" in raw_data
        assert f"Content-Type: multipart/form-data; boundary={boundary}".encode() in raw_data
        assert b'Content-Disposition: form-data; name="file"; filename="test.txt"' in raw_data
        assert text_content.encode() in raw_data

    def test_deserialize_request_with_text_file_upload(self):
        # Test deserializing multipart/form-data request with text file
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        text_content = "Sample text file content\nLine 2\nLine 3"
        body = (
            f"------{boundary}\r\n"
            f'Content-Disposition: form-data; name="document"; filename="document.txt"\r\n'
            f"Content-Type: text/plain\r\n"
            f"\r\n"
            f"{text_content}\r\n"
            f"------{boundary}\r\n"
            f'Content-Disposition: form-data; name="title"\r\n'
            f"\r\n"
            f"My Document\r\n"
            f"------{boundary}--\r\n"
        ).encode()

        raw_data = (
            b"POST /api/documents HTTP/1.1\r\n"
            b"Host: example.com\r\n"
            b"Content-Type: multipart/form-data; boundary=" + boundary.encode() + b"\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"
            b"\r\n" + body
        )

        request = deserialize_request(raw_data)

        assert request.method == "POST"
        assert request.path == "/api/documents"
        assert "multipart/form-data" in request.content_type
        # The body should contain the multipart data
        request_body = request.get_data()
        assert b"document.txt" in request_body
        assert text_content.encode() in request_body

    def test_serialize_request_with_binary_file_upload(self):
        # Test multipart/form-data request with binary file (e.g., image)
        from io import BytesIO

        boundary = "----BoundaryString123"
        # Simulate a small PNG file header
        binary_content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10"

        # Build multipart body
        body_parts = []
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="image"; filename="test.png"')
        body_parts.append(b"Content-Type: image/png")
        body_parts.append(b"")
        body_parts.append(binary_content)
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="caption"')
        body_parts.append(b"")
        body_parts.append(b"Test image")
        body_parts.append(f"------{boundary}--".encode())

        body = b"\r\n".join(body_parts)

        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/api/images",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "http",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert b"POST /api/images HTTP/1.1\r\n" in raw_data
        assert f"Content-Type: multipart/form-data; boundary={boundary}".encode() in raw_data
        assert b'filename="test.png"' in raw_data
        assert b"Content-Type: image/png" in raw_data
        assert binary_content in raw_data

    def test_deserialize_request_with_binary_file_upload(self):
        # Test deserializing multipart/form-data request with binary file
        boundary = "----BoundaryABC123"
        # Simulate a small JPEG file header
        binary_content = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"

        body_parts = []
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="photo"; filename="photo.jpg"')
        body_parts.append(b"Content-Type: image/jpeg")
        body_parts.append(b"")
        body_parts.append(binary_content)
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="album"')
        body_parts.append(b"")
        body_parts.append(b"Vacation 2024")
        body_parts.append(f"------{boundary}--".encode())

        body = b"\r\n".join(body_parts)

        raw_data = (
            b"POST /api/photos HTTP/1.1\r\n"
            b"Host: api.example.com\r\n"
            b"Content-Type: multipart/form-data; boundary=" + boundary.encode() + b"\r\n"
            b"Content-Length: " + str(len(body)).encode() + b"\r\n"
            b"Accept: application/json\r\n"
            b"\r\n" + body
        )

        request = deserialize_request(raw_data)

        assert request.method == "POST"
        assert request.path == "/api/photos"
        assert "multipart/form-data" in request.content_type
        assert request.headers.get("Accept") == "application/json"

        # Verify the binary content is preserved
        request_body = request.get_data()
        assert b"photo.jpg" in request_body
        assert b"image/jpeg" in request_body
        assert binary_content in request_body
        assert b"Vacation 2024" in request_body

    def test_serialize_request_with_multiple_files(self):
        # Test request with multiple file uploads
        from io import BytesIO

        boundary = "----MultiFilesBoundary"
        text_file = b"Text file contents"
        binary_file = b"\x00\x01\x02\x03\x04\x05"

        body_parts = []
        # First file (text)
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="files"; filename="doc.txt"')
        body_parts.append(b"Content-Type: text/plain")
        body_parts.append(b"")
        body_parts.append(text_file)
        # Second file (binary)
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="files"; filename="data.bin"')
        body_parts.append(b"Content-Type: application/octet-stream")
        body_parts.append(b"")
        body_parts.append(binary_file)
        # Additional form field
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="folder"')
        body_parts.append(b"")
        body_parts.append(b"uploads/2024")
        body_parts.append(f"------{boundary}--".encode())

        body = b"\r\n".join(body_parts)

        environ = {
            "REQUEST_METHOD": "POST",
            "PATH_INFO": "/api/batch-upload",
            "QUERY_STRING": "",
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "8000",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "https",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
        request = Request(environ)

        raw_data = serialize_request(request)

        assert b"POST /api/batch-upload HTTP/1.1\r\n" in raw_data
        assert b"doc.txt" in raw_data
        assert b"data.bin" in raw_data
        assert text_file in raw_data
        assert binary_file in raw_data
        assert b"uploads/2024" in raw_data

    def test_roundtrip_file_upload_request(self):
        # Test that file upload request survives serialize -> deserialize
        from io import BytesIO

        boundary = "----RoundTripBoundary"
        file_content = b"This is my file content with special chars: \xf0\x9f\x98\x80"

        body_parts = []
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="upload"; filename="emoji.txt"')
        body_parts.append(b"Content-Type: text/plain; charset=utf-8")
        body_parts.append(b"")
        body_parts.append(file_content)
        body_parts.append(f"------{boundary}".encode())
        body_parts.append(b'Content-Disposition: form-data; name="metadata"')
        body_parts.append(b"")
        body_parts.append(b'{"encoding": "utf-8", "size": 42}')
        body_parts.append(f"------{boundary}--".encode())

        body = b"\r\n".join(body_parts)

        environ = {
            "REQUEST_METHOD": "PUT",
            "PATH_INFO": "/api/files/123",
            "QUERY_STRING": "version=2",
            "SERVER_NAME": "storage.example.com",
            "SERVER_PORT": "443",
            "wsgi.input": BytesIO(body),
            "wsgi.url_scheme": "https",
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_CONTENT_TYPE": f"multipart/form-data; boundary={boundary}",
            "HTTP_AUTHORIZATION": "Bearer token123",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
        original_request = Request(environ)

        # Serialize and deserialize
        raw_data = serialize_request(original_request)
        restored_request = deserialize_request(raw_data)

        # Verify the request is preserved
        assert restored_request.method == "PUT"
        assert restored_request.path == "/api/files/123"
        assert restored_request.query_string == b"version=2"
        assert "multipart/form-data" in restored_request.content_type
        assert boundary in restored_request.content_type

        # Verify file content is preserved
        restored_body = restored_request.get_data()
        assert b"emoji.txt" in restored_body
        assert file_content in restored_body
        assert b'{"encoding": "utf-8", "size": 42}' in restored_body
