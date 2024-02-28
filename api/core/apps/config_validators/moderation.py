import logging

from core.moderation.factory import ModerationFactory

logger = logging.getLogger(__name__)


class ModerationValidator:
    @classmethod
    def validate_and_set_defaults(cls, tenant_id, config: dict) -> tuple[dict, list[str]]:
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

            typ = config["sensitive_word_avoidance"]["type"]
            config = config["sensitive_word_avoidance"]["config"]

            ModerationFactory.validate_config(
                name=typ,
                tenant_id=tenant_id,
                config=config
            )

        return config, ["sensitive_word_avoidance"]
