from collections.abc import Mapping
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from core.app.app_config.entities import SensitiveWordAvoidanceEntity
from core.moderation.factory import ModerationFactory


class SensitiveWordAvoidanceDisabledConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Literal[False] = False


class SensitiveWordAvoidanceKeywordsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Literal[True] = True
    type: Literal["keywords"]
    config: dict[str, Any] = Field(default_factory=dict)

    def run_provider_validation(self, tenant_id: str) -> None:
        ModerationFactory.validate_config(name=self.type, tenant_id=tenant_id, config=self.config)


class SensitiveWordAvoidanceOpenAIConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Literal[True] = True
    type: Literal["openai_moderation"]
    config: dict[str, Any] = Field(default_factory=dict)

    def run_provider_validation(self, tenant_id: str) -> None:
        ModerationFactory.validate_config(name=self.type, tenant_id=tenant_id, config=self.config)


class SensitiveWordAvoidanceAPIConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: Literal[True] = True
    type: Literal["api"]
    config: dict[str, Any] = Field(default_factory=dict)

    def run_provider_validation(self, tenant_id: str) -> None:
        ModerationFactory.validate_config(name=self.type, tenant_id=tenant_id, config=self.config)


EnabledSensitiveWordAvoidanceConfig = Annotated[
    SensitiveWordAvoidanceKeywordsConfig | SensitiveWordAvoidanceOpenAIConfig | SensitiveWordAvoidanceAPIConfig,
    Field(discriminator="type"),
]

SensitiveWordAvoidanceConfig = Annotated[
    SensitiveWordAvoidanceDisabledConfig | EnabledSensitiveWordAvoidanceConfig,
    Field(discriminator="enabled"),
]

_sensitive_word_avoidance_adapter: TypeAdapter[SensitiveWordAvoidanceConfig] = TypeAdapter(SensitiveWordAvoidanceConfig)


def _normalize_raw(raw: Any) -> Any:
    if isinstance(raw, dict):
        enabled = raw.get("enabled")
        if enabled is None:
            raw = {**raw, "enabled": False}
        elif enabled is True:
            if raw.get("config") is None:
                raw = {**raw, "config": {}}
        else:
            # enabled is False or any falsy value —
            # drop extra fields (type, config) so they don't
            # violate SensitiveWordAvoidanceDisabledConfig.extra="forbid"
            raw = {"enabled": False}
    return raw


class SensitiveWordAvoidanceConfigManager:
    @classmethod
    def convert(cls, config: Mapping[str, Any]) -> SensitiveWordAvoidanceEntity | None:
        sensitive_word_avoidance_dict = config.get("sensitive_word_avoidance")
        if not sensitive_word_avoidance_dict:
            return None

        if sensitive_word_avoidance_dict.get("enabled"):
            return SensitiveWordAvoidanceEntity(
                type=sensitive_word_avoidance_dict.get("type"),
                config=sensitive_word_avoidance_dict.get("config", {}),
            )
        else:
            return None

    @classmethod
    def validate_and_set_defaults(
        cls, tenant_id: str, config: dict[str, Any], only_structure_validate: bool = False
    ) -> tuple[dict[str, Any], list[str]]:
        raw = config.get("sensitive_word_avoidance") or {"enabled": False}
        if not isinstance(raw, dict):
            raise ValueError("sensitive_word_avoidance must be of dict type")

        try:
            validated = _sensitive_word_avoidance_adapter.validate_python(_normalize_raw(raw))
        except ValidationError:
            raise

        if not only_structure_validate and isinstance(
            validated,
            (
                SensitiveWordAvoidanceKeywordsConfig,
                SensitiveWordAvoidanceOpenAIConfig,
                SensitiveWordAvoidanceAPIConfig,
            ),
        ):
            validated.run_provider_validation(tenant_id)

        config["sensitive_word_avoidance"] = validated.model_dump()
        return config, ["sensitive_word_avoidance"]
