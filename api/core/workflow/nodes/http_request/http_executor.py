import re
from copy import deepcopy
from random import randint
from typing import Any, Union
from urllib.parse import urlencode

import httpx
import requests

import core.helper.ssrf_proxy as ssrf_proxy
from core.workflow.nodes.http_request.entities import HttpRequestNodeData

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

    def __init__(self, node_data: HttpRequestNodeData, variables: dict[str, Any]):
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
        self._init_template(node_data, variables)

    def _init_template(self, node_data: HttpRequestNodeData, variables: dict[str, Any]):
        """
        init template
        """
        # extract all template in url
        url_template = re.findall(r'{{(.*?)}}', node_data.url) or []
        url_template = list(set(url_template))
        original_url = node_data.url
        for url in url_template:
            if not url:
                continue

            original_url = original_url.replace(f'{{{{{url}}}}}', str(variables.get(url, '')))
        
        self.server_url = original_url

        # extract all template in params
        param_template = re.findall(r'{{(.*?)}}', node_data.params) or []
        param_template = list(set(param_template))
        original_params = node_data.params
        for param in param_template:
            if not param:
                continue

            original_params = original_params.replace(f'{{{{{param}}}}}', str(variables.get(param, '')))

        # fill in params
        kv_paris = original_params.split('\n')
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
        header_template = re.findall(r'{{(.*?)}}', node_data.headers) or []
        header_template = list(set(header_template))
        original_headers = node_data.headers
        for header in header_template:
            if not header:
                continue

            original_headers = original_headers.replace(f'{{{{{header}}}}}', str(variables.get(header, '')))

        # fill in headers
        kv_paris = original_headers.split('\n')
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
        if node_data.body:
            body_template = re.findall(r'{{(.*?)}}', node_data.body.data or '') or []
            body_template = list(set(body_template))
            original_body = node_data.body.data or ''
            for body in body_template:
                if not body:
                    continue

                original_body = original_body.replace(f'{{{{{body}}}}}', str(variables.get(body, '')))

            if node_data.body.type == 'json':
                self.headers['Content-Type'] = 'application/json'
            elif node_data.body.type == 'x-www-form-urlencoded':
                self.headers['Content-Type'] = 'application/x-www-form-urlencoded'

            if node_data.body.type in ['form-data', 'x-www-form-urlencoded']:
                body = {}
                kv_paris = original_body.split('\n')
                for kv in kv_paris:
                    if not kv.strip():
                        continue
                    kv = kv.split(':')
                    if len(kv) == 2:
                        body[kv[0].strip()] = kv[1]
                    elif len(kv) == 1:
                        body[kv[0].strip()] = ''
                    else:
                        raise ValueError(f'Invalid body {kv}')

                if node_data.body.type == 'form-data':
                    self.files = {
                        k: ('', v) for k, v in body.items()
                    }
                    random_str = lambda n: ''.join([chr(randint(97, 122)) for _ in range(n)])
                    self.boundary = f'----WebKitFormBoundary{random_str(16)}'

                    self.headers['Content-Type'] = f'multipart/form-data; boundary={self.boundary}'
                else:
                    self.body = urlencode(body)
            elif node_data.body.type in ['json', 'raw']:
                self.body = original_body
            elif node_data.body.type == 'none':
                self.body = ''
                
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
            for k, v in self.files.items():
                raw_request += f'Content-Disposition: form-data; name="{k}"; filename="{v[0]}"\n'
                raw_request += f'Content-Type: {v[1]}\n\n'
                raw_request += v[1] + '\n'
                raw_request += f'{boundary}\n'
            raw_request += '--\n'
        else:
            raw_request += self.body or ''

        return raw_request