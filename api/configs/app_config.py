import logging
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

from .deploy import DeploymentConfig
from .enterprise import EnterpriseFeatureConfig
from .extra import ExtraServiceConfig
from .feature import FeatureConfig
from .middleware import MiddlewareConfig
from .packaging import PackagingInfo
from .remote_settings_sources import RemoteSettingsSource, RemoteSettingsSourceConfig, RemoteSettingsSourceName
from .remote_settings_sources.apollo import ApolloSettingsSource

logger = logging.getLogger(__name__)


class RemoteSettingsSourceFactory(PydanticBaseSettingsSource):
    def __init__(self, settings_cls: type[BaseSettings]):
        super().__init__(settings_cls)

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        raise NotImplementedError

    def __call__(self) -> dict[str, Any]:
        current_state = self.current_state
        remote_source_name = current_state.get("REMOTE_SETTINGS_SOURCE_NAME")
        if not remote_source_name:
            return {}

        remote_source: RemoteSettingsSource | None = None
        match remote_source_name:
            case RemoteSettingsSourceName.APOLLO:
                remote_source = ApolloSettingsSource(current_state)
            case _:
                logger.warning(f"Unsupported remote source: {remote_source_name}")
                return {}

        d: dict[str, Any] = {}

        for field_name, field in self.settings_cls.model_fields.items():
            field_value, field_key, value_is_complex = remote_source.get_field_value(field, field_name)
            field_value = remote_source.prepare_field_value(field_name, field, field_value, value_is_complex)
            if field_value is not None:
                d[field_key] = field_value

        return d


class DifyConfig(
    # Packaging info
    PackagingInfo,
    # Deployment configs
    DeploymentConfig,
    # Feature configs
    FeatureConfig,
    # Middleware configs
    MiddlewareConfig,
    # Extra service configs
    ExtraServiceConfig,
    # Remote source configs
    RemoteSettingsSourceConfig,
    # Enterprise feature configs
    # **Before using, please contact business@dify.ai by email to inquire about licensing matters.**
    EnterpriseFeatureConfig,
):
    model_config = SettingsConfigDict(
        # read from dotenv format config file
        env_file=".env",
        env_file_encoding="utf-8",
        # ignore extra attributes
        extra="ignore",
    )

    # Before adding any config,
    # please consider to arrange it in the proper config group of existed or added
    # for better readability and maintainability.
    # Thanks for your concentration and consideration.

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            RemoteSettingsSourceFactory(settings_cls),
            dotenv_settings,
            file_secret_settings,
        )
