import json
from collections.abc import Mapping
from copy import deepcopy
from random import randint
from typing import Any, Literal
from urllib.parse import urlencode, urlparse

import httpx

from configs import dify_config
from core.file import file_manager
from core.helper import ssrf_proxy
from core.workflow.entities.variable_pool import VariablePool

from .entities import (
    HttpRequestNodeAuthorization,
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from .exc import (
    AuthorizationConfigError,
    FileFetchError,
    InvalidHttpMethodError,
    ResponseSizeError,
)

BODY_TYPE_TO_CONTENT_TYPE = {
    "json": "application/json",
    "x-www-form-urlencoded": "application/x-www-form-urlencoded",
    "form-data": "multipart/form-data",
    "raw-text": "text/plain",
}


class Executor:
    method: Literal["get", "head", "post", "put", "delete", "patch"]
    url: str
    params: Mapping[str, str] | None
    content: str | bytes | None
    data: Mapping[str, Any] | None
    files: Mapping[str, tuple[str | None, bytes, str]] | None
    json: Any
    headers: dict[str, str]
    auth: HttpRequestNodeAuthorization
    timeout: HttpRequestNodeTimeout

    boundary: str

    def __init__(
        self,
        *,
        node_data: HttpRequestNodeData,
        timeout: HttpRequestNodeTimeout,
        variable_pool: VariablePool,
    ):
        # If authorization API key is present, convert the API key using the variable pool
        if node_data.authorization.type == "api-key":
            if node_data.authorization.config is None:
                raise AuthorizationConfigError("authorization config is required")
            node_data.authorization.config.api_key = variable_pool.convert_template(
                node_data.authorization.config.api_key
            ).text

        self.url: str = node_data.url
        self.method = node_data.method
        self.auth = node_data.authorization
        self.timeout = timeout
        self.params = {}
        self.headers = {}
        self.content = None
        self.files = None
        self.data = None
        self.json = None

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

    def _init_params(self):
        params = _plain_text_to_dict(self.node_data.params)
        for key in params:
            params[key] = self.variable_pool.convert_template(params[key]).text
        self.params = params

    def _init_headers(self):
        headers = self.variable_pool.convert_template(self.node_data.headers).text
        self.headers = _plain_text_to_dict(headers)

    def _init_body(self):
        body = self.node_data.body
        if body is not None:
            data = body.data
            match body.type:
                case "none":
                    self.content = ""
                case "raw-text":
                    self.content = self.variable_pool.convert_template(data[0].value).text
                case "json":
                    json_string = self.variable_pool.convert_template(data[0].value).text
                    json_object = json.loads(json_string, strict=False)
                    self.json = json_object
                    # self.json = self._parse_object_contains_variables(json_object)
                case "binary":
                    file_selector = data[0].file
                    file_variable = self.variable_pool.get_file(file_selector)
                    if file_variable is None:
                        raise FileFetchError(f"cannot fetch file with selector {file_selector}")
                    file = file_variable.value
                    self.content = file_manager.download(file)
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
                    files = {k: self.variable_pool.get_file(selector) for k, selector in file_selectors.items()}
                    files = {k: v for k, v in files.items() if v is not None}
                    files = {k: variable.value for k, variable in files.items()}
                    files = {
                        k: (v.filename, file_manager.download(v), v.mime_type or "application/octet-stream")
                        for k, v in files.items()
                        if v.related_id is not None
                    }
                    self.data = form_data
                    self.files = files or None

    def _assembling_headers(self) -> dict[str, Any]:
        authorization = deepcopy(self.auth)
        headers = deepcopy(self.headers) or {}
        if self.auth.type == "api-key":
            if self.auth.config is None:
                raise AuthorizationConfigError("self.authorization config is required")
            if authorization.config is None:
                raise AuthorizationConfigError("authorization config is required")

            if self.auth.config.api_key is None:
                raise AuthorizationConfigError("api_key is required")

            if not authorization.config.header:
                authorization.config.header = "Authorization"

            if self.auth.config.type == "bearer":
                headers[authorization.config.header] = f"Bearer {authorization.config.api_key}"
            elif self.auth.config.type == "basic":
                headers[authorization.config.header] = f"Basic {authorization.config.api_key}"
            elif self.auth.config.type == "custom":
                headers[authorization.config.header] = authorization.config.api_key or ""

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
                f'{"File" if executor_response.is_file else "Text"} size is too large,'
                f' max size is {threshold_size / 1024 / 1024:.2f} MB,'
                f' but current size is {executor_response.readable_size}.'
            )

        return executor_response

    def _do_http_request(self, headers: dict[str, Any]) -> httpx.Response:
        """
        do http request depending on api bundle
        """
        if self.method not in {"get", "head", "post", "put", "delete", "patch"}:
            raise InvalidHttpMethodError(f"Invalid http method {self.method}")

        request_args = {
            "url": self.url,
            "data": self.data,
            "files": self.files,
            "json": self.json,
            "content": self.content,
            "headers": headers,
            "params": self.params,
            "timeout": (self.timeout.connect, self.timeout.read, self.timeout.write),
            "follow_redirects": True,
        }
        # request_args = {k: v for k, v in request_args.items() if v is not None}

        response = getattr(ssrf_proxy, self.method)(**request_args)
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
                    raw += f'{k}: {"*" * len(v)}\r\n'
                    continue
            raw += f"{k}: {v}\r\n"

        body = ""
        if self.files:
            for k, v in self.files.items():
                body += f"--{boundary}\r\n"
                body += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'
                body += f"{v[1]}\r\n"
            body += f"--{boundary}--\r\n"
        elif self.node_data.body:
            if self.content:
                if isinstance(self.content, str):
                    body = self.content
                elif isinstance(self.content, bytes):
                    body = self.content.decode("utf-8", errors="replace")
            elif self.data and self.node_data.body.type == "x-www-form-urlencoded":
                body = urlencode(self.data)
            elif self.data and self.node_data.body.type == "form-data":
                for key, value in self.data.items():
                    body += f"--{boundary}\r\n"
                    body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                    body += f"{value}\r\n"
                body += f"--{boundary}--\r\n"
            elif self.json:
                body = json.dumps(self.json)
            elif self.node_data.body.type == "raw-text":
                body = self.node_data.body.data[0].value
        if body:
            raw += f"Content-Length: {len(body)}\r\n"
        raw += "\r\n"  # Empty line between headers and body
        raw += body

        return raw


def _plain_text_to_dict(text: str, /) -> dict[str, str]:
    """
    Convert a string of key-value pairs to a dictionary.

    Each line in the input string represents a key-value pair.
    Keys and values are separated by ':'.
    Empty values are allowed.

    Examples:
        'aa:bb\n cc:dd'  -> {'aa': 'bb', 'cc': 'dd'}
        'aa:\n cc:dd\n'  -> {'aa': '', 'cc': 'dd'}
        'aa\n cc : dd'   -> {'aa': '', 'cc': 'dd'}

    Args:
        convert_text (str): The input string to convert.

    Returns:
        dict[str, str]: A dictionary of key-value pairs.
    """
    return {
        key.strip(): (value[0].strip() if value else "")
        for line in text.splitlines()
        if line.strip()
        for key, *value in [line.split(":", 1)]
    }


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
    return "".join([chr(randint(97, 122)) for _ in range(n)])
