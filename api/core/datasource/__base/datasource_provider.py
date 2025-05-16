from typing import Any

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin
from core.entities.provider_entities import ProviderConfig
from core.plugin.impl.tool import PluginToolManager
from core.tools.errors import ToolProviderCredentialValidationError


class DatasourcePluginProviderController:
    entity: DatasourceProviderEntityWithPlugin
    tenant_id: str
    plugin_id: str
    plugin_unique_identifier: str

    def __init__(
        self, entity: DatasourceProviderEntityWithPlugin, plugin_id: str, plugin_unique_identifier: str, tenant_id: str
    ) -> None:
        self.entity = entity
        self.tenant_id = tenant_id
        self.plugin_id = plugin_id
        self.plugin_unique_identifier = plugin_unique_identifier

    @property
    def need_credentials(self) -> bool:
        """
        returns whether the provider needs credentials

        :return: whether the provider needs credentials
        """
        return self.entity.credentials_schema is not None and len(self.entity.credentials_schema) != 0

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        validate the credentials of the provider
        """
        manager = PluginToolManager()
        if not manager.validate_datasource_credentials(
            tenant_id=self.tenant_id,
            user_id=user_id,
            provider=self.entity.identity.name,
            credentials=credentials,
        ):
            raise ToolProviderCredentialValidationError("Invalid credentials")

    def get_datasource(self, datasource_name: str) -> DatasourcePlugin:  # type: ignore
        """
        return datasource with given name
        """
        datasource_entity = next(
            (
                datasource_entity
                for datasource_entity in self.entity.datasources
                if datasource_entity.identity.name == datasource_name
            ),
            None,
        )

        if not datasource_entity:
            raise ValueError(f"Datasource with name {datasource_name} not found")

        return DatasourcePlugin(
            entity=datasource_entity,
            runtime=DatasourceRuntime(tenant_id=self.tenant_id),
            tenant_id=self.tenant_id,
            icon=self.entity.identity.icon,
            plugin_unique_identifier=self.plugin_unique_identifier,
        )

    def get_datasources(self) -> list[DatasourcePlugin]:  # type: ignore
        """
        get all datasources
        """
        return [
            DatasourcePlugin(
                entity=datasource_entity,
                runtime=DatasourceRuntime(tenant_id=self.tenant_id),
                tenant_id=self.tenant_id,
                icon=self.entity.identity.icon,
                plugin_unique_identifier=self.plugin_unique_identifier,
            )
            for datasource_entity in self.entity.datasources
        ]

    def validate_credentials_format(self, credentials: dict[str, Any]) -> None:
        """
        validate the format of the credentials of the provider and set the default value if needed

        :param credentials: the credentials of the tool
        """
        credentials_schema = dict[str, ProviderConfig]()
        if credentials_schema is None:
            return

        for credential in self.entity.credentials_schema:
            credentials_schema[credential.name] = credential

        credentials_need_to_validate: dict[str, ProviderConfig] = {}
        for credential_name in credentials_schema:
            credentials_need_to_validate[credential_name] = credentials_schema[credential_name]

        for credential_name in credentials:
            if credential_name not in credentials_need_to_validate:
                raise ToolProviderCredentialValidationError(
                    f"credential {credential_name} not found in provider {self.entity.identity.name}"
                )

            # check type
            credential_schema = credentials_need_to_validate[credential_name]
            if not credential_schema.required and credentials[credential_name] is None:
                continue

            if credential_schema.type in {ProviderConfig.Type.SECRET_INPUT, ProviderConfig.Type.TEXT_INPUT}:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} should be string")

            elif credential_schema.type == ProviderConfig.Type.SELECT:
                if not isinstance(credentials[credential_name], str):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} should be string")

                options = credential_schema.options
                if not isinstance(options, list):
                    raise ToolProviderCredentialValidationError(f"credential {credential_name} options should be list")

                if credentials[credential_name] not in [x.value for x in options]:
                    raise ToolProviderCredentialValidationError(
                        f"credential {credential_name} should be one of {options}"
                    )

            credentials_need_to_validate.pop(credential_name)

        for credential_name in credentials_need_to_validate:
            credential_schema = credentials_need_to_validate[credential_name]
            if credential_schema.required:
                raise ToolProviderCredentialValidationError(f"credential {credential_name} is required")

            # the credential is not set currently, set the default value if needed
            if credential_schema.default is not None:
                default_value = credential_schema.default
                # parse default value into the correct type
                if credential_schema.type in {
                    ProviderConfig.Type.SECRET_INPUT,
                    ProviderConfig.Type.TEXT_INPUT,
                    ProviderConfig.Type.SELECT,
                }:
                    default_value = str(default_value)

                credentials[credential_name] = default_value
