from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator, model_validator

from core.app.app_config.entities import SensitiveWordAvoidanceEntity
from core.moderation.factory import ModerationFactory


class SensitiveWordAvoidanceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    type: str | None = None
    config: dict[str, Any] = {}

    @field_validator("enabled", mode="before")
    @classmethod
    def coerce_enabled(cls, value: Any) -> Any:
        if value is None:
            return False
        return value

    @field_validator("type", mode="before")
    @classmethod
    def validate_type(cls, value: Any) -> Any:
        if value is not None and not isinstance(value, str):
            raise ValueError("sensitive_word_avoidance.type must be a string")
        return value

    @field_validator("config", mode="before")
    @classmethod
    def validate_config(cls, value: Any) -> Any:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise ValueError("sensitive_word_avoidance.config must be a dict")
        return value

    @model_validator(mode="after")
    def validate_enabled_fields(self) -> "SensitiveWordAvoidanceConfig":
        if self.enabled:
            if not self.type:
                raise ValueError("sensitive_word_avoidance.type is required when enabled")
        return self

    def run_provider_validation(self, tenant_id: str) -> None:
        """Call ModerationFactory validation (skip for structure-only checks)."""
        if self.enabled and self.type:
            ModerationFactory.validate_config(name=self.type, tenant_id=tenant_id, config=self.config)


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
        try:
            validated = SensitiveWordAvoidanceConfig.model_validate(raw)
        except ValidationError as e:
            if not isinstance(raw, dict):
                raise ValueError("sensitive_word_avoidance must be of dict type") from e
            raise

        if not only_structure_validate:
            validated.run_provider_validation(tenant_id)

        config["sensitive_word_avoidance"] = validated.model_dump()
        return config, ["sensitive_word_avoidance"]
