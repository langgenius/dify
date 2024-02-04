import json
from typing import List, Tuple

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import (ApiProviderAuthType, ApiProviderSchemaType, ToolCredentialsOption,
                                               ToolProviderCredentials)
from core.tools.entities.user_entities import UserTool, UserToolProvider
from core.tools.errors import ToolNotFoundError, ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.provider.api_tool_provider import ApiBasedToolProviderController
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolConfiguration
from core.tools.utils.encoder import serialize_base_model_array, serialize_base_model_dict
from core.tools.utils.parser import ApiBasedToolSchemaParser
from extensions.ext_database import db
from flask import current_app
from httpx import get
from models.tools import ApiToolProvider, BuiltinToolProvider


class ToolManageService:
    @staticmethod
    def list_tool_providers(user_id: str, tenant_id: str):
        """
            list tool providers

            :return: the list of tool providers
        """
        result = [provider.to_dict() for provider in ToolManager.user_list_providers(
            user_id, tenant_id
        )]

        # add icon url prefix
        for provider in result:
            ToolManageService.repack_provider(provider)

        return result
    
    @staticmethod
    def repack_provider(provider: dict):
        """
            repack provider

            :param provider: the provider dict
        """
        url_prefix = (current_app.config.get("CONSOLE_API_URL")
                      + f"/console/api/workspaces/current/tool-provider/builtin/")
        
        if 'icon' in provider:
            if provider['type'] == UserToolProvider.ProviderType.BUILTIN.value:
                provider['icon'] = url_prefix + provider['name'] + '/icon'
            elif provider['type'] == UserToolProvider.ProviderType.API.value:
                try:
                    provider['icon'] = json.loads(provider['icon'])
                except:
                    provider['icon'] =  {
                        "background": "#252525",
                        "content": "\ud83d\ude01"
                    }
    
    @staticmethod
    def list_builtin_tool_provider_tools(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            list builtin tool provider tools
        """
        provider_controller: ToolProviderController = ToolManager.get_builtin_provider(provider)
        tools = provider_controller.get_tools()

        result = [
            UserTool(
                author=tool.identity.author,
                name=tool.identity.name,
                label=tool.identity.label,
                description=tool.description.human,
                parameters=tool.parameters or []
            ) for tool in tools
        ]

        return json.loads(
            serialize_base_model_array(result)
        )
    
    @staticmethod
    def list_builtin_provider_credentials_schema(
        provider_name
    ):
        """
            list builtin provider credentials schema

            :return: the list of tool providers
        """
        provider = ToolManager.get_builtin_provider(provider_name)
        return [
            v.to_dict() for _, v in (provider.credentials_schema or {}).items()
        ]

    @staticmethod
    def parser_api_schema(schema: str) -> List[ApiBasedToolBundle]:
        """
            parse api schema to tool bundle
        """
        try:
            warnings = {}
            try:
                tool_bundles, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema, warning=warnings)
            except Exception as e:
                raise ValueError(f'invalid schema: {str(e)}')
            
            credentials_schema = [
                ToolProviderCredentials(
                    name='auth_type',
                    type=ToolProviderCredentials.CredentialsType.SELECT,
                    required=True,
                    default='none',
                    options=[
                        ToolCredentialsOption(value='none', label=I18nObject(
                            en_US='None',
                            zh_Hans='无'
                        )),
                        ToolCredentialsOption(value='api_key', label=I18nObject(
                            en_US='Api Key',
                            zh_Hans='Api Key'
                        )),
                    ],
                    placeholder=I18nObject(
                        en_US='Select auth type',
                        zh_Hans='选择认证方式'
                    )
                ),
                ToolProviderCredentials(
                    name='api_key_header',
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(
                        en_US='Enter api key header',
                        zh_Hans='输入 api key header，如：X-API-KEY'
                    ),
                    default='api_key',
                    help=I18nObject(
                        en_US='HTTP header name for api key',
                        zh_Hans='HTTP 头部字段名，用于传递 api key'
                    )
                ),
                ToolProviderCredentials(
                    name='api_key_value',
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(
                        en_US='Enter api key',
                        zh_Hans='输入 api key'
                    ),
                    default=''
                ),
            ]

            return json.loads(serialize_base_model_dict(
                {
                    'schema_type': schema_type,
                    'parameters_schema': tool_bundles,
                    'credentials_schema': credentials_schema,
                    'warning': warnings
                }
            ))
        except Exception as e:
            raise ValueError(f'invalid schema: {str(e)}')

    @staticmethod
    def convert_schema_to_tool_bundles(schema: str, extra_info: dict = None) -> List[ApiBasedToolBundle]:
        """
            convert schema to tool bundles

            :return: the list of tool bundles, description
        """
        try:
            tool_bundles = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema, extra_info=extra_info)
            return tool_bundles
        except Exception as e:
            raise ValueError(f'invalid schema: {str(e)}')

    @staticmethod
    def create_api_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, icon: dict, credentials: dict,
        schema_type: str, schema: str, privacy_policy: str
    ):
        """
            create api tool provider
        """
        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f'invalid schema type {schema}')
        
        # check if the provider exists
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider_name,
        ).first()

        if provider is not None:
            raise ValueError(f'provider {provider_name} already exists')

        # parse openapi to tool bundle
        extra_info = {}
        # extra info like description will be set here
        tool_bundles, schema_type = ToolManageService.convert_schema_to_tool_bundles(schema, extra_info)
        
        if len(tool_bundles) > 10:
            raise ValueError(f'the number of apis should be less than 10')

        # create db provider
        db_provider = ApiToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            name=provider_name,
            icon=json.dumps(icon),
            schema=schema,
            description=extra_info.get('description', ''),
            schema_type_str=schema_type,
            tools_str=serialize_base_model_array(tool_bundles),
            credentials_str={},
            privacy_policy=privacy_policy
        )

        if 'auth_type' not in credentials:
            raise ValueError('auth_type is required')

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials['auth_type'])

        # create provider entity
        provider_controller = ApiBasedToolProviderController.from_db(db_provider, auth_type)
        # load tools into provider entity
        provider_controller.load_bundled_tools(tool_bundles)

        # encrypt credentials
        tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=provider_controller)
        encrypted_credentials = tool_configuration.encrypt_tool_credentials(credentials)
        db_provider.credentials_str = json.dumps(encrypted_credentials)

        db.session.add(db_provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def get_api_tool_provider_remote_schema(
        user_id: str, tenant_id: str, url: str
    ):
        """
            get api tool provider remote schema
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            "Accept": "*/*",
        }

        try:
            response = get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                raise ValueError(f'Got status code {response.status_code}')
            schema = response.text

            # try to parse schema, avoid SSRF attack
            ToolManageService.parser_api_schema(schema)
        except Exception as e:
            raise ValueError(f'invalid schema, please check the url you provided')
        
        return {
            'schema': schema
        }

    @staticmethod
    def list_api_tool_provider_tools(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            list api tool provider tools
        """
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider,
        ).first()

        if provider is None:
            raise ValueError(f'you have not added provider {provider}')
        
        return json.loads(
            serialize_base_model_array([
                UserTool(
                    author=tool_bundle.author,
                    name=tool_bundle.operation_id,
                    label=I18nObject(
                        en_US=tool_bundle.operation_id,
                        zh_Hans=tool_bundle.operation_id
                    ),
                    description=I18nObject(
                        en_US=tool_bundle.summary or '',
                        zh_Hans=tool_bundle.summary or ''
                    ),
                    parameters=tool_bundle.parameters
                ) for tool_bundle in provider.tools
            ])
        )

    @staticmethod
    def update_builtin_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, credentials: dict
    ):
        """
            update builtin tool provider
        """
        # get if the provider exists
        provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider_name,
        ).first()

        try: 
            # get provider
            provider_controller = ToolManager.get_builtin_provider(provider_name)
            if not provider_controller.need_credentials:
                raise ValueError(f'provider {provider_name} does not need credentials')
            tool_configuration = ToolConfiguration(tenant_id=tenant_id, provider_controller=provider_controller)
            # get original credentials if exists
            if provider is not None:
                original_credentials = tool_configuration.decrypt_tool_credentials(provider.credentials)
                masked_credentials = tool_configuration.mask_tool_credentials(original_credentials)
                # check if the credential has changed, save the original credential
                for name, value in credentials.items():
                    if name in masked_credentials and value == masked_credentials[name]:
                        credentials[name] = original_credentials[name]
            # validate credentials
            provider_controller.validate_credentials(credentials)
            # encrypt credentials
            credentials = tool_configuration.encrypt_tool_credentials(credentials)
        except (ToolProviderNotFoundError, ToolNotFoundError, ToolProviderCredentialValidationError) as e:
            raise ValueError(str(e))

        if provider is None:
            # create provider
            provider = BuiltinToolProvider(
                tenant_id=tenant_id,
                user_id=user_id,
                provider=provider_name,
                encrypted_credentials=json.dumps(credentials),
            )

            db.session.add(provider)
            db.session.commit()

        else:
            provider.encrypted_credentials = json.dumps(credentials)

            db.session.add(provider)
            db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def update_api_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, original_provider: str, icon: dict, credentials: dict, 
        schema_type: str, schema: str, privacy_policy: str
    ):
        """
            update api tool provider
        """
        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f'invalid schema type {schema}')
        
        # check if the provider exists
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == original_provider,
        ).first()

        if provider is None:
            raise ValueError(f'api provider {provider_name} does not exists')

        # parse openapi to tool bundle
        extra_info = {}
        # extra info like description will be set here
        tool_bundles, schema_type = ToolManageService.convert_schema_to_tool_bundles(schema, extra_info)
        
        # update db provider
        provider.name = provider_name
        provider.icon = json.dumps(icon)
        provider.schema = schema
        provider.description = extra_info.get('description', '')
        provider.schema_type_str = ApiProviderSchemaType.OPENAPI.value
        provider.tools_str = serialize_base_model_array(tool_bundles)
        provider.credentials_str = json.dumps(credentials)
        provider.privacy_policy = privacy_policy

        if 'auth_type' not in credentials:
            raise ValueError('auth_type is required')

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials['auth_type'])

        # create provider entity
        provider_entity = ApiBasedToolProviderController.from_db(provider, auth_type)
        # load tools into provider entity
        provider_entity.load_bundled_tools(tool_bundles)

        db.session.add(provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def delete_builtin_tool_provider(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            delete tool provider
        """
        provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider,
        ).first()

        if provider is None:
            raise ValueError(f'you have not added provider {provider}')
        
        db.session.delete(provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def get_builtin_tool_provider_icon(
        provider: str
    ):
        """
            get tool provider icon and it's minetype
        """
        icon_path, mime_type = ToolManager.get_builtin_provider_icon(provider)
        with open(icon_path, 'rb') as f:
            icon_bytes = f.read()

        return icon_bytes, mime_type
    
    @staticmethod
    def delete_api_tool_provider(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            delete tool provider
        """
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider,
        ).first()

        if provider is None:
            raise ValueError(f'you have not added provider {provider}')
        
        db.session.delete(provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def get_api_tool_provider(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            get api tool provider
        """
        return ToolManager.user_get_api_provider(provider=provider, tenant_id=tenant_id)
    
    @staticmethod
    def test_api_tool_preview(
        tenant_id: str, tool_name: str, credentials: dict, parameters: dict, schema_type: str, schema: str
    ):
        """
            test api tool before adding api tool provider

            1. parse schema into tool bundle
        """
        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f'invalid schema type {schema_type}')
        
        try:
            tool_bundles, _ = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema)
        except Exception as e:
            raise ValueError(f'invalid schema')
        
        # get tool bundle
        tool_bundle = next(filter(lambda tb: tb.operation_id == tool_name, tool_bundles), None)
        if tool_bundle is None:
            raise ValueError(f'invalid tool name {tool_name}')
        
        # create a fake db provider
        db_provider = ApiToolProvider(
            tenant_id='', user_id='', name='', icon='',
            schema=schema,
            description='',
            schema_type_str=ApiProviderSchemaType.OPENAPI.value,
            tools_str=serialize_base_model_array(tool_bundles),
            credentials_str=json.dumps(credentials),
        )

        if 'auth_type' not in credentials:
            raise ValueError('auth_type is required')

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials['auth_type'])

        # create provider entity
        provider_controller = ApiBasedToolProviderController.from_db(db_provider, auth_type)
        # load tools into provider entity
        provider_controller.load_bundled_tools(tool_bundles)

        try:
            provider_controller.validate_credentials_format(credentials)
            # get tool
            tool = provider_controller.get_tool(tool_name)
            tool = tool.fork_tool_runtime(meta={
                'credentials': credentials,
                'tenant_id': tenant_id,
            })
            tool.validate_credentials(credentials, parameters)
        except Exception as e:
            return { 'error': str(e) }
        
        return { 'result': 'success' }