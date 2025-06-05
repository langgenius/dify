import logging

from flask_login import current_user

from constants import HIDDEN_VALUE
from core.helper import encrypter
from core.model_runtime.entities.provider_entities import FormType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.impl.datasource import PluginDatasourceManager
from extensions.ext_database import db
from models.oauth import DatasourceProvider

logger = logging.getLogger(__name__)


class DatasourceProviderService:
    """
    Model Provider Service
    """

    def __init__(self) -> None:
        self.provider_manager = PluginDatasourceManager()

    def datasource_provider_credentials_validate(
        self, tenant_id: str, provider: str, plugin_id: str, credentials: dict
    ) -> None:
        """
        validate datasource provider credentials.

        :param tenant_id:
        :param provider:
        :param credentials:
        """
        credential_valid = self.provider_manager.validate_provider_credentials(
            tenant_id=tenant_id, user_id=current_user.id, provider=provider, plugin_id=plugin_id, credentials=credentials
        )
        if credential_valid:
            # Get all provider configurations of the current workspace
            datasource_provider = (
                db.session.query(DatasourceProvider)
                .filter_by(tenant_id=tenant_id, plugin_id=plugin_id, provider=provider, auth_type="api_key")
                .first()
            )

            provider_credential_secret_variables = self.extract_secret_variables(
                                                                                tenant_id=tenant_id,
                                                                                provider_id=f"{plugin_id}/{provider}"
                                                                                 )
            for key, value in credentials.items():
                if key in provider_credential_secret_variables:
                    # if send [__HIDDEN__] in secret input, it will be same as original value
                    credentials[key] = encrypter.encrypt_token(tenant_id, value)
            datasource_provider = DatasourceProvider(
                tenant_id=tenant_id,
                provider=provider,
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
        datasource_provider = self.provider_manager.fetch_datasource_provider(tenant_id=tenant_id,
                                                                              provider_id=provider_id
                                                                              )
        credential_form_schemas = datasource_provider.declaration.credentials_schema
        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type == FormType.SECRET_INPUT:
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
            credential_secret_variables = self.extract_secret_variables(tenant_id=tenant_id, provider_id=provider)

            # Obfuscate provider credentials
            copy_credentials = encrypted_credentials.copy()
            for key, value in copy_credentials.items():
                if key in credential_secret_variables:
                    copy_credentials[key] = encrypter.obfuscated_token(value)
            copy_credentials_list.append(
                {
                    "credentials": copy_credentials,
                    "type": datasource_provider.auth_type,
                }
            )

        return copy_credentials_list

    def update_datasource_credentials(self, tenant_id: str, auth_id: str, provider: str, plugin_id: str, credentials: dict) -> None:
        """
        update datasource credentials.
        """
        credential_valid = self.provider_manager.validate_provider_credentials(
            tenant_id=tenant_id, user_id=current_user.id, provider=provider,plugin_id=plugin_id, credentials=credentials
        )
        if credential_valid:
            # Get all provider configurations of the current workspace
            datasource_provider = (
                db.session.query(DatasourceProvider)
                .filter_by(tenant_id=tenant_id, id=auth_id, provider=provider, plugin_id=plugin_id)
                .first()
            )

            provider_credential_secret_variables = self.extract_secret_variables(
                                                                                tenant_id=tenant_id,
                                                                                provider_id=f"{plugin_id}/{provider}"
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
