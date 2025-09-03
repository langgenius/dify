from io import BytesIO
from typing import Any

from flask import Request, Response
from werkzeug.datastructures import Headers


def serialize_request(request: Request) -> bytes:
    """
    Convert a Request object to raw HTTP data.

    Args:
        request: The Request object to convert.

    Returns:
        The raw HTTP data as bytes.
    """
    # Start with the request line
    method = request.method
    path = request.full_path
    # Remove trailing ? if there's no query string
    path = path.removesuffix("?")
    protocol = request.headers.get("HTTP_VERSION", "HTTP/1.1")
    raw_data = f"{method} {path} {protocol}\r\n".encode()

    # Add headers
    for header_name, header_value in request.headers.items():
        raw_data += f"{header_name}: {header_value}\r\n".encode()

    # Add empty line to separate headers from body
    raw_data += b"\r\n"

    # Add body if exists
    body = request.get_data(as_text=False)
    if body:
        raw_data += body

    return raw_data


def deserialize_request(raw_data: bytes) -> Request:
    """
    Convert raw HTTP data to a Request object.

    Args:
        raw_data: The raw HTTP data as bytes.

    Returns:
        A Flask Request object.
    """
    lines = raw_data.split(b"\r\n")

    # Parse request line
    request_line = lines[0].decode("utf-8")
    parts = request_line.split(" ", 2)  # Split into max 3 parts
    if len(parts) < 2:
        raise ValueError(f"Invalid request line: {request_line}")

    method = parts[0]
    path = parts[1]
    protocol = parts[2] if len(parts) > 2 else "HTTP/1.1"

    # Parse headers
    headers = Headers()
    body_start = 0
    for i in range(1, len(lines)):
        line = lines[i]
        if line == b"":
            body_start = i + 1
            break
        if b":" in line:
            header_line = line.decode("utf-8")
            name, value = header_line.split(":", 1)
            headers[name.strip()] = value.strip()

    # Extract body
    body = b""
    if body_start > 0 and body_start < len(lines):
        body = b"\r\n".join(lines[body_start:])

    # Create environ for Request
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path.split("?")[0] if "?" in path else path,
        "QUERY_STRING": path.split("?")[1] if "?" in path else "",
        "SERVER_NAME": headers.get("Host", "localhost").split(":")[0],
        "SERVER_PORT": headers.get("Host", "localhost:80").split(":")[1] if ":" in headers.get("Host", "") else "80",
        "SERVER_PROTOCOL": protocol,
        "wsgi.input": BytesIO(body),
        "wsgi.url_scheme": "https" if headers.get("X-Forwarded-Proto") == "https" else "http",
        "CONTENT_LENGTH": str(len(body)) if body else "0",
        "CONTENT_TYPE": headers.get("Content-Type", ""),
    }

    # Add headers to environ
    for header_name, header_value in headers.items():
        env_name = f"HTTP_{header_name.upper().replace('-', '_')}"
        if header_name.upper() not in ["CONTENT-TYPE", "CONTENT-LENGTH"]:
            environ[env_name] = header_value

    return Request(environ)


def serialize_response(response: Response) -> bytes:
    """
    Convert a Response object to raw HTTP data.

    Args:
        response: The Response object to convert.

    Returns:
        The raw HTTP data as bytes.
    """
    # Start with the status line
    protocol = "HTTP/1.1"
    status_code = response.status_code
    status_text = response.status.split(" ", 1)[1] if " " in response.status else "OK"
    raw_data = f"{protocol} {status_code} {status_text}\r\n".encode()

    # Add headers
    for header_name, header_value in response.headers.items():
        raw_data += f"{header_name}: {header_value}\r\n".encode()

    # Add empty line to separate headers from body
    raw_data += b"\r\n"

    # Add body if exists
    body = response.get_data(as_text=False)
    if body:
        raw_data += body

    return raw_data


def deserialize_response(raw_data: bytes) -> Response:
    """
    Convert raw HTTP data to a Response object.

    Args:
        raw_data: The raw HTTP data as bytes.

    Returns:
        A Flask Response object.
    """
    lines = raw_data.split(b"\r\n")

    # Parse status line
    status_line = lines[0].decode("utf-8")
    parts = status_line.split(" ", 2)
    if len(parts) < 2:
        raise ValueError(f"Invalid status line: {status_line}")

    status_code = int(parts[1])

    # Parse headers
    headers: dict[str, Any] = {}
    body_start = 0
    for i in range(1, len(lines)):
        line = lines[i]
        if line == b"":
            body_start = i + 1
            break
        if b":" in line:
            header_line = line.decode("utf-8")
            name, value = header_line.split(":", 1)
            headers[name.strip()] = value.strip()

    # Extract body
    body = b""
    if body_start > 0 and body_start < len(lines):
        body = b"\r\n".join(lines[body_start:])

    # Create Response object
    response = Response(
        response=body,
        status=status_code,
        headers=headers,
    )

    return response
