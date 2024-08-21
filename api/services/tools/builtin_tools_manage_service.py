import json
import logging

from configs import dify_config
from core.helper.position_helper import is_filtered
from core.model_runtime.utils.encoders import jsonable_encoder
from core.tools.entities.api_entities import UserTool, UserToolProvider
from core.tools.errors import ToolNotFoundError, ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.provider.builtin._positions import BuiltinToolProviderSort
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolConfigurationManager
from extensions.ext_database import db
from models.tools import BuiltinToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class BuiltinToolManageService:
    @staticmethod
    def list_builtin_tool_provider_tools(
        user_id: str, tenant_id: str, provider: str
    ) -> list[UserTool]:
        """
            list builtin tool provider tools
        """
        provider_controller: ToolProviderController = ToolManager.get_builtin_provider(provider)
        tools = provider_controller.get_tools()

        tool_provider_configurations = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=provider_controller)
        # check if user has added the provider
        builtin_provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider,
        ).first()

        credentials = {}
        if builtin_provider is not None:
            # get credentials
            credentials = builtin_provider.credentials
            credentials = tool_provider_configurations.decrypt_tool_credentials(credentials)

        result = []
        for tool in tools:
            result.append(ToolTransformService.tool_to_user_tool(
                tool=tool,
                credentials=credentials,
                tenant_id=tenant_id,
                labels=ToolLabelManager.get_tool_labels(provider_controller)
            ))

        return result

    @staticmethod
    def list_builtin_provider_credentials_schema(
        provider_name
    ):
        """
            list builtin provider credentials schema

            :return: the list of tool providers
        """
        provider = ToolManager.get_builtin_provider(provider_name)
        return jsonable_encoder([
            v for _, v in (provider.credentials_schema or {}).items()
        ])

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
            tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=provider_controller)
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

            # delete cache
            tool_configuration.delete_tool_credentials_cache()

        return {'result': 'success'}

    @staticmethod
    def get_builtin_tool_provider_credentials(
        user_id: str, tenant_id: str, provider: str
    ):
        """
            get builtin tool provider credentials
        """
        provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider,
        ).first()

        if provider is None:
            return {}

        provider_controller = ToolManager.get_builtin_provider(provider.provider)
        tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=provider_controller)
        credentials = tool_configuration.decrypt_tool_credentials(provider.credentials)
        credentials = tool_configuration.mask_tool_credentials(credentials)
        return credentials

    @staticmethod
    def delete_builtin_tool_provider(
        user_id: str, tenant_id: str, provider_name: str
    ):
        """
            delete tool provider
        """
        provider: BuiltinToolProvider = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider == provider_name,
        ).first()

        if provider is None:
            raise ValueError(f'you have not added provider {provider_name}')

        db.session.delete(provider)
        db.session.commit()

        # delete cache
        provider_controller = ToolManager.get_builtin_provider(provider_name)
        tool_configuration = ToolConfigurationManager(tenant_id=tenant_id, provider_controller=provider_controller)
        tool_configuration.delete_tool_credentials_cache()

        return {'result': 'success'}

    @staticmethod
    def get_builtin_tool_provider_icon(
        provider: str
    ):
        """
            get tool provider icon and it's mimetype
        """
        icon_path, mime_type = ToolManager.get_builtin_provider_icon(provider)
        with open(icon_path, 'rb') as f:
            icon_bytes = f.read()

        return icon_bytes, mime_type

    @staticmethod
    def list_builtin_tools(
        user_id: str, tenant_id: str
    ) -> list[UserToolProvider]:
        """
            list builtin tools
        """
        # get all builtin providers
        provider_controllers = ToolManager.list_builtin_providers()

        # get all user added providers
        db_providers: list[BuiltinToolProvider] = db.session.query(BuiltinToolProvider).filter(
            BuiltinToolProvider.tenant_id == tenant_id
        ).all() or []

        # find provider
        find_provider = lambda provider: next(filter(lambda db_provider: db_provider.provider == provider, db_providers), None)

        result: list[UserToolProvider] = []

        for provider_controller in provider_controllers:
            try:
                # handle include, exclude
                if is_filtered(
                    include_set=dify_config.POSITION_TOOL_INCLUDES_SET,
                    exclude_set=dify_config.POSITION_TOOL_EXCLUDES_SET,
                    data=provider_controller,
                    name_func=lambda x: x.identity.name
                ):
                    continue

                # convert provider controller to user provider
                user_builtin_provider = ToolTransformService.builtin_provider_to_user_provider(
                    provider_controller=provider_controller,
                    db_provider=find_provider(provider_controller.identity.name),
                    decrypt_credentials=True
                )

                # add icon
                ToolTransformService.repack_provider(user_builtin_provider)

                tools = provider_controller.get_tools()
                for tool in tools:
                    user_builtin_provider.tools.append(ToolTransformService.tool_to_user_tool(
                        tenant_id=tenant_id,
                        tool=tool,
                        credentials=user_builtin_provider.original_credentials,
                        labels=ToolLabelManager.get_tool_labels(provider_controller)
                    ))

                result.append(user_builtin_provider)
            except Exception as e:
                raise e

        return BuiltinToolProviderSort.sort(result)
