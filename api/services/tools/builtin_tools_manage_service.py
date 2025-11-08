import json
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper.name_generator import generate_incremental_name
from core.helper.position_helper import is_filtered
from core.helper.provider_cache import NoOpProviderCredentialCache, ToolProviderCredentialsCache
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.builtin_tool.providers._positions import BuiltinToolProviderSort
from core.tools.entities.api_entities import (
    ToolApiEntity,
    ToolProviderApiEntity,
    ToolProviderCredentialApiEntity,
    ToolProviderCredentialInfoApiEntity,
)
from core.tools.entities.tool_entities import CredentialType
from core.tools.errors import ToolProviderNotFoundError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_label_manager import ToolLabelManager
from core.tools.tool_manager import ToolManager
from core.tools.utils.encryption import create_provider_encrypter
from core.tools.utils.system_oauth_encryption import decrypt_system_oauth_params
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.provider_ids import ToolProviderID
from models.tools import BuiltinToolProvider, ToolOAuthSystemClient, ToolOAuthTenantClient
from services.plugin.plugin_service import PluginService
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)


class BuiltinToolManageService:
    __MAX_BUILTIN_TOOL_PROVIDER_COUNT__ = 100
    __DEFAULT_EXPIRES_AT__ = 2147483647

    @staticmethod
    def delete_custom_oauth_client_params(tenant_id: str, provider: str):
        """
        delete custom oauth client params
        """
        tool_provider = ToolProviderID(provider)
        with Session(db.engine) as session:
            session.query(ToolOAuthTenantClient).filter_by(
                tenant_id=tenant_id,
                provider=tool_provider.provider_name,
                plugin_id=tool_provider.plugin_id,
            ).delete()
            session.commit()
        return {"result": "success"}

    @staticmethod
    def get_builtin_tool_provider_oauth_client_schema(tenant_id: str, provider_name: str):
        """
        get builtin tool provider oauth client schema
        """
        provider = ToolManager.get_builtin_provider(provider_name, tenant_id)
        verified = not isinstance(provider, PluginToolProviderController) or PluginService.is_plugin_verified(
            tenant_id, provider.plugin_unique_identifier
        )

        is_oauth_custom_client_enabled = BuiltinToolManageService.is_oauth_custom_client_enabled(
            tenant_id, provider_name
        )
        is_system_oauth_params_exists = verified and BuiltinToolManageService.is_oauth_system_client_exists(
            provider_name
        )
        result = {
            "schema": provider.get_oauth_client_schema(),
            "is_oauth_custom_client_enabled": is_oauth_custom_client_enabled,
            "is_system_oauth_params_exists": is_system_oauth_params_exists,
            "client_params": BuiltinToolManageService.get_custom_oauth_client_params(tenant_id, provider_name),
            "redirect_uri": f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{provider_name}/tool/callback",
        }
        return result

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

        result: list[ToolApiEntity] = []
        for tool in tools or []:
            result.append(
                ToolTransformService.convert_tool_entity_to_api_entity(
                    tool=tool,
                    tenant_id=tenant_id,
                    labels=ToolLabelManager.get_tool_labels(provider_controller),
                )
            )

        return result

    @staticmethod
    def get_builtin_tool_provider_info(tenant_id: str, provider: str):
        """
        get builtin tool provider info
        """
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        # check if user has added the provider
        builtin_provider = BuiltinToolManageService.get_builtin_provider(provider, tenant_id)
        if builtin_provider is None:
            raise ValueError(f"you have not added provider {provider}")

        entity = ToolTransformService.builtin_provider_to_user_provider(
            provider_controller=provider_controller,
            db_provider=builtin_provider,
            decrypt_credentials=True,
        )

        entity.original_credentials = {}
        return entity

    @staticmethod
    def list_builtin_provider_credentials_schema(provider_name: str, credential_type: CredentialType, tenant_id: str):
        """
        list builtin provider credentials schema

        :param credential_type: credential type
        :param provider_name: the name of the provider
        :param tenant_id: the id of the tenant
        :return: the list of tool providers
        """
        provider = ToolManager.get_builtin_provider(provider_name, tenant_id)
        return provider.get_credentials_schema_by_type(credential_type)

    @staticmethod
    def update_builtin_tool_provider(
        user_id: str,
        tenant_id: str,
        provider: str,
        credential_id: str,
        credentials: dict | None = None,
        name: str | None = None,
    ):
        """
        update builtin tool provider
        """
        with Session(db.engine) as session:
            # get if the provider exists
            db_provider = (
                session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.id == credential_id,
                )
                .first()
            )
            if db_provider is None:
                raise ValueError(f"you have not added provider {provider}")

            try:
                if CredentialType.of(db_provider.credential_type).is_editable() and credentials:
                    provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
                    if not provider_controller.need_credentials:
                        raise ValueError(f"provider {provider} does not need credentials")

                    encrypter, cache = BuiltinToolManageService.create_tool_encrypter(
                        tenant_id, db_provider, provider, provider_controller
                    )

                    original_credentials = encrypter.decrypt(db_provider.credentials)
                    new_credentials: dict = {
                        key: value if value != HIDDEN_VALUE else original_credentials.get(key, UNKNOWN_VALUE)
                        for key, value in credentials.items()
                    }

                    if CredentialType.of(db_provider.credential_type).is_validate_allowed():
                        provider_controller.validate_credentials(user_id, new_credentials)

                    # encrypt credentials
                    db_provider.encrypted_credentials = json.dumps(encrypter.encrypt(new_credentials))

                    cache.delete()

                # update name if provided
                if name and name != db_provider.name:
                    # check if the name is already used
                    if session.scalar(
                        select(
                            exists().where(
                                BuiltinToolProvider.tenant_id == tenant_id,
                                BuiltinToolProvider.provider == provider,
                                BuiltinToolProvider.name == name,
                            )
                        )
                    ):
                        raise ValueError(f"the credential name '{name}' is already used")

                    db_provider.name = name

                session.commit()
            except Exception as e:
                session.rollback()
                raise ValueError(str(e))
        return {"result": "success"}

    @staticmethod
    def add_builtin_tool_provider(
        user_id: str,
        api_type: CredentialType,
        tenant_id: str,
        provider: str,
        credentials: dict,
        expires_at: int = -1,
        name: str | None = None,
    ):
        """
        add builtin tool provider
        """
        with Session(db.engine) as session:
            try:
                lock = f"builtin_tool_provider_create_lock:{tenant_id}_{provider}"
                with redis_client.lock(lock, timeout=20):
                    provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
                    if not provider_controller.need_credentials:
                        raise ValueError(f"provider {provider} does not need credentials")

                    provider_count = (
                        session.query(BuiltinToolProvider).filter_by(tenant_id=tenant_id, provider=provider).count()
                    )

                    # check if the provider count is reached the limit
                    if provider_count >= BuiltinToolManageService.__MAX_BUILTIN_TOOL_PROVIDER_COUNT__:
                        raise ValueError(f"you have reached the maximum number of providers for {provider}")

                    # validate credentials if allowed
                    if CredentialType.of(api_type).is_validate_allowed():
                        provider_controller.validate_credentials(user_id, credentials)

                    # generate name if not provided
                    if name is None or name == "":
                        name = BuiltinToolManageService.generate_builtin_tool_provider_name(
                            session=session, tenant_id=tenant_id, provider=provider, credential_type=api_type
                        )
                    else:
                        # check if the name is already used
                        if session.scalar(
                            select(
                                exists().where(
                                    BuiltinToolProvider.tenant_id == tenant_id,
                                    BuiltinToolProvider.provider == provider,
                                    BuiltinToolProvider.name == name,
                                )
                            )
                        ):
                            raise ValueError(f"the credential name '{name}' is already used")

                    # create encrypter
                    encrypter, _ = create_provider_encrypter(
                        tenant_id=tenant_id,
                        config=[
                            x.to_basic_provider_config()
                            for x in provider_controller.get_credentials_schema_by_type(api_type)
                        ],
                        cache=NoOpProviderCredentialCache(),
                    )

                    db_provider = BuiltinToolProvider(
                        tenant_id=tenant_id,
                        user_id=user_id,
                        provider=provider,
                        encrypted_credentials=json.dumps(encrypter.encrypt(credentials)),
                        credential_type=api_type.value,
                        name=name,
                        expires_at=expires_at
                        if expires_at is not None
                        else BuiltinToolManageService.__DEFAULT_EXPIRES_AT__,
                    )

                    session.add(db_provider)
                    session.commit()
            except Exception as e:
                session.rollback()
                raise ValueError(str(e))
        return {"result": "success"}

    @staticmethod
    def create_tool_encrypter(
        tenant_id: str,
        db_provider: BuiltinToolProvider,
        provider: str,
        provider_controller: BuiltinToolProviderController,
    ):
        encrypter, cache = create_provider_encrypter(
            tenant_id=tenant_id,
            config=[
                x.to_basic_provider_config()
                for x in provider_controller.get_credentials_schema_by_type(db_provider.credential_type)
            ],
            cache=ToolProviderCredentialsCache(tenant_id=tenant_id, provider=provider, credential_id=db_provider.id),
        )
        return encrypter, cache

    @staticmethod
    def generate_builtin_tool_provider_name(
        session: Session, tenant_id: str, provider: str, credential_type: CredentialType
    ) -> str:
        db_providers = (
            session.query(BuiltinToolProvider)
            .filter_by(
                tenant_id=tenant_id,
                provider=provider,
                credential_type=credential_type.value,
            )
            .order_by(BuiltinToolProvider.created_at.desc())
            .all()
        )
        return generate_incremental_name(
            [provider.name for provider in db_providers],
            f"{credential_type.get_name()}",
        )

    @staticmethod
    def get_builtin_tool_provider_credentials(
        tenant_id: str, provider_name: str
    ) -> list[ToolProviderCredentialApiEntity]:
        """
        get builtin tool provider credentials
        """
        with db.session.no_autoflush:
            providers = (
                db.session.query(BuiltinToolProvider)
                .filter_by(tenant_id=tenant_id, provider=provider_name)
                .order_by(BuiltinToolProvider.is_default.desc(), BuiltinToolProvider.created_at.asc())
                .all()
            )

            if len(providers) == 0:
                return []

            default_provider = providers[0]
            default_provider.is_default = True
            provider_controller = ToolManager.get_builtin_provider(default_provider.provider, tenant_id)

            credentials: list[ToolProviderCredentialApiEntity] = []
            for provider in providers:
                encrypter, _ = BuiltinToolManageService.create_tool_encrypter(
                    tenant_id, provider, provider.provider, provider_controller
                )
                decrypt_credential = encrypter.mask_tool_credentials(encrypter.decrypt(provider.credentials))
                credential_entity = ToolTransformService.convert_builtin_provider_to_credential_entity(
                    provider=provider,
                    credentials=decrypt_credential,
                )
                credentials.append(credential_entity)
            return credentials

    @staticmethod
    def get_builtin_tool_provider_credential_info(tenant_id: str, provider: str) -> ToolProviderCredentialInfoApiEntity:
        """
        get builtin tool provider credential info
        """
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        supported_credential_types = provider_controller.get_supported_credential_types()
        credentials = BuiltinToolManageService.get_builtin_tool_provider_credentials(tenant_id, provider)
        credential_info = ToolProviderCredentialInfoApiEntity(
            supported_credential_types=supported_credential_types,
            is_oauth_custom_client_enabled=BuiltinToolManageService.is_oauth_custom_client_enabled(tenant_id, provider),
            credentials=credentials,
        )

        return credential_info

    @staticmethod
    def delete_builtin_tool_provider(tenant_id: str, provider: str, credential_id: str):
        """
        delete tool provider
        """
        with Session(db.engine) as session:
            db_provider = (
                session.query(BuiltinToolProvider)
                .where(
                    BuiltinToolProvider.tenant_id == tenant_id,
                    BuiltinToolProvider.id == credential_id,
                )
                .first()
            )

            if db_provider is None:
                raise ValueError(f"you have not added provider {provider}")

            session.delete(db_provider)
            session.commit()

            # delete cache
            provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
            _, cache = BuiltinToolManageService.create_tool_encrypter(
                tenant_id, db_provider, provider, provider_controller
            )
            cache.delete()

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
                tenant_id=tenant_id, user_id=user_id, provider=provider, is_default=True
            ).update({"is_default": False})

            # set new default provider
            target_provider.is_default = True
            session.commit()
        return {"result": "success"}

    @staticmethod
    def is_oauth_system_client_exists(provider_name: str) -> bool:
        """
        check if oauth system client exists
        """
        tool_provider = ToolProviderID(provider_name)
        with Session(db.engine, autoflush=False) as session:
            system_client: ToolOAuthSystemClient | None = (
                session.query(ToolOAuthSystemClient)
                .filter_by(plugin_id=tool_provider.plugin_id, provider=tool_provider.provider_name)
                .first()
            )
            return system_client is not None

    @staticmethod
    def is_oauth_custom_client_enabled(tenant_id: str, provider: str) -> bool:
        """
        check if oauth custom client is enabled
        """
        tool_provider = ToolProviderID(provider)
        with Session(db.engine, autoflush=False) as session:
            user_client: ToolOAuthTenantClient | None = (
                session.query(ToolOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=tool_provider.provider_name,
                    plugin_id=tool_provider.plugin_id,
                    enabled=True,
                )
                .first()
            )
            return user_client is not None and user_client.enabled

    @staticmethod
    def get_oauth_client(tenant_id: str, provider: str) -> Mapping[str, Any] | None:
        """
        get builtin tool provider
        """
        tool_provider = ToolProviderID(provider)
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        encrypter, _ = create_provider_encrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
            cache=NoOpProviderCredentialCache(),
        )
        with Session(db.engine, autoflush=False) as session:
            user_client: ToolOAuthTenantClient | None = (
                session.query(ToolOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=tool_provider.provider_name,
                    plugin_id=tool_provider.plugin_id,
                    enabled=True,
                )
                .first()
            )
            oauth_params: Mapping[str, Any] | None = None
            if user_client:
                oauth_params = encrypter.decrypt(user_client.oauth_params)
                return oauth_params

            # only verified provider can use official oauth client
            is_verified = not isinstance(
                provider_controller, PluginToolProviderController
            ) or PluginService.is_plugin_verified(tenant_id, provider_controller.plugin_unique_identifier)
            if not is_verified:
                return oauth_params

            system_client: ToolOAuthSystemClient | None = (
                session.query(ToolOAuthSystemClient)
                .filter_by(plugin_id=tool_provider.plugin_id, provider=tool_provider.provider_name)
                .first()
            )
            if system_client:
                try:
                    oauth_params = decrypt_system_oauth_params(system_client.encrypted_oauth_params)
                except Exception as e:
                    raise ValueError(f"Error decrypting system oauth params: {e}")

            return oauth_params

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

        # get all user added providers
        db_providers: list[BuiltinToolProvider] = ToolManager.list_default_builtin_providers(tenant_id)

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
                    include_set=dify_config.POSITION_TOOL_INCLUDES_SET,
                    exclude_set=dify_config.POSITION_TOOL_EXCLUDES_SET,
                    data=provider_controller,
                    name_func=lambda x: x.entity.identity.name,
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
                            labels=ToolLabelManager.get_tool_labels(provider_controller),
                        )
                    )

                result.append(user_builtin_provider)
            except Exception as e:
                raise e

        return BuiltinToolProviderSort.sort(result)

    @staticmethod
    def get_builtin_provider(provider_name: str, tenant_id: str) -> BuiltinToolProvider | None:
        """
        This method is used to fetch the builtin provider from the database
        1.if the default provider exists, return the default provider
        2.if the default provider does not exist, return the oldest provider
        """
        with Session(db.engine, autoflush=False) as session:
            try:
                full_provider_name = provider_name
                provider_id_entity = ToolProviderID(provider_name)
                provider_name = provider_id_entity.provider_name

                if provider_id_entity.organization != "langgenius":
                    provider = (
                        session.query(BuiltinToolProvider)
                        .where(
                            BuiltinToolProvider.tenant_id == tenant_id,
                            BuiltinToolProvider.provider == full_provider_name,
                        )
                        .order_by(
                            BuiltinToolProvider.is_default.desc(),  # default=True first
                            BuiltinToolProvider.created_at.asc(),  # oldest first
                        )
                        .first()
                    )
                else:
                    provider = (
                        session.query(BuiltinToolProvider)
                        .where(
                            BuiltinToolProvider.tenant_id == tenant_id,
                            (BuiltinToolProvider.provider == provider_name)
                            | (BuiltinToolProvider.provider == full_provider_name),
                        )
                        .order_by(
                            BuiltinToolProvider.is_default.desc(),  # default=True first
                            BuiltinToolProvider.created_at.asc(),  # oldest first
                        )
                        .first()
                    )

                if provider is None:
                    return None

                provider.provider = ToolProviderID(provider.provider).to_string()
                return provider
            except Exception:
                # it's an old provider without organization
                return (
                    session.query(BuiltinToolProvider)
                    .where(BuiltinToolProvider.tenant_id == tenant_id, BuiltinToolProvider.provider == provider_name)
                    .order_by(
                        BuiltinToolProvider.is_default.desc(),  # default=True first
                        BuiltinToolProvider.created_at.asc(),  # oldest first
                    )
                    .first()
                )

    @staticmethod
    def save_custom_oauth_client_params(
        tenant_id: str,
        provider: str,
        client_params: dict | None = None,
        enable_oauth_custom_client: bool | None = None,
    ):
        """
        setup oauth custom client
        """
        if client_params is None and enable_oauth_custom_client is None:
            return {"result": "success"}

        tool_provider = ToolProviderID(provider)
        provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
        if not provider_controller:
            raise ToolProviderNotFoundError(f"Provider {provider} not found")

        if not isinstance(provider_controller, (BuiltinToolProviderController, PluginToolProviderController)):
            raise ValueError(f"Provider {provider} is not a builtin or plugin provider")

        with Session(db.engine) as session:
            custom_client_params = (
                session.query(ToolOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    plugin_id=tool_provider.plugin_id,
                    provider=tool_provider.provider_name,
                )
                .first()
            )

            # if the record does not exist, create a basic record
            if custom_client_params is None:
                custom_client_params = ToolOAuthTenantClient(
                    tenant_id=tenant_id,
                    plugin_id=tool_provider.plugin_id,
                    provider=tool_provider.provider_name,
                )
                session.add(custom_client_params)

            if client_params is not None:
                encrypter, _ = create_provider_encrypter(
                    tenant_id=tenant_id,
                    config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                    cache=NoOpProviderCredentialCache(),
                )
                original_params = encrypter.decrypt(custom_client_params.oauth_params)
                new_params = {
                    key: value if value != HIDDEN_VALUE else original_params.get(key, UNKNOWN_VALUE)
                    for key, value in client_params.items()
                }
                custom_client_params.encrypted_oauth_params = json.dumps(encrypter.encrypt(new_params))

            if enable_oauth_custom_client is not None:
                custom_client_params.enabled = enable_oauth_custom_client

            session.commit()
        return {"result": "success"}

    @staticmethod
    def get_custom_oauth_client_params(tenant_id: str, provider: str):
        """
        get custom oauth client params
        """
        with Session(db.engine) as session:
            tool_provider = ToolProviderID(provider)
            custom_oauth_client_params: ToolOAuthTenantClient | None = (
                session.query(ToolOAuthTenantClient)
                .filter_by(
                    tenant_id=tenant_id,
                    plugin_id=tool_provider.plugin_id,
                    provider=tool_provider.provider_name,
                )
                .first()
            )
            if custom_oauth_client_params is None:
                return {}

            provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
            if not provider_controller:
                raise ToolProviderNotFoundError(f"Provider {provider} not found")

            if not isinstance(provider_controller, BuiltinToolProviderController):
                raise ValueError(f"Provider {provider} is not a builtin or plugin provider")

            encrypter, _ = create_provider_encrypter(
                tenant_id=tenant_id,
                config=[x.to_basic_provider_config() for x in provider_controller.get_oauth_client_schema()],
                cache=NoOpProviderCredentialCache(),
            )

            return encrypter.mask_tool_credentials(encrypter.decrypt(custom_oauth_client_params.oauth_params))
