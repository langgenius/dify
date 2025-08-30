from pydantic import BaseModel, Field, ValidationError


class MoreLikeThisConfig(BaseModel):
    enabled: bool = False


class AppConfigModel(BaseModel):
    more_like_this: MoreLikeThisConfig = Field(default_factory=MoreLikeThisConfig)


class MoreLikeThisConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        """
        Convert model config to model config

        :param config: model config args
        """
        validated_config, _ = cls.validate_and_set_defaults(config)
        return validated_config["more_like_this"]["enabled"]

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        try:
            return AppConfigModel.model_validate(config).dict(), ["more_like_this"]
        except ValidationError as e:
            raise ValueError(
                "more_like_this must be of dict type and enabled in more_like_this must be of boolean type"
            )
