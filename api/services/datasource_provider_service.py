import logging
import time
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from configs import dify_config
from constants import HIDDEN_VALUE, UNKNOWN_VALUE
from core.helper import encrypter
from core.helper.name_generator import generate_incremental_name
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.model_runtime.entities.provider_entities import FormType
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.oauth import OAuthHandler
from core.tools.entities.tool_entities import CredentialType
from core.tools.utils.encryption import ProviderConfigCache, ProviderConfigEncrypter, create_provider_encrypter
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig, DatasourceProvider
from models.provider_ids import DatasourceProviderID
from services.plugin.plugin_service import PluginService

logger = logging.getLogger(__name__)


def get_current_user():
    from libs.login import current_user
    from models.account import Account
    from models.model import EndUser

    if not isinstance(current_user._get_current_object(), (Account, EndUser)):  # type: ignore
        raise TypeError(f"current_user must be Account or EndUser, got {type(current_user).__name__}")
    return current_user


class DatasourceProviderService:
    """
    Model Provider Service
    """

    def __init__(self) -> None:
        self.provider_manager = PluginDatasourceManager()

    def remove_oauth_custom_client_params(self, tenant_id: str, datasource_provider_id: DatasourceProviderID):
        """
        remove oauth custom client params
        """
        with Session(db.engine) as session:
            session.query(DatasourceOauthTenantParamConfig).filter_by(
                tenant_id=tenant_id,
                provider=datasource_provider_id.provider_name,
                plugin_id=datasource_provider_id.plugin_id,
            ).delete()
            session.commit()

    def decrypt_datasource_provider_credentials(
        self,
        tenant_id: str,
        datasource_provider: DatasourceProvider,
        plugin_id: str,
        provider: str,
    ) -> dict[str, Any]:
        encrypted_credentials = datasource_provider.encrypted_credentials
        credential_secret_variables = self.extract_secret_variables(
            tenant_id=tenant_id,
            provider_id=f"{plugin_id}/{provider}",
            credential_type=CredentialType.of(datasource_provider.auth_type),
        )
        decrypted_credentials = encrypted_credentials.copy()
        for key, value in decrypted_credentials.items():
            if key in credential_secret_variables:
                decrypted_credentials[key] = encrypter.decrypt_token(tenant_id, value)
        return decrypted_credentials

    def encrypt_datasource_provider_credentials(
        self,
        tenant_id: str,
        provider: str,
        plugin_id: str,
        raw_credentials: Mapping[str, Any],
        datasource_provider: DatasourceProvider,
    ) -> dict[str, Any]:
        provider_credential_secret_variables = self.extract_secret_variables(
            tenant_id=tenant_id,
            provider_id=f"{plugin_id}/{provider}",
            credential_type=CredentialType.of(datasource_provider.auth_type),
        )
        encrypted_credentials = dict(raw_credentials)
        for key, value in encrypted_credentials.items():
            if key in provider_credential_secret_variables:
                encrypted_credentials[key] = encrypter.encrypt_token(tenant_id, value)
        return encrypted_credentials

    def get_datasource_credentials(
        self,
        tenant_id: str,
        provider: str,
        plugin_id: str,
        credential_id: str | None = None,
    ) -> dict[str, Any]:
        """
        get credential by id
        """
        with Session(db.engine) as session:
            if credential_id:
                datasource_provider = (
                    session.query(DatasourceProvider).filter_by(tenant_id=tenant_id, id=credential_id).first()
                )
            else:
                datasource_provider = (
                    session.query(DatasourceProvider)
                    .filter_by(tenant_id=tenant_id, provider=provider, plugin_id=plugin_id)
                    .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
                    .first()
                )
            if not datasource_provider:
                return {}
            # refresh the credentials
            if datasource_provider.expires_at != -1 and (datasource_provider.expires_at - 60) < int(time.time()):
                current_user = get_current_user()
                decrypted_credentials = self.decrypt_datasource_provider_credentials(
                    tenant_id=tenant_id,
                    datasource_provider=datasource_provider,
                    plugin_id=plugin_id,
                    provider=provider,
                )
                datasource_provider_id = DatasourceProviderID(f"{plugin_id}/{provider}")
                provider_name = datasource_provider_id.provider_name
                redirect_uri = (
                    f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/"
                    f"{datasource_provider_id}/datasource/callback"
                )
                system_credentials = self.get_oauth_client(tenant_id, datasource_provider_id)
                refreshed_credentials = OAuthHandler().refresh_credentials(
                    tenant_id=tenant_id,
                    user_id=current_user.id,
                    plugin_id=datasource_provider_id.plugin_id,
                    provider=provider_name,
                    redirect_uri=redirect_uri,
                    system_credentials=system_credentials or {},
                    credentials=decrypted_credentials,
                )
                datasource_provider.encrypted_credentials = self.encrypt_datasource_provider_credentials(
                    tenant_id=tenant_id,
                    raw_credentials=refreshed_credentials.credentials,
                    provider=provider,
                    plugin_id=plugin_id,
                    datasource_provider=datasource_provider,
                )
                datasource_provider.expires_at = refreshed_credentials.expires_at
                session.commit()

            return self.decrypt_datasource_provider_credentials(
                tenant_id=tenant_id,
                datasource_provider=datasource_provider,
                plugin_id=plugin_id,
                provider=provider,
            )

    def get_all_datasource_credentials_by_provider(
        self,
        tenant_id: str,
        provider: str,
        plugin_id: str,
    ) -> list[dict[str, Any]]:
        """
        get all datasource credentials by provider
        """
        with Session(db.engine) as session:
            datasource_providers = (
                session.query(DatasourceProvider)
                .filter_by(tenant_id=tenant_id, provider=provider, plugin_id=plugin_id)
                .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
                .all()
            )
            if not datasource_providers:
                return []
            current_user = get_current_user()
            # refresh the credentials
            real_credentials_list = []
            for datasource_provider in datasource_providers:
                decrypted_credentials = self.decrypt_datasource_provider_credentials(
                    tenant_id=tenant_id,
                    datasource_provider=datasource_provider,
                    plugin_id=plugin_id,
                    provider=provider,
                )
                datasource_provider_id = DatasourceProviderID(f"{plugin_id}/{provider}")
                provider_name = datasource_provider_id.provider_name
                redirect_uri = (
                    f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/"
                    f"{datasource_provider_id}/datasource/callback"
                )
                system_credentials = self.get_oauth_client(tenant_id, datasource_provider_id)
                refreshed_credentials = OAuthHandler().refresh_credentials(
                    tenant_id=tenant_id,
                    user_id=current_user.id,
                    plugin_id=datasource_provider_id.plugin_id,
                    provider=provider_name,
                    redirect_uri=redirect_uri,
                    system_credentials=system_credentials or {},
                    credentials=decrypted_credentials,
                )
                datasource_provider.encrypted_credentials = self.encrypt_datasource_provider_credentials(
                    tenant_id=tenant_id,
                    raw_credentials=refreshed_credentials.credentials,
                    provider=provider,
                    plugin_id=plugin_id,
                    datasource_provider=datasource_provider,
                )
                datasource_provider.expires_at = refreshed_credentials.expires_at
                real_credentials = self.decrypt_datasource_provider_credentials(
                    tenant_id=tenant_id,
                    datasource_provider=datasource_provider,
                    plugin_id=plugin_id,
                    provider=provider,
                )
                real_credentials_list.append(real_credentials)
            session.commit()

            return real_credentials_list

    def update_datasource_provider_name(
        self, tenant_id: str, datasource_provider_id: DatasourceProviderID, name: str, credential_id: str
    ):
        """
        update datasource provider name
        """
        with Session(db.engine) as session:
            target_provider = (
                session.query(DatasourceProvider)
                .filter_by(
                    tenant_id=tenant_id,
                    id=credential_id,
                    provider=datasource_provider_id.provider_name,
                    plugin_id=datasource_provider_id.plugin_id,
                )
                .first()
            )
            if target_provider is None:
                raise ValueError("provider not found")

            if target_provider.name == name:
                return

            # check name is exist
            if (
                session.query(DatasourceProvider)
                .filter_by(
                    tenant_id=tenant_id,
                    name=name,
                    provider=datasource_provider_id.provider_name,
                    plugin_id=datasource_provider_id.plugin_id,
                )
                .count()
                > 0
            ):
                raise ValueError("Authorization name is already exists")

            target_provider.name = name
            session.commit()
        return

    def set_default_datasource_provider(
        self, tenant_id: str, datasource_provider_id: DatasourceProviderID, credential_id: str
    ):
        """
        set default datasource provider
        """
        with Session(db.engine) as session:
            # get provider
            target_provider = (
                session.query(DatasourceProvider)
                .filter_by(
                    tenant_id=tenant_id,
                    id=credential_id,
                    provider=datasource_provider_id.provider_name,
                    plugin_id=datasource_provider_id.plugin_id,
                )
                .first()
            )
            if target_provider is None:
                raise ValueError("provider not found")

            # clear default provider
            session.query(DatasourceProvider).filter_by(
                tenant_id=tenant_id,
                provider=target_provider.provider,
                plugin_id=target_provider.plugin_id,
                is_default=True,
            ).update({"is_default": False})

            # set new default provider
            target_provider.is_default = True
            session.commit()
        return {"result": "success"}

    def setup_oauth_custom_client_params(
        self,
        tenant_id: str,
        datasource_provider_id: DatasourceProviderID,
        client_params: dict | None,
        enabled: bool | None,
    ):
        """
        setup oauth custom client params
        """
        if client_params is None and enabled is None:
            return
        with Session(db.engine) as session:
            tenant_oauth_client_params = (
                session.query(DatasourceOauthTenantParamConfig)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=datasource_provider_id.provider_name,
                    plugin_id=datasource_provider_id.plugin_id,
                )
                .first()
            )

            if not tenant_oauth_client_params:
                tenant_oauth_client_params = DatasourceOauthTenantParamConfig(
                    tenant_id=tenant_id,
                    provider=datasource_provider_id.provider_name,
                    plugin_id=datasource_provider_id.plugin_id,
                    client_params={},
                    enabled=False,
                )
                session.add(tenant_oauth_client_params)

            if client_params is not None:
                encrypter, _ = self.get_oauth_encrypter(tenant_id, datasource_provider_id)
                original_params = (
                    encrypter.decrypt(tenant_oauth_client_params.client_params) if tenant_oauth_client_params else {}
                )
                new_params: dict = {
                    key: value if value != HIDDEN_VALUE else original_params.get(key, UNKNOWN_VALUE)
                    for key, value in client_params.items()
                }
                tenant_oauth_client_params.client_params = encrypter.encrypt(new_params)

            if enabled is not None:
                tenant_oauth_client_params.enabled = enabled
            session.commit()

    def is_system_oauth_params_exist(self, datasource_provider_id: DatasourceProviderID) -> bool:
        """
        check if system oauth params exist
        """
        with Session(db.engine).no_autoflush as session:
            return (
                session.query(DatasourceOauthParamConfig)
                .filter_by(provider=datasource_provider_id.provider_name, plugin_id=datasource_provider_id.plugin_id)
                .first()
                is not None
            )

    def is_tenant_oauth_params_enabled(self, tenant_id: str, datasource_provider_id: DatasourceProviderID) -> bool:
        """
        check if tenant oauth params is enabled
        """
        return (
            db.session.query(DatasourceOauthTenantParamConfig)
            .filter_by(
                tenant_id=tenant_id,
                provider=datasource_provider_id.provider_name,
                plugin_id=datasource_provider_id.plugin_id,
                enabled=True,
            )
            .count()
            > 0
        )

    def get_tenant_oauth_client(
        self, tenant_id: str, datasource_provider_id: DatasourceProviderID, mask: bool = False
    ) -> dict[str, Any] | None:
        """
        get tenant oauth client
        """
        tenant_oauth_client_params = (
            db.session.query(DatasourceOauthTenantParamConfig)
            .filter_by(
                tenant_id=tenant_id,
                provider=datasource_provider_id.provider_name,
                plugin_id=datasource_provider_id.plugin_id,
            )
            .first()
        )
        if tenant_oauth_client_params:
            encrypter, _ = self.get_oauth_encrypter(tenant_id, datasource_provider_id)
            if mask:
                return encrypter.mask_tool_credentials(encrypter.decrypt(tenant_oauth_client_params.client_params))
            else:
                return encrypter.decrypt(tenant_oauth_client_params.client_params)
        return None

    def get_oauth_encrypter(
        self, tenant_id: str, datasource_provider_id: DatasourceProviderID
    ) -> tuple[ProviderConfigEncrypter, ProviderConfigCache]:
        """
        get oauth encrypter
        """
        datasource_provider = self.provider_manager.fetch_datasource_provider(
            tenant_id=tenant_id, provider_id=str(datasource_provider_id)
        )
        if not datasource_provider.declaration.oauth_schema:
            raise ValueError("Datasource provider oauth schema not found")

        client_schema = datasource_provider.declaration.oauth_schema.client_schema
        return create_provider_encrypter(
            tenant_id=tenant_id,
            config=[x.to_basic_provider_config() for x in client_schema],
            cache=NoOpProviderCredentialCache(),
        )

    def get_oauth_client(self, tenant_id: str, datasource_provider_id: DatasourceProviderID) -> dict[str, Any] | None:
        """
        get oauth client
        """
        provider = datasource_provider_id.provider_name
        plugin_id = datasource_provider_id.plugin_id
        with Session(db.engine).no_autoflush as session:
            # get tenant oauth client params
            tenant_oauth_client_params = (
                session.query(DatasourceOauthTenantParamConfig)
                .filter_by(
                    tenant_id=tenant_id,
                    provider=provider,
                    plugin_id=plugin_id,
                    enabled=True,
                )
                .first()
            )
            if tenant_oauth_client_params:
                encrypter, _ = self.get_oauth_encrypter(tenant_id, datasource_provider_id)
                return encrypter.decrypt(tenant_oauth_client_params.client_params)

            provider_controller = self.provider_manager.fetch_datasource_provider(
                tenant_id=tenant_id, provider_id=str(datasource_provider_id)
            )
            is_verified = PluginService.is_plugin_verified(tenant_id, provider_controller.plugin_unique_identifier)
            if is_verified:
                # fallback to system oauth client params
                oauth_client_params = (
                    session.query(DatasourceOauthParamConfig).filter_by(provider=provider, plugin_id=plugin_id).first()
                )
                if oauth_client_params:
                    return oauth_client_params.system_credentials

            raise ValueError(f"Please configure oauth client params(system/tenant) for {plugin_id}/{provider}")

    @staticmethod
    def generate_next_datasource_provider_name(
        session: Session, tenant_id: str, provider_id: DatasourceProviderID, credential_type: CredentialType
    ) -> str:
        db_providers = (
            session.query(DatasourceProvider)
            .filter_by(
                tenant_id=tenant_id,
                provider=provider_id.provider_name,
                plugin_id=provider_id.plugin_id,
            )
            .all()
        )
        return generate_incremental_name(
            [provider.name for provider in db_providers],
            f"{credential_type.get_name()}",
        )

    def reauthorize_datasource_oauth_provider(
        self,
        name: str | None,
        tenant_id: str,
        provider_id: DatasourceProviderID,
        avatar_url: str | None,
        expire_at: int,
        credentials: dict,
        credential_id: str,
    ) -> None:
        """
        update datasource oauth provider
        """
        with Session(db.engine) as session:
            lock = f"datasource_provider_create_lock:{tenant_id}_{provider_id}_{CredentialType.OAUTH2.value}"
            with redis_client.lock(lock, timeout=20):
                target_provider = (
                    session.query(DatasourceProvider).filter_by(id=credential_id, tenant_id=tenant_id).first()
                )
                if target_provider is None:
                    raise ValueError("provider not found")

                db_provider_name = name
                if not db_provider_name:
                    db_provider_name = target_provider.name
                else:
                    name_conflict = (
                        session.query(DatasourceProvider)
                        .filter_by(
                            tenant_id=tenant_id,
                            name=db_provider_name,
                            provider=provider_id.provider_name,
                            plugin_id=provider_id.plugin_id,
                            auth_type=CredentialType.OAUTH2.value,
                        )
                        .count()
                    )
                    if name_conflict > 0:
                        db_provider_name = generate_incremental_name(
                            [
                                provider.name
                                for provider in session.query(DatasourceProvider).filter_by(
                                    tenant_id=tenant_id,
                                    provider=provider_id.provider_name,
                                    plugin_id=provider_id.plugin_id,
                                )
                            ],
                            db_provider_name,
                        )

                provider_credential_secret_variables = self.extract_secret_variables(
                    tenant_id=tenant_id, provider_id=f"{provider_id}", credential_type=CredentialType.OAUTH2
                )
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        credentials[key] = encrypter.encrypt_token(tenant_id, value)

                target_provider.expires_at = expire_at
                target_provider.encrypted_credentials = credentials
                target_provider.avatar_url = avatar_url or target_provider.avatar_url
                session.commit()

    def add_datasource_oauth_provider(
        self,
        name: str | None,
        tenant_id: str,
        provider_id: DatasourceProviderID,
        avatar_url: str | None,
        expire_at: int,
        credentials: dict,
    ) -> None:
        """
        add datasource oauth provider
        """
        credential_type = CredentialType.OAUTH2
        with Session(db.engine) as session:
            lock = f"datasource_provider_create_lock:{tenant_id}_{provider_id}_{credential_type.value}"
            with redis_client.lock(lock, timeout=60):
                db_provider_name = name
                if not db_provider_name:
                    db_provider_name = self.generate_next_datasource_provider_name(
                        session=session,
                        tenant_id=tenant_id,
                        provider_id=provider_id,
                        credential_type=credential_type,
                    )
                else:
                    if (
                        session.query(DatasourceProvider)
                        .filter_by(
                            tenant_id=tenant_id,
                            name=db_provider_name,
                            provider=provider_id.provider_name,
                            plugin_id=provider_id.plugin_id,
                            auth_type=credential_type.value,
                        )
                        .count()
                        > 0
                    ):
                        db_provider_name = generate_incremental_name(
                            [
                                provider.name
                                for provider in session.query(DatasourceProvider).filter_by(
                                    tenant_id=tenant_id,
                                    provider=provider_id.provider_name,
                                    plugin_id=provider_id.plugin_id,
                                )
                            ],
                            db_provider_name,
                        )

                provider_credential_secret_variables = self.extract_secret_variables(
                    tenant_id=tenant_id, provider_id=f"{provider_id}", credential_type=credential_type
                )
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        credentials[key] = encrypter.encrypt_token(tenant_id, value)

                datasource_provider = DatasourceProvider(
                    tenant_id=tenant_id,
                    name=db_provider_name,
                    provider=provider_id.provider_name,
                    plugin_id=provider_id.plugin_id,
                    auth_type=credential_type.value,
                    encrypted_credentials=credentials,
                    avatar_url=avatar_url or "default",
                    expires_at=expire_at,
                )
                session.add(datasource_provider)
                session.commit()

    def add_datasource_api_key_provider(
        self,
        name: str | None,
        tenant_id: str,
        provider_id: DatasourceProviderID,
        credentials: dict,
    ) -> None:
        """
        validate datasource provider credentials.

        :param tenant_id:
        :param provider:
        :param credentials:
        """
        provider_name = provider_id.provider_name
        plugin_id = provider_id.plugin_id

        with Session(db.engine) as session:
            lock = f"datasource_provider_create_lock:{tenant_id}_{provider_id}_{CredentialType.API_KEY}"
            with redis_client.lock(lock, timeout=20):
                db_provider_name = name or self.generate_next_datasource_provider_name(
                    session=session,
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    credential_type=CredentialType.API_KEY,
                )

                # check name is exist
                if (
                    session.query(DatasourceProvider)
                    .filter_by(tenant_id=tenant_id, plugin_id=plugin_id, provider=provider_name, name=db_provider_name)
                    .count()
                    > 0
                ):
                    raise ValueError("Authorization name is already exists")

                try:
                    current_user = get_current_user()
                    self.provider_manager.validate_provider_credentials(
                        tenant_id=tenant_id,
                        user_id=current_user.id,
                        provider=provider_name,
                        plugin_id=plugin_id,
                        credentials=credentials,
                    )
                except Exception as e:
                    raise ValueError(f"Failed to validate credentials: {str(e)}")

                provider_credential_secret_variables = self.extract_secret_variables(
                    tenant_id=tenant_id, provider_id=f"{provider_id}", credential_type=CredentialType.API_KEY
                )
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        # if send [__HIDDEN__] in secret input, it will be same as original value
                        credentials[key] = encrypter.encrypt_token(tenant_id, value)
                datasource_provider = DatasourceProvider(
                    tenant_id=tenant_id,
                    name=db_provider_name,
                    provider=provider_name,
                    plugin_id=plugin_id,
                    auth_type=CredentialType.API_KEY,
                    encrypted_credentials=credentials,
                )
                session.add(datasource_provider)
                session.commit()

    def extract_secret_variables(self, tenant_id: str, provider_id: str, credential_type: CredentialType) -> list[str]:
        """
        Extract secret input form variables.

        :param credential_form_schemas:
        :return:
        """
        datasource_provider = self.provider_manager.fetch_datasource_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        credential_form_schemas = []
        if credential_type == CredentialType.API_KEY:
            credential_form_schemas = list(datasource_provider.declaration.credentials_schema)
        elif credential_type == CredentialType.OAUTH2:
            if not datasource_provider.declaration.oauth_schema:
                raise ValueError("Datasource provider oauth schema not found")
            credential_form_schemas = list(datasource_provider.declaration.oauth_schema.credentials_schema)
        else:
            raise ValueError(f"Invalid credential type: {credential_type}")

        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type.value == FormType.SECRET_INPUT:
                secret_input_form_variables.append(credential_form_schema.name)

        return secret_input_form_variables

    def list_datasource_credentials(self, tenant_id: str, provider: str, plugin_id: str) -> list[dict]:
        """
        list datasource credentials with obfuscated sensitive fields.

        :param tenant_id: workspace id
        :param provider_id: provider id
        :return:
        """
        # Get all provider configurations of the current workspace
        datasource_providers: list[DatasourceProvider] = (
            db.session.query(DatasourceProvider)
            .where(
                DatasourceProvider.tenant_id == tenant_id,
                DatasourceProvider.provider == provider,
                DatasourceProvider.plugin_id == plugin_id,
            )
            .all()
        )
        if not datasource_providers:
            return []
        copy_credentials_list = []
        default_provider = (
            db.session.query(DatasourceProvider.id)
            .filter_by(tenant_id=tenant_id, provider=provider, plugin_id=plugin_id)
            .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at.asc())
            .first()
        )
        default_provider_id = default_provider.id if default_provider else None
        for datasource_provider in datasource_providers:
            encrypted_credentials = datasource_provider.encrypted_credentials
            # Get provider credential secret variables
            credential_secret_variables = self.extract_secret_variables(
                tenant_id=tenant_id,
                provider_id=f"{plugin_id}/{provider}",
                credential_type=CredentialType.of(datasource_provider.auth_type),
            )

            # Obfuscate provider credentials
            copy_credentials = encrypted_credentials.copy()
            for key, value in copy_credentials.items():
                if key in credential_secret_variables:
                    copy_credentials[key] = encrypter.obfuscated_token(value)
            copy_credentials_list.append(
                {
                    "credential": copy_credentials,
                    "type": datasource_provider.auth_type,
                    "name": datasource_provider.name,
                    "avatar_url": datasource_provider.avatar_url,
                    "id": datasource_provider.id,
                    "is_default": default_provider_id and datasource_provider.id == default_provider_id,
                }
            )

        return copy_credentials_list

    def get_all_datasource_credentials(self, tenant_id: str) -> list[dict]:
        """
        get datasource credentials.

        :return:
        """
        # get all plugin providers
        manager = PluginDatasourceManager()
        datasources = manager.fetch_installed_datasource_providers(tenant_id)
        datasource_credentials = []
        for datasource in datasources:
            datasource_provider_id = DatasourceProviderID(f"{datasource.plugin_id}/{datasource.provider}")
            credentials = self.list_datasource_credentials(
                tenant_id=tenant_id, provider=datasource.provider, plugin_id=datasource.plugin_id
            )
            redirect_uri = (
                f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{datasource_provider_id}/datasource/callback"
            )
            datasource_credentials.append(
                {
                    "provider": datasource.provider,
                    "plugin_id": datasource.plugin_id,
                    "plugin_unique_identifier": datasource.plugin_unique_identifier,
                    "icon": datasource.declaration.identity.icon,
                    "name": datasource.declaration.identity.name.split("/")[-1],
                    "label": datasource.declaration.identity.label.model_dump(),
                    "description": datasource.declaration.identity.description.model_dump(),
                    "author": datasource.declaration.identity.author,
                    "credentials_list": credentials,
                    "credential_schema": [
                        credential.model_dump() for credential in datasource.declaration.credentials_schema
                    ],
                    "oauth_schema": {
                        "client_schema": [
                            client_schema.model_dump()
                            for client_schema in datasource.declaration.oauth_schema.client_schema
                        ],
                        "credentials_schema": [
                            credential_schema.model_dump()
                            for credential_schema in datasource.declaration.oauth_schema.credentials_schema
                        ],
                        "oauth_custom_client_params": self.get_tenant_oauth_client(
                            tenant_id, datasource_provider_id, mask=True
                        ),
                        "is_oauth_custom_client_enabled": self.is_tenant_oauth_params_enabled(
                            tenant_id, datasource_provider_id
                        ),
                        "is_system_oauth_params_exists": self.is_system_oauth_params_exist(datasource_provider_id),
                        "redirect_uri": redirect_uri,
                    }
                    if datasource.declaration.oauth_schema
                    else None,
                }
            )
        return datasource_credentials

    def get_hard_code_datasource_credentials(self, tenant_id: str) -> list[dict]:
        """
        get hard code datasource credentials.

        :return:
        """
        # get all plugin providers
        manager = PluginDatasourceManager()
        datasources = manager.fetch_installed_datasource_providers(tenant_id)
        datasource_credentials = []
        for datasource in datasources:
            if datasource.plugin_id in [
                "langgenius/firecrawl_datasource",
                "langgenius/notion_datasource",
                "langgenius/jina_datasource",
            ]:
                datasource_provider_id = DatasourceProviderID(f"{datasource.plugin_id}/{datasource.provider}")
                credentials = self.list_datasource_credentials(
                    tenant_id=tenant_id, provider=datasource.provider, plugin_id=datasource.plugin_id
                )
                redirect_uri = "{}/console/api/oauth/plugin/{}/datasource/callback".format(
                    dify_config.CONSOLE_API_URL, datasource_provider_id
                )
                datasource_credentials.append(
                    {
                        "provider": datasource.provider,
                        "plugin_id": datasource.plugin_id,
                        "plugin_unique_identifier": datasource.plugin_unique_identifier,
                        "icon": datasource.declaration.identity.icon,
                        "name": datasource.declaration.identity.name.split("/")[-1],
                        "label": datasource.declaration.identity.label.model_dump(),
                        "description": datasource.declaration.identity.description.model_dump(),
                        "author": datasource.declaration.identity.author,
                        "credentials_list": credentials,
                        "credential_schema": [
                            credential.model_dump() for credential in datasource.declaration.credentials_schema
                        ],
                        "oauth_schema": {
                            "client_schema": [
                                client_schema.model_dump()
                                for client_schema in datasource.declaration.oauth_schema.client_schema
                            ],
                            "credentials_schema": [
                                credential_schema.model_dump()
                                for credential_schema in datasource.declaration.oauth_schema.credentials_schema
                            ],
                            "oauth_custom_client_params": self.get_tenant_oauth_client(
                                tenant_id, datasource_provider_id, mask=True
                            ),
                            "is_oauth_custom_client_enabled": self.is_tenant_oauth_params_enabled(
                                tenant_id, datasource_provider_id
                            ),
                            "is_system_oauth_params_exists": self.is_system_oauth_params_exist(datasource_provider_id),
                            "redirect_uri": redirect_uri,
                        }
                        if datasource.declaration.oauth_schema
                        else None,
                    }
                )
        return datasource_credentials

    def get_real_datasource_credentials(self, tenant_id: str, provider: str, plugin_id: str) -> list[dict]:
        """
        get datasource credentials.

        :param tenant_id: workspace id
        :param provider_id: provider id
        :return:
        """
        # Get all provider configurations of the current workspace
        datasource_providers: list[DatasourceProvider] = (
            db.session.query(DatasourceProvider)
            .where(
                DatasourceProvider.tenant_id == tenant_id,
                DatasourceProvider.provider == provider,
                DatasourceProvider.plugin_id == plugin_id,
            )
            .all()
        )
        if not datasource_providers:
            return []
        copy_credentials_list = []
        for datasource_provider in datasource_providers:
            encrypted_credentials = datasource_provider.encrypted_credentials
            # Get provider credential secret variables
            credential_secret_variables = self.extract_secret_variables(
                tenant_id=tenant_id,
                provider_id=f"{plugin_id}/{provider}",
                credential_type=CredentialType.of(datasource_provider.auth_type),
            )

            # Obfuscate provider credentials
            copy_credentials = encrypted_credentials.copy()
            for key, value in copy_credentials.items():
                if key in credential_secret_variables:
                    copy_credentials[key] = encrypter.decrypt_token(tenant_id, value)
            copy_credentials_list.append(
                {
                    "credentials": copy_credentials,
                    "type": datasource_provider.auth_type,
                }
            )

        return copy_credentials_list

    def update_datasource_credentials(
        self, tenant_id: str, auth_id: str, provider: str, plugin_id: str, credentials: dict | None, name: str | None
    ) -> None:
        """
        update datasource credentials.
        """

        with Session(db.engine) as session:
            datasource_provider = (
                session.query(DatasourceProvider)
                .filter_by(tenant_id=tenant_id, id=auth_id, provider=provider, plugin_id=plugin_id)
                .first()
            )
            if not datasource_provider:
                raise ValueError("Datasource provider not found")
            # update name
            if name and name != datasource_provider.name:
                if (
                    session.query(DatasourceProvider)
                    .filter_by(tenant_id=tenant_id, name=name, provider=provider, plugin_id=plugin_id)
                    .count()
                    > 0
                ):
                    raise ValueError("Authorization name is already exists")
                datasource_provider.name = name

            # update credentials
            if credentials:
                secret_variables = self.extract_secret_variables(
                    tenant_id=tenant_id,
                    provider_id=f"{plugin_id}/{provider}",
                    credential_type=CredentialType.of(datasource_provider.auth_type),
                )
                original_credentials = {
                    key: value if key not in secret_variables else encrypter.decrypt_token(tenant_id, value)
                    for key, value in datasource_provider.encrypted_credentials.items()
                }
                new_credentials = {
                    key: value if value != HIDDEN_VALUE else original_credentials.get(key, UNKNOWN_VALUE)
                    for key, value in credentials.items()
                }
                try:
                    current_user = get_current_user()
                    self.provider_manager.validate_provider_credentials(
                        tenant_id=tenant_id,
                        user_id=current_user.id,
                        provider=provider,
                        plugin_id=plugin_id,
                        credentials=new_credentials,
                    )
                except Exception as e:
                    raise ValueError(f"Failed to validate credentials: {str(e)}")

                encrypted_credentials = {}
                for key, value in new_credentials.items():
                    if key in secret_variables:
                        encrypted_credentials[key] = encrypter.encrypt_token(tenant_id, value)
                    else:
                        encrypted_credentials[key] = value

                datasource_provider.encrypted_credentials = encrypted_credentials
            session.commit()

    def remove_datasource_credentials(self, tenant_id: str, auth_id: str, provider: str, plugin_id: str) -> None:
        """
        remove datasource credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param plugin_id: plugin id
        :return:
        """
        datasource_provider = (
            db.session.query(DatasourceProvider)
            .filter_by(tenant_id=tenant_id, id=auth_id, provider=provider, plugin_id=plugin_id)
            .first()
        )
        if datasource_provider:
            db.session.delete(datasource_provider)
            db.session.commit()
