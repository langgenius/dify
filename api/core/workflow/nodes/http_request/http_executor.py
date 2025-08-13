import json
from copy import deepcopy
from random import randint
from typing import Any, Optional, Union
from urllib.parse import urlencode

import httpx
import requests

import core.helper.ssrf_proxy as ssrf_proxy
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.entities.variable_pool import ValueType, VariablePool
from core.workflow.nodes.http_request.entities import HttpRequestNodeData
from core.workflow.utils.variable_template_parser import VariableTemplateParser

HTTP_REQUEST_DEFAULT_TIMEOUT = (10, 60)
MAX_BINARY_SIZE = 1024 * 1024 * 10  # 10MB
READABLE_MAX_BINARY_SIZE = '10MB'
MAX_TEXT_SIZE = 1024 * 1024 // 10  # 0.1MB
READABLE_MAX_TEXT_SIZE = '0.1MB'


class HttpExecutorResponse:
    headers: dict[str, str]
    response: Union[httpx.Response, requests.Response]

    def __init__(self, response: Union[httpx.Response, requests.Response] = None):
        """
        init
        """
        headers = {}
        if isinstance(response, httpx.Response):
            for k, v in response.headers.items():
                headers[k] = v
        elif isinstance(response, requests.Response):
            for k, v in response.headers.items():
                headers[k] = v

        self.headers = headers
        self.response = response

    @property
    def is_file(self) -> bool:
        """
        check if response is file
        """
        content_type = self.get_content_type()
        file_content_types = ['image', 'audio', 'video']
        for v in file_content_types:
            if v in content_type:
                return True
        
        return False

    def get_content_type(self) -> str:
        """
        get content type
        """
        for key, val in self.headers.items():
            if key.lower() == 'content-type':
                return val
        
        return ''

    def extract_file(self) -> tuple[str, bytes]:
        """
        extract file from response if content type is file related
        """
        if self.is_file:
            return self.get_content_type(), self.body
            
        return '', b''
    
    @property
    def content(self) -> str:
        """
        get content
        """
        if isinstance(self.response, httpx.Response):
            return self.response.text
        elif isinstance(self.response, requests.Response):
            return self.response.text
        else:
            raise ValueError(f'Invalid response type {type(self.response)}')
    
    @property
    def body(self) -> bytes:
        """
        get body
        """
        if isinstance(self.response, httpx.Response):
            return self.response.content
        elif isinstance(self.response, requests.Response):
            return self.response.content
        else:
            raise ValueError(f'Invalid response type {type(self.response)}')

    @property
    def status_code(self) -> int:
        """
        get status code
        """
        if isinstance(self.response, httpx.Response):
            return self.response.status_code
        elif isinstance(self.response, requests.Response):
            return self.response.status_code
        else:
            raise ValueError(f'Invalid response type {type(self.response)}')
        
    @property
    def size(self) -> int:
        """
        get size
        """
        return len(self.body)
    
    @property
    def readable_size(self) -> str:
        """
        get readable size
        """
        if self.size < 1024:
            return f'{self.size} bytes'
        elif self.size < 1024 * 1024:
            return f'{(self.size / 1024):.2f} KB'
        else:
            return f'{(self.size / 1024 / 1024):.2f} MB'


