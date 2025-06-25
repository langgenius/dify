import json
import logging
import re
from pathlib import Path

from sqlalchemy import ColumnExpressionArgument
from sqlalchemy.orm import Session

from configs import dify_config
from core.helper.position_helper import is_filtered
from core.model_runtime.utils.encoders import jsonable_encoder
from core.plugin.entities.plugin import ToolProviderID
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity, ToolProviderCredentialApiEntity
from core.tools.entities.tool_entities import ToolProviderCredentialType
from core.tools.errors import ToolNotFoundError, ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ProviderConfigEncrypter
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
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
        user_id: str, tenant_id: str, provider_name: str, credentials: dict, credential_id: str, name: str | None = None
    ):
        """
        update builtin tool provider
        """
        # get if the provider exists
        provider = BuiltinToolManageService._fetch_builtin_provider_by_id(tenant_id, credential_id)

        if provider is None:
            raise ValueError(f"you have not added provider {provider_name}")

        try:
            if ToolProviderCredentialType.of(provider.credential_type).is_editable():
                provider_controller = ToolManager.get_builtin_provider(provider_name, tenant_id)
                if not provider_controller.need_credentials:
                    raise ValueError(f"provider {provider_name} does not need credentials")

                tool_configuration = ProviderConfigEncrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
                    provider_type=provider_controller.provider_type.value,
                    provider_identity=provider_controller.entity.identity.name,
                )

                # Decrypt and restore original credentials for masked values
                original_credentials = tool_configuration.decrypt(provider.credentials)
                masked_credentials = tool_configuration.mask_tool_credentials(original_credentials)

                # check if the credential has changed, save the original credential
                for name, value in credentials.items():
                    if name in masked_credentials and value == masked_credentials[name]:  # type: ignore
                        credentials[name] = original_credentials[name]  # type: ignore

                # Encrypt and save the credentials
                BuiltinToolManageService._encrypt_and_save_credentials(
                    provider_controller, tool_configuration, provider, credentials, user_id
                )
            else:
                raise ValueError(f"provider {provider_name} is not editable, you can only delete it and add a new one")

            # update name if provided
            if name is not None and provider.name != name:
                provider.name = name

            db.session.commit()
        except (
            PluginDaemonClientSideError,
            ToolProviderNotFoundError,
            ToolNotFoundError,
            ToolProviderCredentialValidationError,
        ) as e:
            raise ValueError(str(e))

        return {"result": "success"}

    @staticmethod
    def add_builtin_tool_provider(
        user_id: str,
        api_type: ToolProviderCredentialType,
        tenant_id: str,
        provider_name: str,
        credentials: dict,
        name: str | None = None,
    ):
        """
        add builtin tool provider
        """
        lock_name = f"builtin_tool_provider_credential_lock_{tenant_id}_{provider_name}_{api_type.value}"
        with redis_client.lock(lock_name, timeout=20):
            if name is None:
                name = BuiltinToolManageService.get_next_builtin_tool_provider_name(tenant_id, provider_name, api_type)

            provider = BuiltinToolProvider(
                tenant_id=tenant_id,
                user_id=user_id,
                provider=provider_name,
                encrypted_credentials=json.dumps(credentials),
                credential_type=api_type.value,
                name=name,
            )

            provider_controller = ToolManager.get_builtin_provider(provider_name, tenant_id)
            if not provider_controller.need_credentials:
                raise ValueError(f"provider {provider_name} does not need credentials")

            tool_configuration = ProviderConfigEncrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
                provider_type=provider_controller.provider_type.value,
                provider_identity=provider_controller.entity.identity.name,
            )

            # Encrypt and save the credentials
            BuiltinToolManageService._encrypt_and_save_credentials(
                provider_controller, tool_configuration, provider, credentials, user_id
            )
            db.session.add(provider)
            db.session.commit()
        return {"result": "success"}

    @staticmethod
    def get_next_builtin_tool_provider_name(
        tenant_id: str, provider_name: str, type: ToolProviderCredentialType
    ) -> str:
        try:
            providers = (
                db.session.query(BuiltinToolProvider)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=provider_name,
                    credential_type=type.value,
                )
                .order_by(BuiltinToolProvider.created_at.desc())
                .limit(10)
                .all()
            )

            # Get the default name pattern
            default_pattern = type.get_name()

            # Find all names that match the default pattern: "{default_pattern} {number}"
            pattern = rf"^{re.escape(default_pattern)}\s+(\d+)$"
            numbers = []

            for provider in providers:
                if provider.name:
                    match = re.match(pattern, provider.name.strip())
                    if match:
                        numbers.append(int(match.group(1)))

            # If no default pattern names found, start with 1
            if not numbers:
                return f"{default_pattern} 1"

            # Find the next number
            max_number = max(numbers)
            return f"{default_pattern} {max_number + 1}"
        except Exception as e:
            logger.warning(f"Error generating next provider name for {provider_name}: {str(e)}")
            # fallback
            return f"{type.get_name()} 1"

    @staticmethod
    def get_builtin_tool_provider_credentials(
        tenant_id: str, provider_name: str
    ) -> list[ToolProviderCredentialApiEntity]:
        """
        get builtin tool provider credentials
        """
        providers = db.session.query(BuiltinToolProvider).filter_by(tenant_id=tenant_id, provider=provider_name).all()

        if len(providers) == 0:
            return []

        provider_controller = ToolManager.get_builtin_provider(providers[0].provider, tenant_id)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_credentials_schema()],
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.entity.identity.name,
        )
        credentials: list[ToolProviderCredentialApiEntity] = []
        for provider in providers:
            decrypt_credential = tool_configuration.mask_tool_credentials(
                tool_configuration.decrypt(provider.credentials)
            )
            credentials.append(
                ToolTransformService.convert_builtin_provider_to_credential_api_entity(
                    provider=provider,
                    credentials=decrypt_credential,
                )
            )
        return credentials

    @staticmethod
    def delete_builtin_tool_provider(tenant_id: str, provider_name: str, credential_id: str):
        """
        delete tool provider
        """
        provider_obj = BuiltinToolManageService._fetch_builtin_provider_by_id(tenant_id, credential_id)

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
    def set_default_provider(tenant_id: str, user_id: str, provider: str, id: str):
        """
        set default provider
        """
        with Session(db.engine) as session:
            # get provider
            target_provider = session.query(BuiltinToolProvider).filter_by(id=id).first()
            if target_provider is None:
                raise ValueError("provider not found")

            # clear default provider
            session.query(BuiltinToolProvider).filter_by(
                tenant_id=tenant_id, user_id=user_id, provider=provider, default=True
            ).update({"default": False})

            # set new default provider
            target_provider.is_default = True
            session.commit()
        return {"result": "success"}

    @staticmethod
    def get_builtin_tool_oauth_client(tenant_id: str, provider: str, plugin_id: str):
        """
        get builtin tool provider
        """
        with Session(db.engine) as session:
            user_client = (
                session.query(ToolOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=provider,
                    plugin_id=plugin_id,
                    enabled=True,
                )
                .first()
            )
            if user_client:
                plugin_oauth_config = user_client
            else:
                plugin_oauth_config = session.query(ToolOAuthSystemClient).filter_by(provider=provider).first()

            if plugin_oauth_config:
                return plugin_oauth_config

        raise ValueError("no oauth available config found for this plugin")

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
    def _fetch_builtin_provider_by_id(tenant_id: str, credential_id: str) -> BuiltinToolProvider | None:
        provider = (
            db.session.query(BuiltinToolProvider)
            .filter(
                BuiltinToolProvider.tenant_id == tenant_id,
                BuiltinToolProvider.id == credential_id,
            )
            .first()
        )
        return provider

    @staticmethod
    def _fetch_builtin_provider(provider_name: str, tenant_id: str) -> BuiltinToolProvider | None:
        """
        This method is used to fetch the builtin provider from the database
        1.if the default provider exists, return the default provider
        2.if the default provider does not exist, return the oldest provider
        """

        def _query(provider_filters: list[ColumnExpressionArgument[bool]]):
            return (
                db.session.query(BuiltinToolProvider)
                .filter(BuiltinToolProvider.tenant_id == tenant_id, *provider_filters)
                .order_by(
                    BuiltinToolProvider.is_default.desc(),  # default=True first
                    BuiltinToolProvider.created_at.asc(),  # oldest first
                )
                .first()
            )

        try:
            full_provider_name = provider_name
            provider_id_entity = ToolProviderID(provider_name)
            provider_name = provider_id_entity.provider_name

            if provider_id_entity.organization != "langgenius":
                provider = _query([BuiltinToolProvider.provider == full_provider_name])
            else:
                provider = _query(
                    [
                        (BuiltinToolProvider.provider == provider_name)
                        | (BuiltinToolProvider.provider == full_provider_name)
                    ]
                )

            if provider is None:
                return None

            provider.provider = ToolProviderID(provider.provider).to_string()
            return provider
        except Exception:
            # it's an old provider without organization
            provider_obj = _query([BuiltinToolProvider.provider == provider_name])
            return provider_obj

    @staticmethod
    def _decrypt_and_restore_credentials(tool_configuration, provider, credentials):
        """
        Decrypt original credentials and restore masked values from the input credentials

        :param tool_configuration: the tool configuration encrypter
        :param provider: the provider object from database
        :param credentials: the input credentials from user
        :return: the processed credentials with original values restored
        """

        return credentials

    @staticmethod
    def _encrypt_and_save_credentials(provider_controller, tool_configuration, provider, credentials, user_id):
        """
        Validate and encrypt credentials, then save to database

        :param provider_controller: the provider controller
        :param tool_configuration: the tool configuration encrypter
        :param provider: the provider object from database
        :param credentials: the credentials to encrypt and save
        :param user_id: the user id for validation
        """
        if ToolProviderCredentialType.of(provider.credential_type).is_validate_allowed():
            provider_controller.validate_credentials(user_id, credentials)

        # encrypt credentials
        encrypted_credentials = tool_configuration.encrypt(credentials)
        provider.encrypted_credentials = json.dumps(encrypted_credentials)
        tool_configuration.delete_tool_credentials_cache()
