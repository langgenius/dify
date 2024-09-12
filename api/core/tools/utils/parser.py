import re
import uuid
from json import dumps as json_dumps
from json import loads as json_loads
from json.decoder import JSONDecodeError

from requests import get
from yaml import YAMLError, safe_load

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolParameter
from core.tools.errors import ToolApiSchemaError, ToolNotSupportedError, ToolProviderNotFoundError


class ApiBasedToolSchemaParser:
    @staticmethod
    def parse_openapi_to_tool_bundle(
        openapi: dict, extra_info: dict = None, warning: dict = None
    ) -> list[ApiToolBundle]:
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        # set description to extra_info
        extra_info["description"] = openapi["info"].get("description", "")

        if len(openapi["servers"]) == 0:
            raise ToolProviderNotFoundError("No server found in the openapi yaml.")

        server_url = openapi["servers"][0]["url"]

        # list all interfaces
        interfaces = []
        for path, path_item in openapi["paths"].items():
            methods = ["get", "post", "put", "delete", "patch", "head", "options", "trace"]
            for method in methods:
                if method in path_item:
                    interfaces.append(
                        {
                            "path": path,
                            "method": method,
                            "operation": path_item[method],
                        }
                    )

        # get all parameters
        bundles = []
        for interface in interfaces:
            # convert parameters
            parameters = []
            if "parameters" in interface["operation"]:
                for parameter in interface["operation"]["parameters"]:
                    tool_parameter = ToolParameter(
                        name=parameter["name"],
                        label=I18nObject(en_US=parameter["name"], zh_Hans=parameter["name"]),
                        human_description=I18nObject(
                            en_US=parameter.get("description", ""), zh_Hans=parameter.get("description", "")
                        ),
                        type=ToolParameter.ToolParameterType.STRING,
                        required=parameter.get("required", False),
                        form=ToolParameter.ToolParameterForm.LLM,
                        llm_description=parameter.get("description"),
                        default=parameter["schema"]["default"]
                        if "schema" in parameter and "default" in parameter["schema"]
                        else None,
                    )

                    # check if there is a type
                    typ = ApiBasedToolSchemaParser._get_tool_parameter_type(parameter)
                    if typ:
                        tool_parameter.type = typ

                    parameters.append(tool_parameter)
            # create tool bundle
            # check if there is a request body
            if "requestBody" in interface["operation"]:
                request_body = interface["operation"]["requestBody"]
                if "content" in request_body:
                    for content_type, content in request_body["content"].items():
                        # if there is a reference, get the reference and overwrite the content
                        if "schema" not in content:
                            continue

                        if "$ref" in content["schema"]:
                            # get the reference
                            root = openapi
                            reference = content["schema"]["$ref"].split("/")[1:]
                            for ref in reference:
                                root = root[ref]
                            # overwrite the content
                            interface["operation"]["requestBody"]["content"][content_type]["schema"] = root

                    # parse body parameters
                    if "schema" in interface["operation"]["requestBody"]["content"][content_type]:
                        body_schema = interface["operation"]["requestBody"]["content"][content_type]["schema"]
                        required = body_schema.get("required", [])
                        properties = body_schema.get("properties", {})
                        for name, property in properties.items():
                            tool = ToolParameter(
                                name=name,
                                label=I18nObject(en_US=name, zh_Hans=name),
                                human_description=I18nObject(
                                    en_US=property.get("description", ""), zh_Hans=property.get("description", "")
                                ),
                                type=ToolParameter.ToolParameterType.STRING,
                                required=name in required,
                                form=ToolParameter.ToolParameterForm.LLM,
                                llm_description=property.get("description", ""),
                                default=property.get("default", None),
                            )

                            # check if there is a type
                            typ = ApiBasedToolSchemaParser._get_tool_parameter_type(property)
                            if typ:
                                tool.type = typ

                            parameters.append(tool)

            # check if parameters is duplicated
            parameters_count = {}
            for parameter in parameters:
                if parameter.name not in parameters_count:
                    parameters_count[parameter.name] = 0
                parameters_count[parameter.name] += 1
            for name, count in parameters_count.items():
                if count > 1:
                    warning["duplicated_parameter"] = f"Parameter {name} is duplicated."

            # check if there is a operation id, use $path_$method as operation id if not
            if "operationId" not in interface["operation"]:
                # remove special characters like / to ensure the operation id is valid ^[a-zA-Z0-9_-]{1,64}$
                path = interface["path"]
                if interface["path"].startswith("/"):
                    path = interface["path"][1:]
                # remove special characters like / to ensure the operation id is valid ^[a-zA-Z0-9_-]{1,64}$
                path = re.sub(r"[^a-zA-Z0-9_-]", "", path)
                if not path:
                    path = str(uuid.uuid4())

                interface["operation"]["operationId"] = f'{path}_{interface["method"]}'

            bundles.append(
                ApiToolBundle(
                    server_url=server_url + interface["path"],
                    method=interface["method"],
                    summary=interface["operation"]["description"]
                    if "description" in interface["operation"]
                    else interface["operation"].get("summary", None),
                    operation_id=interface["operation"]["operationId"],
                    parameters=parameters,
                    author="",
                    icon=None,
                    openapi=interface["operation"],
                )
            )

        return bundles

    @staticmethod
    def _get_tool_parameter_type(parameter: dict) -> ToolParameter.ToolParameterType:
        parameter = parameter or {}
        typ = None
        if "type" in parameter:
            typ = parameter["type"]
        elif "schema" in parameter and "type" in parameter["schema"]:
            typ = parameter["schema"]["type"]

        if typ == "integer" or typ == "number":
            return ToolParameter.ToolParameterType.NUMBER
        elif typ == "boolean":
            return ToolParameter.ToolParameterType.BOOLEAN
        elif typ == "string":
            return ToolParameter.ToolParameterType.STRING

    @staticmethod
    def parse_openapi_yaml_to_tool_bundle(
        yaml: str, extra_info: dict = None, warning: dict = None
    ) -> list[ApiToolBundle]:
        """
        parse openapi yaml to tool bundle

        :param yaml: the yaml string
        :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        openapi: dict = safe_load(yaml)
        if openapi is None:
            raise ToolApiSchemaError("Invalid openapi yaml.")
        return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(openapi, extra_info=extra_info, warning=warning)

    @staticmethod
    def parse_swagger_to_openapi(swagger: dict, extra_info: dict = None, warning: dict = None) -> dict:
        """
        parse swagger to openapi

        :param swagger: the swagger dict
        :return: the openapi dict
        """
        # convert swagger to openapi
        info = swagger.get("info", {"title": "Swagger", "description": "Swagger", "version": "1.0.0"})

        servers = swagger.get("servers", [])

        if len(servers) == 0:
            raise ToolApiSchemaError("No server found in the swagger yaml.")

        openapi = {
            "openapi": "3.0.0",
            "info": {
                "title": info.get("title", "Swagger"),
                "description": info.get("description", "Swagger"),
                "version": info.get("version", "1.0.0"),
            },
            "servers": swagger["servers"],
            "paths": {},
            "components": {"schemas": {}},
        }

        # check paths
        if "paths" not in swagger or len(swagger["paths"]) == 0:
            raise ToolApiSchemaError("No paths found in the swagger yaml.")

        # convert paths
        for path, path_item in swagger["paths"].items():
            openapi["paths"][path] = {}
            for method, operation in path_item.items():
                if "operationId" not in operation:
                    raise ToolApiSchemaError(f"No operationId found in operation {method} {path}.")

                if ("summary" not in operation or len(operation["summary"]) == 0) and (
                    "description" not in operation or len(operation["description"]) == 0
                ):
                    warning["missing_summary"] = f"No summary or description found in operation {method} {path}."

                openapi["paths"][path][method] = {
                    "operationId": operation["operationId"],
                    "summary": operation.get("summary", ""),
                    "description": operation.get("description", ""),
                    "parameters": operation.get("parameters", []),
                    "responses": operation.get("responses", {}),
                }

                if "requestBody" in operation:
                    openapi["paths"][path][method]["requestBody"] = operation["requestBody"]

        # convert definitions
        for name, definition in swagger["definitions"].items():
            openapi["components"]["schemas"][name] = definition

        return openapi

    @staticmethod
    def parse_openai_plugin_json_to_tool_bundle(
        json: str, extra_info: dict = None, warning: dict = None
    ) -> list[ApiToolBundle]:
        """
        parse openapi plugin yaml to tool bundle

        :param json: the json string
        :return: the tool bundle
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        try:
            openai_plugin = json_loads(json)
            api = openai_plugin["api"]
            api_url = api["url"]
            api_type = api["type"]
        except:
            raise ToolProviderNotFoundError("Invalid openai plugin json.")

        if api_type != "openapi":
            raise ToolNotSupportedError("Only openapi is supported now.")

        # get openapi yaml
        response = get(api_url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "}, timeout=5)

        if response.status_code != 200:
            raise ToolProviderNotFoundError("cannot get openapi yaml from url.")

        return ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(
            response.text, extra_info=extra_info, warning=warning
        )

    @staticmethod
    def auto_parse_to_tool_bundle(
        content: str, extra_info: dict = None, warning: dict = None
    ) -> tuple[list[ApiToolBundle], str]:
        """
        auto parse to tool bundle

        :param content: the content
        :return: tools bundle, schema_type
        """
        warning = warning if warning is not None else {}
        extra_info = extra_info if extra_info is not None else {}

        content = content.strip()
        loaded_content = None
        json_error = None
        yaml_error = None

        try:
            loaded_content = json_loads(content)
        except JSONDecodeError as e:
            json_error = e

        if loaded_content is None:
            try:
                loaded_content = safe_load(content)
            except YAMLError as e:
                yaml_error = e
        if loaded_content is None:
            raise ToolApiSchemaError(
                f"Invalid api schema, schema is neither json nor yaml. json error: {str(json_error)},"
                f" yaml error: {str(yaml_error)}"
            )

        swagger_error = None
        openapi_error = None
        openapi_plugin_error = None
        schema_type = None

        try:
            openapi = ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(
                loaded_content, extra_info=extra_info, warning=warning
            )
            schema_type = ApiProviderSchemaType.OPENAPI.value
            return openapi, schema_type
        except ToolApiSchemaError as e:
            openapi_error = e

        # openai parse error, fallback to swagger
        try:
            converted_swagger = ApiBasedToolSchemaParser.parse_swagger_to_openapi(
                loaded_content, extra_info=extra_info, warning=warning
            )
            schema_type = ApiProviderSchemaType.SWAGGER.value
            return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(
                converted_swagger, extra_info=extra_info, warning=warning
            ), schema_type
        except ToolApiSchemaError as e:
            swagger_error = e

        # swagger parse error, fallback to openai plugin
        try:
            openapi_plugin = ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(
                json_dumps(loaded_content), extra_info=extra_info, warning=warning
            )
            return openapi_plugin, ApiProviderSchemaType.OPENAI_PLUGIN.value
        except ToolNotSupportedError as e:
            # maybe it's not plugin at all
            openapi_plugin_error = e

        raise ToolApiSchemaError(
            f"Invalid api schema, openapi error: {str(openapi_error)}, swagger error: {str(swagger_error)},"
            f" openapi plugin error: {str(openapi_plugin_error)}"
        )
