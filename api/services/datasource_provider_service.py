import logging

from flask_login import current_user
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.helper import encrypter
from core.helper.provider_name_generator import generate_provider_name
from core.model_runtime.entities.provider_entities import FormType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.entities.plugin import DatasourceProviderID
from core.plugin.impl.datasource import PluginDatasourceManager
from core.tools.entities.tool_entities import CredentialType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.oauth import DatasourceProvider

logger = logging.getLogger(__name__)


class DatasourceProviderService:
    """
    Model Provider Service
    """

    def __init__(self) -> None:
        self.provider_manager = PluginDatasourceManager()

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
                auth_type=credential_type.value,
            )
            .all()
        )
        return generate_provider_name(db_providers, credential_type, f"datasource provider {provider_id}")

    def add_datasource_oauth_provider(
        self,
        name: str | None,
        tenant_id: str,
        provider_id: DatasourceProviderID,
        avatar_url: str | None,
        credentials: dict,
    ) -> None:
        """
        add datasource oauth provider
        """
        credential_type = CredentialType.OAUTH2
        with Session(db.engine) as session:
            lock = f"datasource_provider_create_lock:{tenant_id}_{provider_id}_{credential_type.value}"
            with redis_client.lock(lock, timeout=20):
                db_provider_name = name or self.generate_next_datasource_provider_name(
                    session=session,
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    credential_type=credential_type,
                )

                if session.query(DatasourceProvider).filter_by(tenant_id=tenant_id, name=db_provider_name).count() > 0:
                    raise ValueError("name is already exists")

                provider_credential_secret_variables = self.extract_secret_variables(
                    tenant_id=tenant_id, provider_id=f"{provider_id}"
                )
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        # if send [__HIDDEN__] in secret input, it will be same as original value
                        credentials[key] = encrypter.encrypt_token(tenant_id, value)

                datasource_provider = DatasourceProvider(
                    tenant_id=tenant_id,
                    name=db_provider_name,
                    provider=provider_id.provider_name,
                    plugin_id=provider_id.plugin_id,
                    auth_type=credential_type.value,
                    encrypted_credentials=credentials,
                    avatar_url=avatar_url,
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
            lock = f"datasource_provider_create_lock:{tenant_id}_{provider_id}_api_key"
            with redis_client.lock(lock, timeout=20):
                db_provider_name = name or self.generate_next_datasource_provider_name(
                    session=session,
                    tenant_id=tenant_id,
                    provider_id=provider_id,
                    credential_type=CredentialType.API_KEY,
                )

                # check name is exist
                if session.query(DatasourceProvider).filter_by(tenant_id=tenant_id, name=db_provider_name).count() > 0:
                    raise ValueError("Authorization name is already exists")

                credential_valid = self.provider_manager.validate_provider_credentials(
                    tenant_id=tenant_id,
                    user_id=current_user.id,
                    provider=provider_name,
                    plugin_id=plugin_id,
                    credentials=credentials,
                )
                if credential_valid:
                    provider_credential_secret_variables = self.extract_secret_variables(
                        tenant_id=tenant_id, provider_id=f"{provider_id}"
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
                        auth_type="api_key",
                        encrypted_credentials=credentials,
                    )
                    db.session.add(datasource_provider)
                    db.session.commit()
                else:
                    raise CredentialsValidateFailedError()

    def extract_secret_variables(self, tenant_id: str, provider_id: str) -> list[str]:
        """
        Extract secret input form variables.

        :param credential_form_schemas:
        :return:
        """
        datasource_provider = self.provider_manager.fetch_datasource_provider(
            tenant_id=tenant_id, provider_id=provider_id
        )
        credential_form_schemas = datasource_provider.declaration.credentials_schema
        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type.value == FormType.SECRET_INPUT.value:
                secret_input_form_variables.append(credential_form_schema.name)

        return secret_input_form_variables

    def get_datasource_credentials(self, tenant_id: str, provider: str, plugin_id: str) -> list[dict]:
        """
        get datasource credentials.

        :param tenant_id: workspace id
        :param provider_id: provider id
        :return:
        """
        # Get all provider configurations of the current workspace
        datasource_providers: list[DatasourceProvider] = (
            db.session.query(DatasourceProvider)
            .filter(
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
                tenant_id=tenant_id, provider_id=f"{plugin_id}/{provider}"
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
                    "id": datasource_provider.id,
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
            credentials = self.get_datasource_credentials(
                tenant_id=tenant_id, provider=datasource.provider, plugin_id=datasource.plugin_id
            )
            datasource_credentials.append(
                {
                    "provider": datasource.provider,
                    "plugin_id": datasource.plugin_id,
                    "plugin_unique_identifier": datasource.plugin_unique_identifier,
                    "icon": datasource.declaration.identity.icon,
                    "name": datasource.declaration.identity.name,
                    "label": datasource.declaration.identity.label.model_dump(),
                    "description": datasource.declaration.identity.description.model_dump(),
                    "author": datasource.declaration.identity.author,
                    "credentials_list": credentials,
                    "credential_schema": [
                        {
                            "type": credential.type.value,
                            "name": credential.name,
                            "required": credential.required,
                            "default": credential.default,
                            "options": [
                                {
                                    "value": option.value,
                                    "label": option.label.model_dump(),
                                }
                                for option in credential.options or []
                            ],
                        }
                        for credential in datasource.declaration.credentials_schema
                    ],
                    "oauth_schema": {
                        "client_schema": [
                            {
                                "type": client_schema.type.value,
                                "name": client_schema.name,
                                "required": client_schema.required,
                                "default": client_schema.default,
                                "options": [
                                    {
                                        "value": option.value,
                                        "label": option.label.model_dump(),
                                    }
                                    for option in client_schema.options or []
                                ],
                            }
                            for client_schema in datasource.declaration.oauth_schema.client_schema or []
                        ],
                        "credentials_schema": [
                            {
                                "type": credential.type.value,
                                "name": credential.name,
                                "required": credential.required,
                                "default": credential.default,
                                "options": [
                                    {
                                        "value": option.value,
                                        "label": option.label.model_dump(),
                                    }
                                    for option in credential.options or []
                                ],
                            }
                            for credential in datasource.declaration.oauth_schema.credentials_schema or []
                        ],
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
            .filter(
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
                tenant_id=tenant_id, provider_id=f"{plugin_id}/{provider}"
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
        self, tenant_id: str, auth_id: str, provider: str, plugin_id: str, credentials: dict
    ) -> None:
        """
        update datasource credentials.
        """
        credential_valid = self.provider_manager.validate_provider_credentials(
            tenant_id=tenant_id,
            user_id=current_user.id,
            provider=provider,
            plugin_id=plugin_id,
            credentials=credentials,
        )
        if credential_valid:
            # Get all provider configurations of the current workspace
            datasource_provider = (
                db.session.query(DatasourceProvider)
                .filter_by(tenant_id=tenant_id, id=auth_id, provider=provider, plugin_id=plugin_id)
                .first()
            )

            provider_credential_secret_variables = self.extract_secret_variables(
                tenant_id=tenant_id, provider_id=f"{plugin_id}/{provider}"
            )
            if not datasource_provider:
                raise ValueError("Datasource provider not found")
            else:
                original_credentials = datasource_provider.encrypted_credentials
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        # if send [__HIDDEN__] in secret input, it will be same as original value
                        if value == HIDDEN_VALUE and key in original_credentials:
                            original_value = encrypter.encrypt_token(tenant_id, original_credentials[key])
                            credentials[key] = encrypter.encrypt_token(tenant_id, original_value)
                        else:
                            credentials[key] = encrypter.encrypt_token(tenant_id, value)

                datasource_provider.encrypted_credentials = credentials
                db.session.commit()
        else:
            raise CredentialsValidateFailedError()

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
