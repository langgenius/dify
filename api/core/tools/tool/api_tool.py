import json
from json import dumps
from typing import Any, Dict, List, Union

import httpx
import requests
import core.helper.ssrf_proxy as ssrf_proxy
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.tool import Tool


class ApiTool(Tool):
    api_bundle: ApiBasedToolBundle
    
    """
    Api tool
    """
    def fork_tool_runtime(self, meta: Dict[str, Any]) -> 'Tool':
        """
            fork a new tool with meta data

            :param meta: the meta data of a tool call processing, tenant_id is required
            :return: the new tool
        """
        return self.__class__(
            identity=self.identity.copy() if self.identity else None,
            parameters=self.parameters.copy() if self.parameters else None,
            description=self.description.copy() if self.description else None,
            api_bundle=self.api_bundle.copy() if self.api_bundle else None,
            runtime=Tool.Runtime(**meta)
        )

    def validate_credentials(self, credentials: Dict[str, Any], parameters: Dict[str, Any], format_only: bool = False) -> str:
        """
            validate the credentials for Api tool
        """
        # assemble validate request and request parameters 
        headers = self.assembling_request(parameters)

        if format_only:
            return

        response = self.do_http_request(self.api_bundle.server_url, self.api_bundle.method, headers, parameters)
        # validate response
        return self.validate_and_parse_response(response)

    def assembling_request(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        headers = {}
        credentials = self.runtime.credentials or {}

        if 'auth_type' not in credentials:
            raise ToolProviderCredentialValidationError('Missing auth_type')

        if credentials['auth_type'] == 'api_key':
            api_key_header = 'api_key'

            if 'api_key_header' in credentials:
                api_key_header = credentials['api_key_header']
            
            if 'api_key_value' not in credentials:
                raise ToolProviderCredentialValidationError('Missing api_key_value')
            
            headers[api_key_header] = credentials['api_key_value']

        needed_parameters = [parameter for parameter in self.api_bundle.parameters if parameter.required]
        for parameter in needed_parameters:
            if parameter.required and parameter.name not in parameters:
                raise ToolProviderCredentialValidationError(f"Missing required parameter {parameter.name}")
            
            if parameter.default is not None and parameter.name not in parameters:
                parameters[parameter.name] = parameter.default

        return headers

    def validate_and_parse_response(self, response: Union[httpx.Response, requests.Response]) -> str:
        """
            validate the response
        """
        if isinstance(response, httpx.Response):
            if response.status_code >= 400:
                raise ToolProviderCredentialValidationError(f"Request failed with status code {response.status_code}")
            if not response.content:
                return 'Empty response from the tool, please check your parameters and try again.'
            try:
                response = response.json()
                try:
                    return json.dumps(response, ensure_ascii=False)
                except Exception as e:
                    return json.dumps(response)
            except Exception as e:
                return response.text
        elif isinstance(response, requests.Response):
            if not response.ok:
                raise ToolProviderCredentialValidationError(f"Request failed with status code {response.status_code}")
            if not response.content:
                return 'Empty response from the tool, please check your parameters and try again.'
            try:
                response = response.json()
                try:
                    return json.dumps(response, ensure_ascii=False)
                except Exception as e:
                    return json.dumps(response)
            except Exception as e:
                return response.text
        else:
            raise ValueError(f'Invalid response type {type(response)}')
    
    def do_http_request(self, url: str, method: str, headers: Dict[str, Any], parameters: Dict[str, Any]) -> httpx.Response:
        """
            do http request depending on api bundle
        """
        method = method.lower()

        params = {}
        path_params = {}
        body = {}
        cookies = {}

        # check parameters
        for parameter in self.api_bundle.openapi.get('parameters', []):
            if parameter['in'] == 'path':
                value = ''
                if parameter['name'] in parameters:
                    value = parameters[parameter['name']]
                elif parameter['required']:
                    raise ToolProviderCredentialValidationError(f"Missing required parameter {parameter['name']}")
                path_params[parameter['name']] = value

            elif parameter['in'] == 'query':
                value = ''
                if parameter['name'] in parameters:
                    value = parameters[parameter['name']]
                elif parameter['required']:
                    raise ToolProviderCredentialValidationError(f"Missing required parameter {parameter['name']}")
                params[parameter['name']] = value

            elif parameter['in'] == 'cookie':
                value = ''
                if parameter['name'] in parameters:
                    value = parameters[parameter['name']]
                elif parameter['required']:
                    raise ToolProviderCredentialValidationError(f"Missing required parameter {parameter['name']}")
                cookies[parameter['name']] = value

            elif parameter['in'] == 'header':
                value = ''
                if parameter['name'] in parameters:
                    value = parameters[parameter['name']]
                elif parameter['required']:
                    raise ToolProviderCredentialValidationError(f"Missing required parameter {parameter['name']}")
                headers[parameter['name']] = value

        # check if there is a request body and handle it
        if 'requestBody' in self.api_bundle.openapi and self.api_bundle.openapi['requestBody'] is not None:
            # handle json request body
            if 'content' in self.api_bundle.openapi['requestBody']:
                for content_type in self.api_bundle.openapi['requestBody']['content']:
                    headers['Content-Type'] = content_type
                    body_schema = self.api_bundle.openapi['requestBody']['content'][content_type]['schema']
                    required = body_schema['required'] if 'required' in body_schema else []
                    properties = body_schema['properties'] if 'properties' in body_schema else {}
                    for name, property in properties.items():
                        if name in parameters:
                            # convert type
                            try:
                                value = parameters[name]
                                if property['type'] == 'integer':
                                    value = int(value)
                                elif property['type'] == 'number':
                                    # check if it is a float
                                    if '.' in value:
                                        value = float(value)
                                    else:
                                        value = int(value)
                                elif property['type'] == 'boolean':
                                    value = bool(value)
                                body[name] = value
                            except ValueError as e:
                                body[name] = parameters[name]
                        elif name in required:
                            raise ToolProviderCredentialValidationError(
                                f"Missing required parameter {name} in operation {self.api_bundle.operation_id}"
                            )
                        elif 'default' in property:
                            body[name] = property['default']
                        else:
                            body[name] = None
                    break
        
        # replace path parameters
        for name, value in path_params.items():
            url = url.replace(f'{{{name}}}', value)

        # parse http body data if needed, for GET/HEAD/OPTIONS/TRACE, the body is ignored
        if 'Content-Type' in headers:
            if headers['Content-Type'] == 'application/json':
                body = dumps(body)
            else:
                body = body
        
        # do http request
        if method == 'get':
            response = ssrf_proxy.get(url, params=params, headers=headers, cookies=cookies, timeout=10, follow_redirects=True)
        elif method == 'post':
            response = ssrf_proxy.post(url, params=params, headers=headers, cookies=cookies, data=body, timeout=10, follow_redirects=True)
        elif method == 'put':
            response = ssrf_proxy.put(url, params=params, headers=headers, cookies=cookies, data=body, timeout=10, follow_redirects=True)
        elif method == 'delete':
            """
            request body data is unsupported for DELETE method in standard http protocol
            however, OpenAPI 3.0 supports request body data for DELETE method, so we support it here by using requests
            """
            response = ssrf_proxy.delete(url, params=params, headers=headers, cookies=cookies, data=body, timeout=10, allow_redirects=True)
        elif method == 'patch':
            response = ssrf_proxy.patch(url, params=params, headers=headers, cookies=cookies, data=body, timeout=10, follow_redirects=True)
        elif method == 'head':
            response = ssrf_proxy.head(url, params=params, headers=headers, cookies=cookies, timeout=10, follow_redirects=True)
        elif method == 'options':
            response = ssrf_proxy.options(url, params=params, headers=headers, cookies=cookies, timeout=10, follow_redirects=True)
        else:
            raise ValueError(f'Invalid http method {method}')
        
        return response

    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) -> ToolInvokeMessage | List[ToolInvokeMessage]:
        """
        invoke http request
        """
        # assemble request
        headers = self.assembling_request(tool_parameters)

        # do http request
        response = self.do_http_request(self.api_bundle.server_url, self.api_bundle.method, headers, tool_parameters)

        # validate response
        response = self.validate_and_parse_response(response)

        # assemble invoke message
        return self.create_text_message(response)
    