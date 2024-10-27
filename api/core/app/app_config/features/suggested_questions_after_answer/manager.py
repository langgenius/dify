class SuggestedQuestionsAfterAnswerConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        """
        Convert model config to model config

        :param config: model config args
        """
        suggested_questions_after_answer = False
        suggested_questions_after_answer_dict = config.get('suggested_questions_after_answer')
        if suggested_questions_after_answer_dict:
            if suggested_questions_after_answer_dict.get('enabled'):
                suggested_questions_after_answer = True

        return suggested_questions_after_answer

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for suggested questions feature

        :param config: app model config args
        """
        if not config.get("suggested_questions_after_answer"):
            config["suggested_questions_after_answer"] = {
                "enabled": False
            }

        if not isinstance(config["suggested_questions_after_answer"], dict):
            raise ValueError("suggested_questions_after_answer must be of dict type")

        if "enabled" not in config["suggested_questions_after_answer"] or not \
        config["suggested_questions_after_answer"]["enabled"]:
            config["suggested_questions_after_answer"]["enabled"] = False

        if not isinstance(config["suggested_questions_after_answer"]["enabled"], bool):
            raise ValueError("enabled in suggested_questions_after_answer must be of boolean type")

        return config, ["suggested_questions_after_answer"]
