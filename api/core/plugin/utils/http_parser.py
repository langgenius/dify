from io import BytesIO

from flask import Request, Response
from werkzeug.datastructures import Headers


def serialize_request(request: Request) -> bytes:
    method = request.method
    path = request.full_path.rstrip("?")
    raw = f"{method} {path} HTTP/1.1\r\n".encode()

    for name, value in request.headers.items():
        raw += f"{name}: {value}\r\n".encode()

    raw += b"\r\n"

    body = request.get_data(as_text=False)
    if body:
        raw += body

    return raw


def deserialize_request(raw_data: bytes) -> Request:
    header_end = raw_data.find(b"\r\n\r\n")
    if header_end == -1:
        header_end = raw_data.find(b"\n\n")
        if header_end == -1:
            header_data = raw_data
            body = b""
        else:
            header_data = raw_data[:header_end]
            body = raw_data[header_end + 2 :]
    else:
        header_data = raw_data[:header_end]
        body = raw_data[header_end + 4 :]

    lines = header_data.split(b"\r\n")
    if len(lines) == 1 and b"\n" in lines[0]:
        lines = header_data.split(b"\n")

    if not lines or not lines[0]:
        raise ValueError("Empty HTTP request")

    request_line = lines[0].decode("utf-8", errors="ignore")
    parts = request_line.split(" ", 2)
    if len(parts) < 2:
        raise ValueError(f"Invalid request line: {request_line}")

    method = parts[0]
    full_path = parts[1]
    protocol = parts[2] if len(parts) > 2 else "HTTP/1.1"

    if "?" in full_path:
        path, query_string = full_path.split("?", 1)
    else:
        path = full_path
        query_string = ""

    headers = Headers()
    for line in lines[1:]:
        if not line:
            continue
        line_str = line.decode("utf-8", errors="ignore")
        if ":" not in line_str:
            continue
        name, value = line_str.split(":", 1)
        headers.add(name, value.strip())

    host = headers.get("Host", "localhost")
    if ":" in host:
        server_name, server_port = host.rsplit(":", 1)
    else:
        server_name = host
        server_port = "80"

    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": query_string,
        "SERVER_NAME": server_name,
        "SERVER_PORT": server_port,
        "SERVER_PROTOCOL": protocol,
        "wsgi.input": BytesIO(body),
        "wsgi.url_scheme": "http",
    }

    if "Content-Type" in headers:
        content_type = headers.get("Content-Type")
        if content_type is not None:
            environ["CONTENT_TYPE"] = content_type

    if "Content-Length" in headers:
        content_length = headers.get("Content-Length")
        if content_length is not None:
            environ["CONTENT_LENGTH"] = content_length
    elif body:
        environ["CONTENT_LENGTH"] = str(len(body))

    for name, value in headers.items():
        if name.upper() in ("CONTENT-TYPE", "CONTENT-LENGTH"):
            continue
        env_name = f"HTTP_{name.upper().replace('-', '_')}"
        environ[env_name] = value

    return Request(environ)


def serialize_response(response: Response) -> bytes:
    raw = f"HTTP/1.1 {response.status}\r\n".encode()

    for name, value in response.headers.items():
        raw += f"{name}: {value}\r\n".encode()

    raw += b"\r\n"

    body = response.get_data(as_text=False)
    if body:
        raw += body

    return raw


def deserialize_response(raw_data: bytes) -> Response:
    header_end = raw_data.find(b"\r\n\r\n")
    if header_end == -1:
        header_end = raw_data.find(b"\n\n")
        if header_end == -1:
            header_data = raw_data
            body = b""
        else:
            header_data = raw_data[:header_end]
            body = raw_data[header_end + 2 :]
    else:
        header_data = raw_data[:header_end]
        body = raw_data[header_end + 4 :]

    lines = header_data.split(b"\r\n")
    if len(lines) == 1 and b"\n" in lines[0]:
        lines = header_data.split(b"\n")

    if not lines or not lines[0]:
        raise ValueError("Empty HTTP response")

    status_line = lines[0].decode("utf-8", errors="ignore")
    parts = status_line.split(" ", 2)
    if len(parts) < 2:
        raise ValueError(f"Invalid status line: {status_line}")

    status_code = int(parts[1])

    response = Response(response=body, status=status_code)

    for line in lines[1:]:
        if not line:
            continue
        line_str = line.decode("utf-8", errors="ignore")
        if ":" not in line_str:
            continue
        name, value = line_str.split(":", 1)
        response.headers[name] = value.strip()

    return response
