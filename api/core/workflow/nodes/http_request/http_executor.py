import re
from copy import deepcopy
from typing import Any, Union
from urllib.parse import urlencode

import httpx
import requests

import core.helper.ssrf_proxy as ssrf_proxy
from core.workflow.nodes.http_request.entities import HttpRequestNodeData

HTTP_REQUEST_DEFAULT_TIMEOUT = (10, 60)

class HttpExecutorResponse:
    status_code: int
    headers: dict[str, str]
    body: str

    def __init__(self, status_code: int, headers: dict[str, str], body: str):
        """
        init
        """
        self.status_code = status_code
        self.headers = headers
        self.body = body

class HttpExecutor:
    server_url: str
    method: str
    authorization: HttpRequestNodeData.Authorization
    params: dict[str, Any]
    headers: dict[str, Any]
    body: Union[None, str]
    files: Union[None, dict[str, Any]]

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
            kv = kv.split(':')
            if len(kv) != 2:
                raise ValueError(f'Invalid params {kv}')
            
            k, v = kv
            self.params[k] = v

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
            kv = kv.split(':')
            if len(kv) != 2:
                raise ValueError(f'Invalid headers {kv}')
            
            k, v = kv
            self.headers[k] = v

        # extract all template in body
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
        # elif node_data.body.type == 'form-data':
        #    self.headers['Content-Type'] = 'multipart/form-data'

        if node_data.body.type in ['form-data', 'x-www-form-urlencoded']:
            body = {}
            kv_paris = original_body.split('\n')
            for kv in kv_paris:
                kv = kv.split(':')
                if len(kv) != 2:
                    raise ValueError(f'Invalid body {kv}')
                body[kv[0]] = kv[1]

            if node_data.body.type == 'form-data':
                self.files = {
                    k: ('', v) for k, v in body.items()
                }
            else:
                self.body = urlencode(body)
        else:
            self.body = original_body
                
    def _assembling_headers(self) -> dict[str, Any]:
        authorization = deepcopy(self.authorization)
        headers = deepcopy(self.headers) or []
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
        if isinstance(response, httpx.Response):
            # get key-value pairs headers
            headers = {}
            for k, v in response.headers.items():
                headers[k] = v

            return HttpExecutorResponse(response.status_code, headers, response.text)
        elif isinstance(response, requests.Response):
            # get key-value pairs headers
            headers = {}
            for k, v in response.headers.items():
                headers[k] = v

            return HttpExecutorResponse(response.status_code, headers, response.text)
        else:
            raise ValueError(f'Invalid response type {type(response)}')
        
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
        for k, v in self.headers.items():
            raw_request += f'{k}: {v}\n'

        raw_request += '\n'
        raw_request += self.body or ''

        return raw_request