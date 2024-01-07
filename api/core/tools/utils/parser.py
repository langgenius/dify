
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import ToolParamter, ToolParamterOption
from core.tools.entities.common_entities import I18nObject
from core.tools.errors import ToolProviderNotFoundError, ToolNotSupportedError

from typing import List

from yaml import FullLoader, load
from json import loads as json_loads, dumps as json_dumps
from requests import get

class ApiBasedToolSchemaParser:
    @staticmethod
    def parse_openapi_to_tool_bundle(openapi: dict) -> List[ApiBasedToolBundle]:
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
                    parameters.append(ToolParamter(
                        name=parameter['name'],
                        label=I18nObject(
                            en_US=parameter['name'],
                            zh_Hans=parameter['name']
                        ),
                        human_description=I18nObject(
                            en_US=parameter['description'],
                            zh_Hans=parameter['description']
                        ),
                        type=ToolParamter.ToolParameterType.STRING,
                        required=parameter['required'],
                        form=ToolParamter.ToolParameterForm.LLM,
                        llm_description=parameter['description'],
                        default=parameter['default'] if 'default' in parameter else None,
                    ))
            # create tool bundle
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
    def parse_openapi_yaml_to_tool_bundle(yaml: str) -> List[ApiBasedToolBundle]:
        """
            parse openapi yaml to tool bundle

            :param yaml: the yaml string
            :return: the tool bundle
        """
        openapi: dict = load(yaml, Loader=FullLoader)
        if openapi is None:
            raise ToolProviderNotFoundError('Invalid openapi yaml.')
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi)
    
    @staticmethod
    def parse_openai_plugin_json_to_tool_bundle(json: str) -> List[ApiBasedToolBundle]:
        """
            parse openapi plugin yaml to tool bundle

            :param json: the json string
            :return: the tool bundle
        """
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
        
        return ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(response.text)