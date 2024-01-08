from typing import List

from core.tools.tool_manager import ToolManager
from core.tools.entities.user_entities import UserToolProvider
from core.tools.entities.tool_entities import ApiProviderSchemaType, ApiProviderAuthType, ToolProviderCredentials, \
    ToolCredentialsOption
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.provider.api_tool_provider import ApiBasedToolProviderEntity
from core.tools.utils.parser import ApiBasedToolSchemaParser
from core.tools.utils.encoder import serialize_base_model_array, serialize_base_model_dict
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError, ToolNotFoundError

from extensions.ext_database import db
from models.tools import BuiltinToolProvider, ApiToolProvider

import json

class ToolManageService:
    @staticmethod
    def list_tool_providers(user_id: str, tanent_id: str):
        """
            list tool providers

            :return: the list of tool providers
        """
        return [
            provider.to_dict() for provider in ToolManager.user_list_providers(
                user_id,
                tanent_id,
            )
        ]
    
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
            v.to_dict() for _, v in provider.credentials_schema.items()
        ]

    @staticmethod
    def parser_api_schema(
        schema_type: str, schema: str
    ) -> List[ApiBasedToolBundle]:
        """
            parse api schema to tool bundle
        """
        try:
            if schema_type == ApiProviderSchemaType.OPENAPI.value:
                tool_bundles = ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(schema)
            elif schema_type == ApiProviderSchemaType.OPENAI_PLUGIN.value:
                tool_bundles = ApiBasedToolSchemaParser.parse_openai_plugin_json_to_tool_bundle(schema)
            else:
                raise ValueError(f'invalid schema type {schema_type}')
            credentails_schema = [
                ToolProviderCredentials(
                    name='auth_type',
                    type=ToolProviderCredentials.CredentialsType.SELECT,
                    required=True,
                    default='none',
                    options=[
                        ToolCredentialsOption(value='none', label=I18nObject(
                            en_US='None',
                            zh_CN='无'
                        )),
                        ToolCredentialsOption(value='api_key', label=I18nObject(
                            en_US='Api Key',
                            zh_CN='Api Key'
                        )),
                    ],
                    placeholder=I18nObject(
                        en_US='Select auth type',
                        zh_CN='选择认证方式'
                    )
                ),
                ToolProviderCredentials(
                    name='api_key_header',
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(
                        en_US='Enter api key header',
                        zh_CN='输入 api key header，如：X-API-KEY'
                    ),
                    default='api_key',
                    help=I18nObject(
                        en_US='HTTP header name for api key',
                        zh_CN='HTTP 头部字段名，用于传递 api key'
                    )
                ),
                ToolProviderCredentials(
                    name='api_key_value',
                    type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(
                        en_US='Enter api key',
                        zh_CN='输入 api key'
                    ),
                    default=''
                ),
            ]

            return json.loads(serialize_base_model_dict(
                {
                    'parameters_schema': tool_bundles,
                    'credentials_schema': credentails_schema,
                }
            ))
        except Exception as e:
            raise ValueError(f'invalid schema: {str(e)}')

    @staticmethod
    def create_builtin_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, credentials: dict
    ):
        """
            create builtin tool provider
        """
        # get if the provider exists
        provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider_name,
        ).first()

        if provider is not None:
            raise ValueError(f'provider {provider_name} already exists')
        
        try: 
            # get provider
            provider = ToolManager.get_builtin_provider(provider_name)
            # validate credentials
            provider.validate_credentials(credentials)
        except (ToolProviderNotFoundError, ToolNotFoundError, ToolProviderCredentialValidationError) as e:
            raise ValueError(str(e))

        # create provider
        provider = BuiltinToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            provider=provider_name,
            encrypted_credentials=json.dumps(credentials),
        )

        db.session.add(provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def create_api_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, icon: str, description: str, credentails: dict, parameters: dict, schema_type: str, schema: str
    ):
        """
            create api tool provider
        """
        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f'invalid schema type {schema}')
        
        if schema_type == ApiProviderSchemaType.OPENAPI.value:
            return ToolManageService.create_openapi_tool_provider(
                user_id, tenant_id, provider_name, icon, description,
                credentails, parameters, schema
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

        if provider is None:
            raise ValueError(f'provider {provider_name} does not exists')
        
        try: 
            # get provider
            provider_controller = ToolManager.get_builtin_provider(provider_name)
            # validate credentials
            provider_controller.validate_credentials(credentials)
        except (ToolProviderNotFoundError, ToolNotFoundError, ToolProviderCredentialValidationError) as e:
            raise ValueError(str(e))

        provider.encrypted_credentials = json.dumps(credentials)

        db.session.add(provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def update_api_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, icon: str, description: str, credentails: dict, parameters: dict, schema_type: str, schema: str
    ):
        """
            update api tool provider
        """
        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f'invalid schema type {schema}')
        
        if schema_type == ApiProviderSchemaType.OPENAPI.value:
            return ToolManageService.update_openapi_tool_provider(
                user_id, tenant_id, provider_name, icon, description,
                credentails, parameters, schema
            )

    @staticmethod
    def create_openapi_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, icon: str, 
        description: str,
        credentials: dict, parameters: dict, schema: str
    ):
        """
            create openapi tool provider
        """
        # check if the provider exists
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider_name,
        ).first()

        if provider is not None:
            raise ValueError(f'provider {provider_name} already exists')

        # parse openapi to tool bundle
        try:
            tool_bundles: List[ApiBasedToolBundle] = ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(schema)
        except Exception as e:
            raise ValueError('invalid openapi schema: ' + str(e))
        
        # create db provider
        db_provider = ApiToolProvider(
            tenant_id=tenant_id,
            user_id=user_id,
            name=provider_name,
            icon=icon,
            schema=schema,
            description=description,
            schema_type_str=ApiProviderSchemaType.OPENAPI.value,
            tools_str=serialize_base_model_array(tool_bundles),
            credentials_str=json.dumps(credentials),
        )

        if 'auth_type' not in credentials:
            raise ValueError('auth_type is required')

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials['auth_type'])

        # create provider entity
        provider_entity = ApiBasedToolProviderEntity.from_db(db_provider, auth_type)
        # load tools into provider entity
        provider_entity.load_bundled_tools(tool_bundles)

        for tool_bundle in tool_bundles:
            # validate credentials for each tool
            try:
                tool = provider_entity.get_tool(tool_bundle.operation_id)
                tool.validate_credentials(credentials, parameters.get(tool_bundle.operation_id, {}))
            except ToolProviderCredentialValidationError as e:
                raise ValueError(str(e))

        db.session.add(db_provider)
        db.session.commit()

        return { 'result': 'success' }
    
    @staticmethod
    def update_openapi_tool_provider(
        user_id: str, tenant_id: str, provider_name: str, icon: str, 
        description: str,
        credentials: dict, parameters: dict, schema: str
    ):
        """
            update openapi tool provider
        """
        # check if the provider exists
        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
            ApiToolProvider.tenant_id == tenant_id,
            ApiToolProvider.name == provider_name,
        ).first()

        if provider is None:
            raise ValueError(f'api provider {provider_name} does not exists')

        # parse openapi to tool bundle
        try:
            tool_bundles: List[ApiBasedToolBundle] = ApiBasedToolSchemaParser.parse_openapi_yaml_to_tool_bundle(schema)
        except Exception as e:
            raise ValueError('invalid openapi schema: ' + str(e))
        
        # update db provider
        provider.icon = icon
        provider.schema = schema
        provider.description = description
        provider.schema_type_str = ApiProviderSchemaType.OPENAPI.value
        provider.tools_str = serialize_base_model_array(tool_bundles)
        provider.credentials_str = json.dumps(credentials)

        if 'auth_type' not in credentials:
            raise ValueError('auth_type is required')

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials['auth_type'])

        # create provider entity
        provider_entity = ApiBasedToolProviderEntity.from_db(provider, auth_type)
        # load tools into provider entity
        provider_entity.load_bundled_tools(tool_bundles)

        for tool_bundle in tool_bundles:
            # validate credentials for each tool
            try:
                tool = provider_entity.get_tool(tool_bundle.operation_id)
                tool.validate_credentials(credentials, parameters.get(tool_bundle.operation_id, {}))
            except ToolProviderCredentialValidationError as e:
                raise ValueError(str(e))

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
            raise ValueError(f'yout have not added provider {provider}')
        
        db.session.delete(provider)
        db.session.commit()

        return { 'result': 'success' }
    
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
            raise ValueError(f'yout have not added provider {provider}')
        
        db.session.delete(provider)
        db.session.commit()

        return { 'result': 'success' }