
from json import dumps as json_dumps
from json import loads as json_loads
from typing import List, Tuple

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolParameter, ToolParameterOption
from core.tools.errors import ToolApiSchemaError, ToolNotSupportedError, ToolProviderNotFoundError
from requests import get
from yaml import FullLoader, load


class ApiBasedToolSchemaParser:
    @staticmethod
    def parse_openapi_to_tool_bundle(openapi: dict, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        # set description to extra_info
        if 'description' in openapi['info']:
            extra_info['description'] = openapi['info']['description']
        else:
            extra_info['description'] = ''

        if len(openapi['servers']) == 0:
            raise ToolProviderNotFoundError('No server found in the openapi yaml.')

        server_url = openapi['servers'][0]['url']

        # list all interfaces
        interfaces = []
        for path, path_item in openapi['paths'].items():
            methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']
            for method in methods:
                if method in path_item:
                    interfaces.append({
                        'path': path,
                        'method': method,
                        'operation': path_item[method],
                    })

        # get all parameters
        bundles = []
        for interface in interfaces:
            # convert parameters
            parameters = []
            if 'parameters' in interface['operation']:
                for parameter in interface['operation']['parameters']:
                    parameters.append(ToolParameter(
                        name=parameter['name'],
                        label=I18nObject(
                            en_US=parameter['name'],
                            zh_Hans=parameter['name']
                        ),
                        human_description=I18nObject(
                            en_US=parameter.get('description', ''),
                            zh_Hans=parameter.get('description', '')
                        ),
                        type=ToolParameter.ToolParameterType.STRING,
                        required=parameter.get('required', False),
                        form=ToolParameter.ToolParameterForm.LLM,
                        llm_description=parameter.get('description'),
                        default=parameter['default'] if 'default' in parameter else None,
                    ))
            # create tool bundle
            # check if there is a request body
            if 'requestBody' in interface['operation']:
                request_body = interface['operation']['requestBody']
                if 'content' in request_body:
                    for content_type, content in request_body['content'].items():
                        # if there is a reference, get the reference and overwrite the content
                        if 'schema' not in content:
                            content

                        if '$ref' in content['schema']:
                            # get the reference
                            root = openapi
                            reference = content['schema']['$ref'].split('/')[1:]
                            for ref in reference:
                                root = root[ref]
                            # overwrite the content
                            interface['operation']['requestBody']['content'][content_type]['schema'] = root
                    # parse body parameters
                    if 'schema' in interface['operation']['requestBody']['content'][content_type]:
                        body_schema = interface['operation']['requestBody']['content'][content_type]['schema']
                        required = body_schema['required'] if 'required' in body_schema else []
                        properties = body_schema['properties'] if 'properties' in body_schema else {}
                        for name, property in properties.items():
                            parameters.append(ToolParameter(
                                name=name,
                                label=I18nObject(
                                    en_US=name,
                                    zh_Hans=name
                                ),
                                human_description=I18nObject(
                                    en_US=property['description'] if 'description' in property else '',
                                    zh_Hans=property['description'] if 'description' in property else ''
                                ),
                                type=ToolParameter.ToolParameterType.STRING,
                                required=name in required,
                                form=ToolParameter.ToolParameterForm.LLM,
                                llm_description=property['description'] if 'description' in property else '',
                                default=property['default'] if 'default' in property else None,
                            ))

            # check if parameters is duplicated
            parameters_count = {}
            for parameter in parameters:
                if parameter.name not in parameters_count:
                    parameters_count[parameter.name] = 0
                parameters_count[parameter.name] += 1
            for name, count in parameters_count.items():
                if count > 1:
                    warning['duplicated_parameter'] = f'Parameter {name} is duplicated.'

            # check if there is a operation id, use $path_$method as operation id if not
            if 'operationId' not in interface['operation']:
                interface['operation']['operationId'] = f'{interface["path"]}_{interface["method"]}'

            bundles.append(ApiBasedToolBundle(
                server_url=server_url + interface['path'],
                method=interface['method'],
                summary=interface['operation']['summary'] if 'summary' in interface['operation'] else None,
                operation_id=interface['operation']['operationId'],
                parameters=parameters,
                author='',
                icon=None,
                openapi=interface['operation'],
            ))

        return bundles
        
    @staticmethod
    def parse_openapi_yaml_to_tool_bundle(yaml: str, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        """
            parse openapi yaml to tool bundle

            :param yaml: the yaml string
            :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        openapi: dict = load(yaml, Loader=FullLoader)
        if openapi is None:
            raise ToolApiSchemaError('Invalid openapi yaml.')
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)
    
    @staticmethod
    def parse_openapi_json_to_tool_bundle(json: str, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        """
            parse openapi yaml to tool bundle

            :param yaml: the yaml string
            :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        openapi: dict = json_loads(json)
        if openapi is None:
            raise ToolApiSchemaError('Invalid openapi json.')
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)
    
    @staticmethod
    def parse_swagger_to_openapi(swagger: dict, extra_info: dict = None, warning: dict = None) -> dict:
        """
            parse swagger to openapi

            :param swagger: the swagger dict
            :return: the openapi dict
        """
        # convert swagger to openapi
        info = swagger.get('info', {
            'title': 'Swagger',
            'description': 'Swagger',
            'version': '1.0.0'
        })

        servers = swagger.get('servers', [])

        if len(servers) == 0:
            raise ToolApiSchemaError('No server found in the swagger yaml.')

        openapi = {
            'openapi': '3.0.0',
            'info': {
                'title': info.get('title', 'Swagger'),
                'description': info.get('description', 'Swagger'),
                'version': info.get('version', '1.0.0')
            },
            'servers': swagger['servers'],
            'paths': {},
            'components': {
                'schemas': {}
            }
        }

        # check paths
        if 'paths' not in swagger or len(swagger['paths']) == 0:
            raise ToolApiSchemaError('No paths found in the swagger yaml.')

        # convert paths
        for path, path_item in swagger['paths'].items():
            openapi['paths'][path] = {}
            for method, operation in path_item.items():
                if 'operationId' not in operation:
                    raise ToolApiSchemaError(f'No operationId found in operation {method} {path}.')
                
                if 'summary' not in operation or len(operation['summary']) == 0:
                    warning['missing_summary'] = f'No summary found in operation {method} {path}.'
                
                if 'description' not in operation or len(operation['description']) == 0:
                    warning['missing_description'] = f'No description found in operation {method} {path}.'

                openapi['paths'][path][method] = {
                    'operationId': operation['operationId'],
                    'summary': operation.get('summary', ''),
                    'description': operation.get('description', ''),
                    'parameters': operation.get('parameters', []),
                    'responses': operation.get('responses', {}),
                }

                if 'requestBody' in operation:
                    openapi['paths'][path][method]['requestBody'] = operation['requestBody']

        # convert definitions
        for name, definition in swagger['definitions'].items():
            openapi['components']['schemas'][name] = definition

        return openapi

    @staticmethod
    def parse_swagger_yaml_to_tool_bundle(yaml: str, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        """
            parse swagger yaml to tool bundle

            :param yaml: the yaml string
            :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        swagger: dict = load(yaml, Loader=FullLoader)

        openapi = ApiBasedToolSchemaParser.parse_swagger_to_openapi(swagger, extra_info=extra_info, warning=warning)
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)

    @staticmethod
    def parse_swagger_json_to_tool_bundle(json: str, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        """
            parse swagger yaml to tool bundle

            :param yaml: the yaml string
            :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        swagger: dict = json_loads(json)

        openapi = ApiBasedToolSchemaParser.parse_swagger_to_openapi(swagger, extra_info=extra_info, warning=warning)
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)

    @staticmethod
    def parse_openai_plugin_json_to_tool_bundle(json: str, extra_info: dict = None, warning: dict = None) -> List[ApiBasedToolBundle]:
        """
            parse openapi plugin yaml to tool bundle

            :param json: the json string
            :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        try:
            openai_plugin = json_loads(json)
            api = openai_plugin['api']
            api_url = api['url']
            api_type = api['type']
        except:
            raise ToolProviderNotFoundError('Invalid openai plugin json.')
        
        if api_type != 'openapi':
            raise ToolNotSupportedError('Only openapi is supported now.')
        
        # get openapi yaml
        response = get(api_url, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        }, timeout=5)

        if response.status_code != 200:
            raise ToolProviderNotFoundError('cannot get openapi yaml from url.')
        
        return ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(response.text, extra_info=extra_info, warning=warning)
    
    @staticmethod
    def auto_parse_to_tool_bundle(content: str, extra_info: dict = None, warning: dict = None) -> Tuple[List[ApiBasedToolBundle], str]:
        """
            auto parse to tool bundle

            :param content: the content
            :return: tools bundle, schema_type
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        json_possible = False
        content = content.strip()

        if content.startswith('{') and content.endswith('}'):
            json_possible = True

        if json_possible:
            try:
                return ApiBasedToolSchemaParser.parse_openapi_json_to_tool_bundle(content, extra_info=extra_info, warning=warning), \
                    ApiProviderSchemaType.OPENAPI.value
            except:
                pass

            try:
                return ApiBasedToolSchemaParser.parse_swagger_json_to_tool_bundle(content, extra_info=extra_info, warning=warning), \
                    ApiProviderSchemaType.SWAGGER.value
            except:
                pass
            try:
                return ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(content, extra_info=extra_info, warning=warning), \
                    ApiProviderSchemaType.OPENAI_PLUGIN.value
            except:
                pass
        else:
            try:
                return ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(content, extra_info=extra_info, warning=warning), \
                    ApiProviderSchemaType.OPENAPI.value
            except:
                pass

            try:
                return ApiBasedToolSchemaParser.parse_swagger_yaml_to_tool_bundle(content, extra_info=extra_info, warning=warning), \
                    ApiProviderSchemaType.SWAGGER.value
            except:
                pass

        raise ToolApiSchemaError('Invalid api schema.')