class HttpExecutor:
    server_url: str
    method: str
    authorization: HttpRequestNodeData.Authorization
    params: dict[str, Any]
    headers: dict[str, Any]
    body: Union[None, str]
    files: Union[None, dict[str, Any]]
    boundary: str
    variable_selectors: list[VariableSelector]

    def __init__(self, node_data: HttpRequestNodeData, variable_pool: Optional[VariablePool] = None):
        """
        init
        """
        self.server_url = node_data.url
        self.method = node_data.method
        self.authorization = node_data.authorization
        self.params = {}
        self.headers = {}
        self.body = None
        self.files = None

        # init template
        self.variable_selectors = []
        self._init_template(node_data, variable_pool)

    def _is_json_body(self, body: HttpRequestNodeData.Body):
        """
        check if body is json
        """
        if body and body.type == 'json':
            try:
                json.loads(body.data)
                return True
            except:
                return False
        
        return False

    def _init_template(self, node_data: HttpRequestNodeData, variable_pool: Optional[VariablePool] = None):
        """
        init template
        """
        variable_selectors = []

        # extract all template in url
        self.server_url, server_url_variable_selectors = self._format_template(node_data.url, variable_pool)

        # extract all template in params
        params, params_variable_selectors = self._format_template(node_data.params, variable_pool)

        # fill in params
        kv_paris = params.split('\n')
        for kv in kv_paris:
            if not kv.strip():
                continue

            kv = kv.split(':')
            if len(kv) == 2:
                k, v = kv
            elif len(kv) == 1:
                k, v = kv[0], ''
            else:
                raise ValueError(f'Invalid params {kv}')
            
            self.params[k.strip()] = v

        # extract all template in headers
        headers, headers_variable_selectors = self._format_template(node_data.headers, variable_pool)

        # fill in headers
        kv_paris = headers.split('\n')
        for kv in kv_paris:
            if not kv.strip():
                continue

            kv = kv.split(':')
            if len(kv) == 2:
                k, v = kv
            elif len(kv) == 1:
                k, v = kv[0], ''
            else:
                raise ValueError(f'Invalid headers {kv}')
            
            self.headers[k.strip()] = v.strip()

        # extract all template in body
        body_data_variable_selectors = []
        if node_data.body:
            # check if it's a valid JSON
            is_valid_json = self._is_json_body(node_data.body)

            body_data = node_data.body.data or ''
            if body_data:
                body_data, body_data_variable_selectors = self._format_template(body_data, variable_pool, is_valid_json)

            if node_data.body.type == 'json':
                self.headers['Content-Type'] = 'application/json'
            elif node_data.body.type == 'x-www-form-urlencoded':
                self.headers['Content-Type'] = 'application/x-www-form-urlencoded'

            if node_data.body.type in ['form-data', 'x-www-form-urlencoded']:
                body = {}
                kv_paris = body_data.split('\n')
                for kv in kv_paris:
                    if not kv.strip():
                        continue
                    kv = kv.split(':', 1)
                    if len(kv) == 2:
                        body[kv[0].strip()] = kv[1]
                    elif len(kv) == 1:
                        body[kv[0].strip()] = ''
                    else:
                        raise ValueError(f'Invalid body {kv}')

                if node_data.body.type == 'form-data':
                    self.files = {
                        k: ('', v) for k, v in body.items() if k.strip()
                    }
                    random_str = lambda n: ''.join([chr(randint(97, 122)) for _ in range(n)])
                    self.boundary = f'----WebKitFormBoundary{random_str(16)}'

                    # Let httpx handle the boundary automatically
                    # self.headers['Content-Type'] = f'multipart/form-data; boundary={self.boundary}'
                else:
                    self.body = urlencode(body)
            elif node_data.body.type in ['json', 'raw-text']:
                self.body = body_data
            elif node_data.body.type == 'none':
                self.body = ''

        self.variable_selectors = (server_url_variable_selectors + params_variable_selectors
                                   + headers_variable_selectors + body_data_variable_selectors)
                
    def _assembling_headers(self) -> dict[str, Any]:
        authorization = deepcopy(self.authorization)
        headers = deepcopy(self.headers) or {}
        if self.authorization.type == 'api-key':
            if self.authorization.config.api_key is None:
                raise ValueError('api_key is required')
            
            if not self.authorization.config.header:
                authorization.config.header = 'Authorization'

            if self.authorization.config.type == 'bearer':
                headers[authorization.config.header] = f'Bearer {authorization.config.api_key}'
            elif self.authorization.config.type == 'basic':
                headers[authorization.config.header] = f'Basic {authorization.config.api_key}'
            elif self.authorization.config.type == 'custom':
                headers[authorization.config.header] = authorization.config.api_key
        
        return headers
    
    def _validate_and_parse_response(self, response: Union[httpx.Response, requests.Response]) -> HttpExecutorResponse:
        """
            validate the response
        """
        if isinstance(response, httpx.Response | requests.Response):
            executor_response = HttpExecutorResponse(response)
        else:
            raise ValueError(f'Invalid response type {type(response)}')
        
        if executor_response.is_file:
            if executor_response.size > MAX_BINARY_SIZE:
                raise ValueError(f'File size is too large, max size is {READABLE_MAX_BINARY_SIZE}, but current size is {executor_response.readable_size}.')
        else:
            if executor_response.size > MAX_TEXT_SIZE:
                raise ValueError(f'Text size is too large, max size is {READABLE_MAX_TEXT_SIZE}, but current size is {executor_response.readable_size}.')
        
        return executor_response
        
    def _do_http_request(self, headers: dict[str, Any]) -> httpx.Response:
        """
            do http request depending on api bundle
        """
        # do http request
        kwargs = {
            'url': self.server_url,
            'headers': headers,
            'params': self.params,
            'timeout': HTTP_REQUEST_DEFAULT_TIMEOUT,
            'follow_redirects': True
        }

        if self.method == 'get':
            response = ssrf_proxy.get(**kwargs)
        elif self.method == 'post':
            response = ssrf_proxy.post(data=self.body, files=self.files, **kwargs)
        elif self.method == 'put':
            response = ssrf_proxy.put(data=self.body, files=self.files, **kwargs)
        elif self.method == 'delete':
            response = ssrf_proxy.delete(data=self.body, files=self.files, **kwargs)
        elif self.method == 'patch':
            response = ssrf_proxy.patch(data=self.body, files=self.files, **kwargs)
        elif self.method == 'head':
            response = ssrf_proxy.head(**kwargs)
        elif self.method == 'options':
            response = ssrf_proxy.options(**kwargs)
        else:
            raise ValueError(f'Invalid http method {self.method}')
        
        return response
    
    def invoke(self) -> HttpExecutorResponse:
        """
        invoke http request
        """
        # assemble headers
        headers = self._assembling_headers()

        # do http request
        response = self._do_http_request(headers)

        # validate response
        return self._validate_and_parse_response(response)
    
    def to_raw_request(self) -> str:
        """
        convert to raw request
        """
        server_url = self.server_url
        if self.params:
            server_url += f'?{urlencode(self.params)}'

        raw_request = f'{self.method.upper()} {server_url} HTTP/1.1\n'

        headers = self._assembling_headers()
        for k, v in headers.items():
            raw_request += f'{k}: {v}\n'

        raw_request += '\n'

        # if files, use multipart/form-data with boundary
        if self.files:
            boundary = self.boundary
            raw_request += f'--{boundary}'
            for k, v in self.files.items():
                raw_request += f'\nContent-Disposition: form-data; name="{k}"\n\n'
                raw_request += f'{v[1]}\n'
                raw_request += f'--{boundary}'
            raw_request += '--'
        else:
            raw_request += self.body or ''

        return raw_request

    def _format_template(self, template: str, variable_pool: VariablePool, escape_quotes: bool = False) \
            -> tuple[str, list[VariableSelector]]:
        """
        format template
        """
        variable_template_parser = VariableTemplateParser(template=template)
        variable_selectors = variable_template_parser.extract_variable_selectors()

        if variable_pool:
            variable_value_mapping = {}
            for variable_selector in variable_selectors:
                value = variable_pool.get_variable_value(
                    variable_selector=variable_selector.value_selector,
                    target_value_type=ValueType.STRING
                )

                if value is None:
                    raise ValueError(f'Variable {variable_selector.variable} not found')

                if escape_quotes:
                    value = value.replace('"', '\\"')

                variable_value_mapping[variable_selector.variable] = value

            return variable_template_parser.format(variable_value_mapping), variable_selectors
        else:
            return template, variable_selectors
