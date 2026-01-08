import base64
import json
import secrets
import string
from collections.abc import Mapping
from copy import deepcopy
from typing import Any, Literal
from urllib.parse import urlencode, urlparse

import httpx
from json_repair import repair_json

from configs import dify_config
from core.file import file_manager
from core.file.enums import FileTransferMethod
from core.helper import ssrf_proxy
from core.variables.segments import ArrayFileSegment, FileSegment
from core.workflow.runtime import VariablePool

from ..protocols import FileManagerProtocol, HttpClientProtocol
from .entities import (
    HttpRequestNodeAuthorization,
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from .exc import (
    AuthorizationConfigError,
    FileFetchError,
    HttpRequestNodeError,
    InvalidHttpMethodError,
    InvalidURLError,
    RequestBodyError,
    ResponseSizeError,
)

BODY_TYPE_TO_CONTENT_TYPE = {
    "json": "application/json",
    "x-www-form-urlencoded": "application/x-www-form-urlencoded",
    "form-data": "multipart/form-data",
    "raw-text": "text/plain",
}


class Executor:
    method: Literal[
        "get",
        "head",
        "post",
        "put",
        "delete",
        "patch",
        "options",
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
    ]
    url: str
    params: list[tuple[str, str]] | None
    content: str | bytes | None
    data: Mapping[str, Any] | None
    files: list[tuple[str, tuple[str | None, bytes, str]]] | None
    json: Any
    headers: dict[str, str]
    auth: HttpRequestNodeAuthorization
    timeout: HttpRequestNodeTimeout
    max_retries: int

    boundary: str

    def __init__(
        self,
        *,
        node_data: HttpRequestNodeData,
        timeout: HttpRequestNodeTimeout,
        variable_pool: VariablePool,
        max_retries: int = dify_config.SSRF_DEFAULT_MAX_RETRIES,
        http_client: HttpClientProtocol = ssrf_proxy,
        file_manager: FileManagerProtocol = file_manager,
    ):
        # If authorization API key is present, convert the API key using the variable pool
        if node_data.authorization.type == "api-key":
            if node_data.authorization.config is None:
                raise AuthorizationConfigError("authorization config is required")
            node_data.authorization.config.api_key = variable_pool.convert_template(
                node_data.authorization.config.api_key
            ).text
            # Validate that API key is not empty after template conversion
            if not node_data.authorization.config.api_key or not node_data.authorization.config.api_key.strip():
                raise AuthorizationConfigError(
                    "API key is required for authorization but was empty. Please provide a valid API key."
                )

        self.url = node_data.url
        self.method = node_data.method
        self.auth = node_data.authorization
        self.timeout = timeout
        self.ssl_verify = node_data.ssl_verify
        self.params = None
        self.headers = {}
        self.content = None
        self.files = None
        self.data = None
        self.json = None
        self.max_retries = max_retries
        self._http_client = http_client
        self._file_manager = file_manager

        # init template
        self.variable_pool = variable_pool
        self.node_data = node_data
        self._initialize()

    def _initialize(self):
        self._init_url()
        self._init_params()
        self._init_headers()
        self._init_body()

    def _init_url(self):
        self.url = self.variable_pool.convert_template(self.node_data.url).text

        # check if url is a valid URL
        if not self.url:
            raise InvalidURLError("url is required")
        if not self.url.startswith(("http://", "https://")):
            raise InvalidURLError("url should start with http:// or https://")

    def _init_params(self):
        """
        Almost same as _init_headers(), difference:
        1. response a list tuple to support same key, like 'aa=1&aa=2'
        2. param value may have '\n', we need to splitlines then extract the variable value.
        """
        result = []
        for line in self.node_data.params.splitlines():
            if not (line := line.strip()):
                continue

            key, *value = line.split(":", 1)
            if not (key := key.strip()):
                continue

            value_str = value[0].strip() if value else ""
            result.append(
                (self.variable_pool.convert_template(key).text, self.variable_pool.convert_template(value_str).text)
            )

        if result:
            self.params = result

    def _init_headers(self):
        """
        Convert the header string of frontend to a dictionary.

        Each line in the header string represents a key-value pair.
        Keys and values are separated by ':'.
        Empty values are allowed.

        Examples:
            'aa:bb\n cc:dd'  -> {'aa': 'bb', 'cc': 'dd'}
            'aa:\n cc:dd\n'  -> {'aa': '', 'cc': 'dd'}
            'aa\n cc : dd'   -> {'aa': '', 'cc': 'dd'}

        """
        headers = self.variable_pool.convert_template(self.node_data.headers).text
        self.headers = {
            key.strip(): (value[0].strip() if value else "")
            for line in headers.splitlines()
            if line.strip()
            for key, *value in [line.split(":", 1)]
        }

    def _init_body(self):
        body = self.node_data.body
        if body is not None:
            data = body.data
            match body.type:
                case "none":
                    self.content = ""
                case "raw-text":
                    if len(data) != 1:
                        raise RequestBodyError("raw-text body type should have exactly one item")
                    self.content = self.variable_pool.convert_template(data[0].value).text
                case "json":
                    if len(data) != 1:
                        raise RequestBodyError("json body type should have exactly one item")
                    json_string = self.variable_pool.convert_template(data[0].value).text
                    try:
                        repaired = repair_json(json_string)
                        json_object = json.loads(repaired, strict=False)
                    except json.JSONDecodeError as e:
                        raise RequestBodyError(f"Failed to parse JSON: {json_string}") from e
                    self.json = json_object
                    # self.json = self._parse_object_contains_variables(json_object)
                case "binary":
                    if len(data) != 1:
                        raise RequestBodyError("binary body type should have exactly one item")
                    file_selector = data[0].file
                    file_variable = self.variable_pool.get_file(file_selector)
                    if file_variable is None:
                        raise FileFetchError(f"cannot fetch file with selector {file_selector}")
                    file = file_variable.value
                    self.content = self._file_manager.download(file)
                case "x-www-form-urlencoded":
                    form_data = {
                        self.variable_pool.convert_template(item.key).text: self.variable_pool.convert_template(
                            item.value
                        ).text
                        for item in data
                    }
                    self.data = form_data
                case "form-data":
                    form_data = {
                        self.variable_pool.convert_template(item.key).text: self.variable_pool.convert_template(
                            item.value
                        ).text
                        for item in filter(lambda item: item.type == "text", data)
                    }
                    file_selectors = {
                        self.variable_pool.convert_template(item.key).text: item.file
                        for item in filter(lambda item: item.type == "file", data)
                    }

                    # get files from file_selectors, add support for array file variables
                    files_list = []
                    for key, selector in file_selectors.items():
                        segment = self.variable_pool.get(selector)
                        if isinstance(segment, FileSegment):
                            files_list.append((key, [segment.value]))
                        elif isinstance(segment, ArrayFileSegment):
                            files_list.append((key, list(segment.value)))

                    # get files from file_manager
                    files: dict[str, list[tuple[str | None, bytes, str]]] = {}
                    for key, files_in_segment in files_list:
                        for file in files_in_segment:
                            if file.related_id is not None or (
                                file.transfer_method == FileTransferMethod.REMOTE_URL and file.remote_url is not None
                            ):
                                file_tuple = (
                                    file.filename,
                                    self._file_manager.download(file),
                                    file.mime_type or "application/octet-stream",
                                )
                                if key not in files:
                                    files[key] = []
                                files[key].append(file_tuple)

                    # convert files to list for httpx request
                    # If there are no actual files, we still need to force httpx to use `multipart/form-data`.
                    # This is achieved by inserting a harmless placeholder file that will be ignored by the server.
                    if not files:
                        self.files = [("__multipart_placeholder__", ("", b"", "application/octet-stream"))]
                    if files:
                        self.files = []
                        for key, file_tuples in files.items():
                            for file_tuple in file_tuples:
                                self.files.append((key, file_tuple))

                    self.data = form_data

    def _assembling_headers(self) -> dict[str, Any]:
        authorization = deepcopy(self.auth)
        headers = deepcopy(self.headers) or {}
        if self.auth.type == "api-key":
            if self.auth.config is None:
                raise AuthorizationConfigError("self.authorization config is required")
            if authorization.config is None:
                raise AuthorizationConfigError("authorization config is required")

            if not authorization.config.header:
                authorization.config.header = "Authorization"

            if self.auth.config.type == "bearer" and authorization.config.api_key:
                headers[authorization.config.header] = f"Bearer {authorization.config.api_key}"
            elif self.auth.config.type == "basic" and authorization.config.api_key:
                credentials = authorization.config.api_key
                if ":" in credentials:
                    encoded_credentials = base64.b64encode(credentials.encode("utf-8")).decode("utf-8")
                else:
                    encoded_credentials = credentials
                headers[authorization.config.header] = f"Basic {encoded_credentials}"
            elif self.auth.config.type == "custom":
                if authorization.config.header and authorization.config.api_key:
                    headers[authorization.config.header] = authorization.config.api_key

        # Handle Content-Type for multipart/form-data requests
        # Fix for issue #23829: Missing boundary when using multipart/form-data
        body = self.node_data.body
        if body and body.type == "form-data":
            # For multipart/form-data with files (including placeholder files),
            # remove any manually set Content-Type header to let httpx handle
            # For multipart/form-data, if any files are present (including placeholder files),
            # we must remove any manually set Content-Type header. This is because httpx needs to
            # automatically set the Content-Type and boundary for multipart encoding whenever files
            # are included, even if they are placeholders, to avoid boundary issues and ensure correct
            # file upload behaviour. Manually setting Content-Type can cause httpx to fail to set the
            # boundary, resulting in invalid requests.
            if self.files:
                # Remove Content-Type if it was manually set to avoid boundary issues
                headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
            else:
                # No files at all, set Content-Type manually
                if "content-type" not in (k.lower() for k in headers):
                    headers["Content-Type"] = "multipart/form-data"
        elif body and body.type in BODY_TYPE_TO_CONTENT_TYPE:
            # Set Content-Type for other body types
            if "content-type" not in (k.lower() for k in headers):
                headers["Content-Type"] = BODY_TYPE_TO_CONTENT_TYPE[body.type]

        return headers

    def _validate_and_parse_response(self, response: httpx.Response) -> Response:
        executor_response = Response(response)

        threshold_size = (
            dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE
            if executor_response.is_file
            else dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE
        )
        if executor_response.size > threshold_size:
            raise ResponseSizeError(
                f"{'File' if executor_response.is_file else 'Text'} size is too large,"
                f" max size is {threshold_size / 1024 / 1024:.2f} MB,"
                f" but current size is {executor_response.readable_size}."
            )

        return executor_response

    def _do_http_request(self, headers: dict[str, Any]) -> httpx.Response:
        """
        do http request depending on api bundle
        """
        _METHOD_MAP = {
            "get": self._http_client.get,
            "head": self._http_client.head,
            "post": self._http_client.post,
            "put": self._http_client.put,
            "delete": self._http_client.delete,
            "patch": self._http_client.patch,
        }
        method_lc = self.method.lower()
        if method_lc not in _METHOD_MAP:
            raise InvalidHttpMethodError(f"Invalid http method {self.method}")

        request_args = {
            "data": self.data,
            "files": self.files,
            "json": self.json,
            "content": self.content,
            "headers": headers,
            "params": self.params,
            "timeout": (self.timeout.connect, self.timeout.read, self.timeout.write),
            "ssl_verify": self.ssl_verify,
            "follow_redirects": True,
        }
        # request_args = {k: v for k, v in request_args.items() if v is not None}
        try:
            response: httpx.Response = _METHOD_MAP[method_lc](
                url=self.url,
                **request_args,
                max_retries=self.max_retries,
            )
        except (self._http_client.max_retries_exceeded_error, self._http_client.request_error) as e:
            raise HttpRequestNodeError(str(e)) from e
        # FIXME: fix type ignore, this maybe httpx type issue
        return response

    def invoke(self) -> Response:
        # assemble headers
        headers = self._assembling_headers()
        # do http request
        response = self._do_http_request(headers)
        # validate response
        return self._validate_and_parse_response(response)

    def to_log(self):
        url_parts = urlparse(self.url)
        path = url_parts.path or "/"

        # Add query parameters
        if self.params:
            query_string = urlencode(self.params)
            path += f"?{query_string}"
        elif url_parts.query:
            path += f"?{url_parts.query}"

        raw = f"{self.method.upper()} {path} HTTP/1.1\r\n"
        raw += f"Host: {url_parts.netloc}\r\n"

        headers = self._assembling_headers()
        body = self.node_data.body
        boundary = f"----WebKitFormBoundary{_generate_random_string(16)}"
        if body:
            if "content-type" not in (k.lower() for k in self.headers) and body.type in BODY_TYPE_TO_CONTENT_TYPE:
                headers["Content-Type"] = BODY_TYPE_TO_CONTENT_TYPE[body.type]
            if body.type == "form-data":
                headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        for k, v in headers.items():
            if self.auth.type == "api-key":
                authorization_header = "Authorization"
                if self.auth.config and self.auth.config.header:
                    authorization_header = self.auth.config.header
                if k.lower() == authorization_header.lower():
                    raw += f"{k}: {'*' * len(v)}\r\n"
                    continue
            raw += f"{k}: {v}\r\n"

        body_string = ""
        # Only log actual files if present.
        # '__multipart_placeholder__' is inserted to force multipart encoding but is not a real file.
        # This prevents logging meaningless placeholder entries.
        if self.files and not all(f[0] == "__multipart_placeholder__" for f in self.files):
            for file_entry in self.files:
                # file_entry should be (key, (filename, content, mime_type)), but handle edge cases
                if len(file_entry) != 2 or len(file_entry[1]) < 2:
                    continue  # skip malformed entries
                key = file_entry[0]
                content = file_entry[1][1]
                body_string += f"--{boundary}\r\n"
                body_string += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                # decode content safely
                # Do not decode binary content; use a placeholder with file metadata instead.
                # Includes filename, size, and MIME type for better logging context.
                body_string += (
                    f"<file_content_binary: '{file_entry[1][0] or 'unknown'}', "
                    f"type='{file_entry[1][2] if len(file_entry[1]) > 2 else 'unknown'}', "
                    f"size={len(content)} bytes>\r\n"
                )
            body_string += f"--{boundary}--\r\n"
        elif self.node_data.body:
            if self.content:
                # If content is bytes, do not decode it; show a placeholder with size.
                # Provides content size information for binary data without exposing the raw bytes.
                if isinstance(self.content, bytes):
                    body_string = f"<binary_content: size={len(self.content)} bytes>"
                else:
                    body_string = self.content
            elif self.data and self.node_data.body.type == "x-www-form-urlencoded":
                body_string = urlencode(self.data)
            elif self.data and self.node_data.body.type == "form-data":
                for key, value in self.data.items():
                    body_string += f"--{boundary}\r\n"
                    body_string += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                    body_string += f"{value}\r\n"
                body_string += f"--{boundary}--\r\n"
            elif self.json:
                body_string = json.dumps(self.json)
            elif self.node_data.body.type == "raw-text":
                if len(self.node_data.body.data) != 1:
                    raise RequestBodyError("raw-text body type should have exactly one item")
                body_string = self.node_data.body.data[0].value
        if body_string:
            raw += f"Content-Length: {len(body_string)}\r\n"
        raw += "\r\n"  # Empty line between headers and body
        raw += body_string

        return raw


def _generate_random_string(n: int) -> str:
    """
    Generate a random string of lowercase ASCII letters.

    Args:
        n (int): The length of the random string to generate.

    Returns:
        str: A random string of lowercase ASCII letters with length n.

    Example:
        >>> _generate_random_string(5)
        'abcde'
    """
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(n))
