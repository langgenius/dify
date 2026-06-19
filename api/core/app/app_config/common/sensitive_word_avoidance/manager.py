from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from core.app.app_config.entities import SensitiveWordAvoidanceEntity
from core.moderation.factory import ModerationFactory


class SensitiveWordAvoidanceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    type: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if data.get("enabled") is None:
                data["enabled"] = False
            if data.get("config") is None:
                data["config"] = {}
        return data

    @model_validator(mode="after")
    def _check_enabled(self) -> "SensitiveWordAvoidanceConfig":
        if self.enabled and not self.type:
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
