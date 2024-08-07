from typing import Optional

from core.app.app_config.entities import SensitiveWordAvoidanceEntity
from core.moderation.factory import ModerationFactory


class SensitiveWordAvoidanceConfigManager:
    @classmethod
    def convert(cls, config: dict) -> Optional[SensitiveWordAvoidanceEntity]:
        sensitive_word_avoidance_dict = config.get('sensitive_word_avoidance')
        if not sensitive_word_avoidance_dict:
            return None

        if sensitive_word_avoidance_dict.get('enabled'):
            return SensitiveWordAvoidanceEntity(
                type=sensitive_word_avoidance_dict.get('type'),
                config=sensitive_word_avoidance_dict.get('config'),
            )
        else:
            return None

    @classmethod
    def validate_and_set_defaults(cls, tenant_id, config: dict, only_structure_validate: bool = False) \
            -> tuple[dict, list[str]]:
        if not config.get("sensitive_word_avoidance"):
            config["sensitive_word_avoidance"] = {
                "enabled": False
            }

        if not isinstance(config["sensitive_word_avoidance"], dict):
            raise ValueError("sensitive_word_avoidance must be of dict type")

        if "enabled" not in config["sensitive_word_avoidance"] or not config["sensitive_word_avoidance"]["enabled"]:
            config["sensitive_word_avoidance"]["enabled"] = False

        if config["sensitive_word_avoidance"]["enabled"]:
            if not config["sensitive_word_avoidance"].get("type"):
                raise ValueError("sensitive_word_avoidance.type is required")

            if not only_structure_validate:
                typ = config["sensitive_word_avoidance"]["type"]
                sensitive_word_avoidance_config = config["sensitive_word_avoidance"]["config"]

                ModerationFactory.validate_config(
                    name=typ,
                    tenant_id=tenant_id,
                    config=sensitive_word_avoidance_config
                )

        return config, ["sensitive_word_avoidance"]
