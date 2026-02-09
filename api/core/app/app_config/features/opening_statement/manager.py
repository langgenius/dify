class OpeningStatementConfigManager:
    @classmethod
    def convert(cls, config: dict) -> tuple[str, list]:
        """
        Convert model config to model config

        :param config: model config args
        """
        # opening statement
        opening_statement = config.get("opening_statement", "")

        # suggested questions
        suggested_questions_list = config.get("suggested_questions", [])

        return opening_statement, suggested_questions_list

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for opening statement feature

        :param config: app model config args
        """
        if not config.get("opening_statement"):
            config["opening_statement"] = ""

        if not isinstance(config["opening_statement"], str):
            raise ValueError("opening_statement 必须为字符串类型")

        # suggested_questions
        if not config.get("suggested_questions"):
            config["suggested_questions"] = []

        if not isinstance(config["suggested_questions"], list):
            raise ValueError("suggested_questions 必须为列表类型")

        for question in config["suggested_questions"]:
            if not isinstance(question, str):
                raise ValueError("suggested_questions 列表中的元素必须为字符串类型")

        return config, ["opening_statement", "suggested_questions"]
