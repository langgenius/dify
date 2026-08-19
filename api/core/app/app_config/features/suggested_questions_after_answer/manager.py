from typing import Any

CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH = 1000


class SuggestedQuestionsAfterAnswerConfigManager:
    @classmethod
    def convert(cls, config: dict[str, Any]) -> bool:
        """
        Convert model config to model config

        :param config: model config args
        """
        suggested_questions_after_answer = False
        suggested_questions_after_answer_dict = config.get("suggested_questions_after_answer")
        if suggested_questions_after_answer_dict:
            if suggested_questions_after_answer_dict.get("enabled"):
                suggested_questions_after_answer = True

        return suggested_questions_after_answer

    @classmethod
    def validate_and_set_defaults(cls, config: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """
        Validate and set defaults for suggested questions feature.

        Optional fields:
        - prompt: custom instruction prompt.
        - model: provider/model configuration for suggested question generation.

        :param config: app model config args
        """
        if not config.get("suggested_questions_after_answer"):
            config["suggested_questions_after_answer"] = {"enabled": False}

        if not isinstance(config["suggested_questions_after_answer"], dict):
            raise ValueError("suggested_questions_after_answer must be of dict type")

        if (
            "enabled" not in config["suggested_questions_after_answer"]
            or not config["suggested_questions_after_answer"]["enabled"]
        ):
            config["suggested_questions_after_answer"]["enabled"] = False

        if not isinstance(config["suggested_questions_after_answer"]["enabled"], bool):
            raise ValueError("enabled in suggested_questions_after_answer must be of boolean type")

        prompt = config["suggested_questions_after_answer"].get("prompt")
        if prompt is not None and not isinstance(prompt, str):
            raise ValueError("prompt in suggested_questions_after_answer must be of string type")
        if isinstance(prompt, str) and len(prompt) > CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH:
            raise ValueError(
                f"prompt in suggested_questions_after_answer must be less than or equal to "
                f"{CUSTOM_FOLLOW_UP_PROMPT_MAX_LENGTH} characters"
            )

        if "model" in config["suggested_questions_after_answer"]:
            model_config = config["suggested_questions_after_answer"]["model"]
            if not isinstance(model_config, dict):
                raise ValueError("model in suggested_questions_after_answer must be of object type")

            if "provider" not in model_config or not isinstance(model_config["provider"], str):
                raise ValueError("provider in suggested_questions_after_answer.model must be of string type")

            if "name" not in model_config or not isinstance(model_config["name"], str):
                raise ValueError("name in suggested_questions_after_answer.model must be of string type")

            if "completion_params" in model_config and not isinstance(model_config["completion_params"], dict):
                raise ValueError("completion_params in suggested_questions_after_answer.model must be of object type")

        return config, ["suggested_questions_after_answer"]
