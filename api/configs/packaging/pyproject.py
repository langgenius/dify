from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, TomlConfigSettingsSource


class PyProjectConfig(BaseModel):
    version: str = Field(
        description="Dify version",
    )


class PyProjectTomlConfig(BaseSettings):
    """
    configs in api/pyproject.toml
    """
    # [project] section
    project: PyProjectConfig

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (TomlConfigSettingsSource(settings_cls, toml_file="pyproject.toml"),)
