import json
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from configs import dify_config
from core.helper.position_helper import is_filtered
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import GenericProviderID, ToolProviderID
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.errors import ToolNotFoundError, ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ProviderConfigEncrypter
from extensions.ext_database import db
from models.tools import BuiltinToolProvider
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class BuiltinToolManageService:
    @staticmethod
    def list_builtin_tool_provider_tools(tenant_id: str, provider: str) -> list[ToolApiEntity]:
        """
        list builtin tool provider tools

        :param tenant_id: the id of the tenant
        :param provider: the name of the provider

        :return: the list of tools
        """
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        tools = provider_controller.get_tools()

        tool_provider_configurations = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.entity.identity.name,
        )
        # check if user has added the provider
        builtin_provider = BuiltinToolManageService._fetch_builtin_provider(provider, tenant_id)

        credentials = {}
        if builtin_provider is not None:
            # get credentials
            credentials = builtin_provider.credentials
            credentials = tool_provider_configurations.decrypt(credentials)

        result: list[ToolApiEntity] = []
        for tool in tools or []:
            result.append(
                ToolTransformService.convert_tool_entity_to_api_entity(
                    tool=tool,
                    credentials=credentials,
                    tenant_id=tenant_id,
                    labels=ToolLabelManager.get_tool_labels(provider_controller),
                )
            )

        return result

    @staticmethod
    def get_builtin_tool_provider_info(user_id: str, tenant_id: str, provider: str):
        """
        get builtin tool provider info
        """
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        tool_provider_configurations = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.entity.identity.name,
        )
        # check if user has added the provider
        builtin_provider = BuiltinToolManageService._fetch_builtin_provider(provider, tenant_id)

        credentials = {}
        if builtin_provider is not None:
            # get credentials
            credentials = builtin_provider.credentials
            credentials = tool_provider_configurations.decrypt(credentials)

        entity = ToolTransformService.builtin_provider_to_user_provider(
            provider_controller=provider_controller,
            db_provider=builtin_provider,
            decrypt_credentials=True,
        )

        entity.original_credentials = {}

        return entity

    @staticmethod
    def list_builtin_provider_credentials_schema(provider_name: str, tenant_id: str):
        """
        list builtin provider credentials schema

        :param provider_name: the name of the provider
        :param tenant_id: the id of the tenant
        :return: the list of tool providers
        """
        provider = ToolManager.get_builtin_provider(provider_name, tenant_id)
        return jsonable_encoder(provider.get_credentials_schema())

    @staticmethod
    def update_builtin_tool_provider(
        session: Session, user_id: str, tenant_id: str, provider_name: str, credentials: dict
    ):
        """
        update builtin tool provider
        """
        # get if the provider exists
        provider = BuiltinToolManageService._fetch_builtin_provider(provider_name, tenant_id)

        try:
            # get provider
            provider_controller = ToolManager.get_builtin_provider(provider_name, tenant_id)
            if not provider_controller.need_credentials:
                raise ValueError(f"provider {provider_name} does not need credentials")
            tool_configuration = ProviderConfigEncrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
                provider_type=provider_controller.provider_type.value,
                provider_identity=provider_controller.entity.identity.name,
            )

            # get original credentials if exists
            if provider is not None:
                original_credentials = tool_configuration.decrypt(provider.credentials)
                masked_credentials = tool_configuration.mask_tool_credentials(original_credentials)
                # check if the credential has changed, save the original credential
                for name, value in credentials.items():
                    if name in masked_credentials and value == masked_credentials[name]:
                        credentials[name] = original_credentials[name]
            # validate credentials
            provider_controller.validate_credentials(user_id, credentials)
            # encrypt credentials
            credentials = tool_configuration.encrypt(credentials)
        except (
            PluginDaemonClientSideError,
            ToolProviderNotFoundError,
            ToolNotFoundError,
            ToolProviderCredentialValidationError,
        ) as e:
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
        else:
            provider.encrypted_credentials = json.dumps(credentials)

            # delete cache
            tool_configuration.delete_tool_credentials_cache()

        db.session.commit()
        return {"result": "success"}

    @staticmethod
    def get_builtin_tool_provider_credentials(tenant_id: str, provider_name: str):
        """
        get builtin tool provider credentials
        """
        provider_obj = BuiltinToolManageService._fetch_builtin_provider(provider_name, tenant_id)

        if provider_obj is None:
            return {}

        provider_controller = ToolManager.get_builtin_provider(provider_obj.provider, tenant_id)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.entity.identity.name,
        )
        credentials = tool_configuration.decrypt(provider_obj.credentials)
        credentials = tool_configuration.mask_tool_credentials(credentials)
        return credentials

    @staticmethod
    def delete_builtin_tool_provider(user_id: str, tenant_id: str, provider_name: str):
        """
        delete tool provider
        """
        provider_obj = BuiltinToolManageService._fetch_builtin_provider(provider_name, tenant_id)

        if provider_obj is None:
            raise ValueError(f"you have not added provider {provider_name}")

        db.session.delete(provider_obj)
        db.session.commit()

        # delete cache
        provider_controller = ToolManager.get_builtin_provider(provider_name, tenant_id)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.entity.identity.name,
        )
        tool_configuration.delete_tool_credentials_cache()

        return {"result": "success"}

    @staticmethod
    def get_builtin_tool_provider_icon(provider: str):
        """
        get tool provider icon and it's mimetype
        """
        icon_path, mime_type = ToolManager.get_hardcoded_provider_icon(provider)
        icon_bytes = Path(icon_path).read_bytes()

        return icon_bytes, mime_type

    @staticmethod
    def list_builtin_tools(user_id: str, tenant_id: str) -> list[ToolProviderApiEntity]:
        """
        list builtin tools
        """
        # get all builtin providers
        provider_controllers = ToolManager.list_builtin_providers(tenant_id)

        with db.session.no_autoflush:
            # get all user added providers
            db_providers: list[BuiltinToolProvider] = (
                db.session.query(BuiltinToolProvider).filter(BuiltinToolProvider.tenant_id == tenant_id).all() or []
            )

            # rewrite db_providers
            for db_provider in db_providers:
                db_provider.provider = str(ToolProviderID(db_provider.provider))

            # find provider
            def find_provider(provider):
                return next(filter(lambda db_provider: db_provider.provider == provider, db_providers), None)

            result: list[ToolProviderApiEntity] = []

            for provider_controller in provider_controllers:
                try:
                    # handle include, exclude
                    if is_filtered(
                        include_set=dify_config.POSITION_TOOL_INCLUDES_SET,  # type: ignore
                        exclude_set=dify_config.POSITION_TOOL_EXCLUDES_SET,  # type: ignore
                        data=provider_controller,
                        name_func=lambda x: x.identity.name,
                    ):
                        continue

                    # convert provider controller to user provider
                    user_builtin_provider = ToolTransformService.builtin_provider_to_user_provider(
                        provider_controller=provider_controller,
                        db_provider=find_provider(provider_controller.entity.identity.name),
                        decrypt_credentials=True,
                    )

                    # add icon
                    ToolTransformService.repack_provider(tenant_id=tenant_id, provider=user_builtin_provider)

                    tools = provider_controller.get_tools()
                    for tool in tools or []:
                        user_builtin_provider.tools.append(
                            ToolTransformService.convert_tool_entity_to_api_entity(
                                tenant_id=tenant_id,
                                tool=tool,
                                credentials=user_builtin_provider.original_credentials,
                                labels=ToolLabelManager.get_tool_labels(provider_controller),
                            )
                        )

                    result.append(user_builtin_provider)
                except Exception as e:
                    raise e

        return BuiltinToolProviderSort.sort(result)

    @staticmethod
    def _fetch_builtin_provider(provider_name: str, tenant_id: str) -> BuiltinToolProvider | None:
        try:
            full_provider_name = provider_name
            provider_id_entity = GenericProviderID(provider_name)
            provider_name = provider_id_entity.provider_name
            if provider_id_entity.organization != "langgenius":
                provider_obj = (
                    db.session.query(BuiltinToolProvider)
                    .filter(
                        BuiltinToolProvider.tenant_id == tenant_id,
                        BuiltinToolProvider.provider == full_provider_name,
                    )
                    .first()
                )
            else:
                provider_obj = (
                    db.session.query(BuiltinToolProvider)
                    .filter(
                        BuiltinToolProvider.tenant_id == tenant_id,
                        (BuiltinToolProvider.provider == provider_name)
                        | (BuiltinToolProvider.provider == full_provider_name),
                    )
                    .first()
                )

            if provider_obj is None:
                return None

            provider_obj.provider = GenericProviderID(provider_obj.provider).to_string()
            return provider_obj
        except Exception:
            # it's an old provider without organization
            return (
                db.session.query(BuiltinToolProvider)
                .filter(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    (BuiltinToolProvider.provider == provider_name),
                )
                .first()
            )
