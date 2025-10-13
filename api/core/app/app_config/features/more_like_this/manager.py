from pydantic import BaseModel, ConfigDict, Field, ValidationError


class MoreLikeThisConfig(BaseModel):
    enabled: bool = False
    model_config = ConfigDict(extra="allow")


class AppConfigModel(BaseModel):
    more_like_this: MoreLikeThisConfig = Field(default_factory=MoreLikeThisConfig)
    model_config = ConfigDict(extra="allow")


class MoreLikeThisConfigManager:
    @classmethod
    def convert(cls, config: dict) -> bool:
        """
        Convert model config to model config

        :param config: model config args
        """
        validated_config, _ = cls.validate_and_set_defaults(config)
        return AppConfigModel.model_validate(validated_config).more_like_this.enabled

    @classmethod
    def validate_and_set_defaults(cls, config: dict) -> tuple[dict, list[str]]:
        try:
            return AppConfigModel.model_validate(config).model_dump(), ["more_like_this"]
        except ValidationError:
            raise ValueError(
                "more_like_this must be of dict type and enabled in more_like_this must be of boolean type"
            )
