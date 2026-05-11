import json
import logging
from typing import Any, TypedDict, cast

from httpx import get
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.entities.provider_entities import ProviderConfig
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ApiProviderSchemaType,
)
from core.tools.errors import ApiToolProviderNotFoundError
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.encryption import create_tool_provider_encrypter
from core.tools.utils.parser import ApiBasedToolSchemaParser
from extensions.ext_database import db
from graphon.model_runtime.utils.encoders import jsonable_encoder
from models.tools import ApiToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class ApiSchemaParseResult(TypedDict):
    schema_type: str
    parameters_schema: list[dict[str, Any]]
    credentials_schema: list[dict[str, Any]]
    warning: dict[str, str]


class ApiToolManageService:
    @staticmethod
    def parser_api_schema(schema: str) -> ApiSchemaParseResult:
        """
        parse api schema to tool bundle
        """
        try:
            warnings: dict[str, str] = {}
            try:
                tool_bundles, schema_type = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema, warning=warnings)
            except Exception as e:
                raise ValueError(f"invalid schema: {str(e)}")

            credentials_schema = [
                ProviderConfig(
                    name="auth_type",
                    type=ProviderConfig.Type.SELECT,
                    required=True,
                    default="none",
                    options=[
                        ProviderConfig.Option(value="none", label=I18nObject(en_US="None", zh_Hans="无")),
                        ProviderConfig.Option(value="api_key", label=I18nObject(en_US="Api Key", zh_Hans="Api Key")),
                    ],
                    placeholder=I18nObject(en_US="Select auth type", zh_Hans="选择认证方式"),
                ),
                ProviderConfig(
                    name="api_key_header",
                    type=ProviderConfig.Type.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(en_US="Enter api key header", zh_Hans="输入 api key header，如：X-API-KEY"),
                    default="api_key",
                    help=I18nObject(en_US="HTTP header name for api key", zh_Hans="HTTP 头部字段名，用于传递 api key"),
                ),
                ProviderConfig(
                    name="api_key_value",
                    type=ProviderConfig.Type.TEXT_INPUT,
                    required=False,
                    placeholder=I18nObject(en_US="Enter api key", zh_Hans="输入 api key"),
                    default="",
                ),
            ]

            return cast(
                ApiSchemaParseResult,
                jsonable_encoder(
                    {
                        "schema_type": schema_type,
                        "parameters_schema": tool_bundles,
                        "credentials_schema": credentials_schema,
                        "warning": warnings,
                    }
                ),
            )
        except Exception as e:
            raise ValueError(f"invalid schema: {str(e)}")

    @staticmethod
    def convert_schema_to_tool_bundles(
        schema: str, extra_info: dict[str, Any] | None = None
    ) -> tuple[list[ApiToolBundle], ApiProviderSchemaType]:
        """
        convert schema to tool bundles

        :return: the list of tool bundles, description
        """
        try:
            return ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema, extra_info=extra_info)
        except Exception as e:
            raise ValueError(f"invalid schema: {str(e)}")

    @staticmethod
    def create_api_tool_provider(
        user_id: str,
        tenant_id: str,
        provider_name: str,
        icon: dict[str, Any],
        credentials: dict[str, Any],
        schema_type: ApiProviderSchemaType,
        schema: str,
        privacy_policy: str,
        custom_disclaimer: str,
        labels: list[str],
    ) -> dict[str, Any]:
        """
        Create a new API tool provider.

        :param user_id: The ID of the user creating the provider.
        :param tenant_id: The ID of the workspace/tenant.
        :param provider_name: The name of the API tool provider.
        :param icon: The icon configuration for the provider.
        :param credentials: The credentials for the provider.
        :param schema_type: The type of schema (e.g., OpenAPI).
        :param schema: The raw schema string.
        :param privacy_policy: The privacy policy URL or text.
        :param custom_disclaimer: Custom disclaimer text.
        :param labels: A list of labels for the provider.
        :return: A dictionary indicating the result status.
        """

        provider_name = provider_name.strip()

        # check if the provider exists
        # Create new session with automatic transaction management
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            provider: ApiToolProvider | None = _session.scalar(
                select(ApiToolProvider)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.name == provider_name,
                )
                .limit(1)
            )

            if provider is not None:
                raise ValueError(f"provider {provider_name} already exists")

            # parse openapi to tool bundle
            extra_info: dict[str, str] = {}
            # extra info like description will be set here
            tool_bundles, schema_type = ApiToolManageService.convert_schema_to_tool_bundles(schema, extra_info)

            if len(tool_bundles) > 100:
                raise ValueError("the number of apis should be less than 100")

            # create API tool provider
            api_tool_provider = ApiToolProvider(
                tenant_id=tenant_id,
                user_id=user_id,
                name=provider_name,
                icon=json.dumps(icon),
                schema=schema,
                description=extra_info.get("description", ""),
                schema_type_str=schema_type,
                tools_str=json.dumps(jsonable_encoder(tool_bundles)),
                credentials_str="{}",
                privacy_policy=privacy_policy,
                custom_disclaimer=custom_disclaimer,
            )

            if "auth_type" not in credentials:
                raise ValueError("auth_type is required")

            # get auth type, none or api key
            auth_type = ApiProviderAuthType.value_of(credentials["auth_type"])

            # create provider entity
            provider_controller = ApiToolProviderController.from_db(api_tool_provider, auth_type)
            # load tools into provider entity
            provider_controller.load_bundled_tools(tool_bundles)

            # encrypt credentials
            encrypter, _ = create_tool_provider_encrypter(
                tenant_id=tenant_id,
                controller=provider_controller,
            )
            api_tool_provider.credentials_str = json.dumps(encrypter.encrypt(credentials))

            _session.add(api_tool_provider)

            # update labels
            ToolLabelManager.update_tool_labels(provider_controller, labels, _session)

        return {"result": "success"}

    @staticmethod
    def get_api_tool_provider_remote_schema(user_id: str, tenant_id: str, url: str):
        """
        get api tool provider remote schema
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
            " Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            "Accept": "*/*",
        }

        try:
            response = get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                raise ValueError(f"Got status code {response.status_code}")
            schema = response.text

            # try to parse schema, avoid SSRF attack
            ApiToolManageService.parser_api_schema(schema)
        except Exception:
            logger.exception("parse api schema error")
            raise ValueError("invalid schema, please check the url you provided")

        return {"schema": schema}

    @staticmethod
    def list_api_tool_provider_tools(user_id: str, tenant_id: str, provider_name: str) -> list[ToolApiEntity]:
        """
        List tools provided by a specific API tool provider.

        :param user_id: The ID of the user requesting the list.
        :param tenant_id: The ID of the workspace/tenant.
        :param provider_name: The name of the API tool provider.
        :return: A list of ToolApiEntity objects.
        """

        # create new session with automatic transaction management
        provider: ApiToolProvider | None = None
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            provider = _session.scalar(
                select(ApiToolProvider)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.name == provider_name,
                )
                .limit(1)
            )

        if provider is None:
            raise ValueError(f"you have not added provider {provider_name}")

        controller = ToolTransformService.api_provider_to_controller(db_provider=provider)
        labels = ToolLabelManager.get_tool_labels(controller)

        return [
            ToolTransformService.convert_tool_entity_to_api_entity(
                tool_bundle,
                tenant_id=tenant_id,
                labels=labels,
            )
            for tool_bundle in provider.tools
        ]

    @staticmethod
    def update_api_tool_provider(
        user_id: str,
        tenant_id: str,
        provider_name: str,
        original_provider: str,
        icon: dict[str, Any],
        credentials: dict[str, Any],
        _schema_type: ApiProviderSchemaType,
        schema: str,
        privacy_policy: str | None,
        custom_disclaimer: str,
        labels: list[str],
    ) -> dict[str, Any]:
        """
        Update an existing API tool provider.

        :param user_id: The ID of the user updating the provider.
        :param tenant_id: The ID of the workspace/tenant.
        :param provider_name: The new name of the API tool provider.
        :param original_provider: The original name of the API tool provider.
        :param icon: The icon configuration for the provider.
        :param credentials: The credentials for the provider.
        :param _schema_type: The type of schema (e.g., OpenAPI).
        :param schema: The raw schema string.
        :param privacy_policy: The privacy policy URL or text.
        :param custom_disclaimer: Custom disclaimer text.
        :param labels: A list of labels for the provider.
        :return: A dictionary indicating the result status.
        """

        provider_name = provider_name.strip()

        # check if the provider exists
        # create new session with automatic transaction management
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            provider: ApiToolProvider | None = _session.scalar(
                select(ApiToolProvider)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.name == original_provider,
                )
                .limit(1)
            )

            if provider is None:
                raise ApiToolProviderNotFoundError(provider_name=original_provider, tenant_id=tenant_id)

            # parse openapi to tool bundle
            extra_info: dict[str, str] = {}
            # extra info like description will be set here
            tool_bundles, schema_type = ApiToolManageService.convert_schema_to_tool_bundles(schema, extra_info)

            # update db provider
            provider.name = provider_name
            provider.icon = json.dumps(icon)
            provider.schema = schema
            provider.description = extra_info.get("description", "")
            provider.schema_type_str = schema_type
            provider.tools_str = json.dumps(jsonable_encoder(tool_bundles))
            provider.privacy_policy = privacy_policy
            provider.custom_disclaimer = custom_disclaimer

            if "auth_type" not in credentials:
                raise ValueError("auth_type is required")

            # get auth type, none or api key
            auth_type = ApiProviderAuthType.value_of(credentials["auth_type"])

            # create provider entity
            provider_controller = ApiToolProviderController.from_db(provider, auth_type)
            # load tools into provider entity
            provider_controller.load_bundled_tools(tool_bundles)

            # get original credentials if exists
            encrypter, cache = create_tool_provider_encrypter(
                tenant_id=tenant_id,
                controller=provider_controller,
            )

            original_credentials = encrypter.decrypt(provider.credentials)
            masked_credentials = encrypter.mask_plugin_credentials(original_credentials)

            # check if the credential has changed, save the original credential
            for name, value in credentials.items():
                if name in masked_credentials and value == masked_credentials[name]:
                    credentials[name] = original_credentials[name]

            credentials = dict(encrypter.encrypt(credentials))
            provider.credentials_str = json.dumps(credentials)

            _session.add(provider)

            # update labels
            ToolLabelManager.update_tool_labels(provider_controller, labels, _session)

        # delete cache
        cache.delete()

        return {"result": "success"}

    @staticmethod
    def delete_api_tool_provider(user_id: str, tenant_id: str, provider_name: str):
        """
        Delete an API tool provider.

        :param user_id: The ID of the user performing the deletion operation.
        :param tenant_id: The ID of the workspace/tenant where the provider belongs.
        :param provider_name: The unique name of the API tool provider to be deleted.
        :raises ValueError: If the specified provider does not exist in the tenant.
        :return: A dictionary indicating the result status.
        """

        # create new session with automatic transaction management
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            provider: ApiToolProvider | None = _session.scalar(
                select(ApiToolProvider)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.name == provider_name,
                )
                .limit(1)
            )

            if provider is None:
                raise ValueError(f"you have not added provider {provider_name}")

            _session.delete(provider)

        return {"result": "success"}

    @staticmethod
    def get_api_tool_provider(user_id: str, tenant_id: str, provider: str) -> dict[str, Any]:
        """
        Get API tool provider details.

        :param user_id: The ID of the user requesting the provider.
        :param tenant_id: The ID of the workspace/tenant.
        :param provider: The name of the API tool provider.
        :return: A dictionary containing the provider details.
        """
        return ToolManager.user_get_api_provider(provider=provider, tenant_id=tenant_id)

    @staticmethod
    def test_api_tool_preview(
        tenant_id: str,
        provider_name: str,
        tool_name: str,
        credentials: dict[str, Any],
        parameters: dict[str, Any],
        schema_type: ApiProviderSchemaType,
        schema: str,
    ) -> dict[str, Any]:
        """
        Test an API tool before adding the API tool provider.

        :param tenant_id: The ID of the workspace/tenant.
        :param provider_name: The name of the API tool provider.
        :param tool_name: The name of the specific tool to test.
        :param credentials: The credentials for the provider.
        :param parameters: The parameters to pass to the tool.
        :param schema_type: The type of schema (e.g., OpenAPI).
        :param schema: The raw schema string.
        :return: A dictionary containing the result or error message.
        """

        if schema_type not in [member.value for member in ApiProviderSchemaType]:
            raise ValueError(f"invalid schema type {schema_type}")

        try:
            tool_bundles, _ = ApiBasedToolSchemaParser.auto_parse_to_tool_bundle(schema)
        except Exception:
            raise ValueError("invalid schema")

        # get tool bundle
        tool_bundle = next(filter(lambda tb: tb.operation_id == tool_name, tool_bundles), None)
        if tool_bundle is None:
            raise ValueError(f"invalid tool name {tool_name}")

        # create new session with automatic transaction management to get the provider
        provider: ApiToolProvider | None = None
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            provider = _session.scalar(
                select(ApiToolProvider)
                .where(
                    ApiToolProvider.tenant_id == tenant_id,
                    ApiToolProvider.name == provider_name,
                )
                .limit(1)
            )

        if provider is None:
            # create a fake db provider
            provider = ApiToolProvider(
                tenant_id="",
                user_id="",
                name="",
                icon="",
                schema=schema,
                description="",
                schema_type_str=ApiProviderSchemaType.OPENAPI,
                tools_str=json.dumps(jsonable_encoder(tool_bundles)),
                credentials_str=json.dumps(credentials),
            )

        if "auth_type" not in credentials:
            raise ValueError("auth_type is required")

        # get auth type, none or api key
        auth_type = ApiProviderAuthType.value_of(credentials["auth_type"])

        # create provider entity
        provider_controller = ApiToolProviderController.from_db(provider, auth_type)
        # load tools into provider entity
        provider_controller.load_bundled_tools(tool_bundles)

        # decrypt credentials
        if provider.id:
            encrypter, _ = create_tool_provider_encrypter(
                tenant_id=tenant_id,
                controller=provider_controller,
            )
            decrypted_credentials = encrypter.decrypt(credentials)
            # check if the credential has changed, save the original credential
            masked_credentials = encrypter.mask_plugin_credentials(decrypted_credentials)
            for name, value in credentials.items():
                if name in masked_credentials and value == masked_credentials[name]:
                    credentials[name] = decrypted_credentials[name]

        try:
            provider_controller.validate_credentials_format(credentials)
            # get tool
            tool = provider_controller.get_tool(tool_name)
            tool = tool.fork_tool_runtime(
                runtime=ToolRuntime(
                    credentials=credentials,
                    tenant_id=tenant_id,
                )
            )
            result = tool.validate_credentials(credentials, parameters)
        except Exception as e:
            return {"error": str(e)}

        return {"result": result or "empty response"}

    @staticmethod
    def list_api_tools(tenant_id: str) -> list[ToolProviderApiEntity]:
        """
        List all API tools for a specific tenant.

        :param tenant_id: The ID of the workspace/tenant.
        :return: A list of ToolProviderApiEntity objects.
        """
        # get all api providers
        # create new session with automatic transaction management
        providers: list[ApiToolProvider] = []
        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            providers = list(
                _session.scalars(select(ApiToolProvider).where(ApiToolProvider.tenant_id == tenant_id)).all()
            )

        result: list[ToolProviderApiEntity] = []
        for provider in providers:
            # convert provider controller to user provider
            provider_controller = ToolTransformService.api_provider_to_controller(db_provider=provider)
            labels = ToolLabelManager.get_tool_labels(provider_controller)
            user_provider = ToolTransformService.api_provider_to_user_provider(
                provider_controller, db_provider=provider, decrypt_credentials=True
            )
            user_provider.labels = labels

            # add icon
            ToolTransformService.repack_provider(tenant_id=tenant_id, provider=user_provider)

            tools = provider_controller.get_tools(tenant_id=tenant_id)

            for tool in tools or []:
                user_provider.tools.append(
                    ToolTransformService.convert_tool_entity_to_api_entity(
                        tenant_id=tenant_id, tool=tool, labels=labels
                    )
                )

            result.append(user_provider)

        return result
