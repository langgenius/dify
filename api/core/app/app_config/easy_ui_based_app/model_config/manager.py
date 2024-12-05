from collections.abc import Mapping
from typing import Any

from core.app.app_config.entities import ModelConfigEntity
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.model_providers import model_provider_factory
from core.provider_manager import ProviderManager


class ModelConfigManager:
    @classmethod
    def convert(cls, config: dict) -> ModelConfigEntity:
        """
        Convert model config to model config

        :param config: model config args
        """
        # model config
        model_config = config.get("model")

        if not model_config:
            raise ValueError("model is required")

        completion_params = model_config.get("completion_params")
        stop = []
        if "stop" in completion_params:
            stop = completion_params["stop"]
            del completion_params["stop"]

        # get model mode
        model_mode = model_config.get("mode")

        return ModelConfigEntity(
            provider=config["model"]["provider"],
            model=config["model"]["name"],
            mode=model_mode,
            parameters=completion_params,
            stop=stop,
        )

    @classmethod
    def validate_and_set_defaults(cls, tenant_id: str, config: Mapping[str, Any]) -> tuple[dict, list[str]]:
        """
        Validate and set defaults for model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        if "model" not in config:
            raise ValueError("model is required")

        if not isinstance(config["model"], dict):
            raise ValueError("model must be of object type")

        # model.provider
        provider_entities = model_provider_factory.get_providers()
        model_provider_names = [provider.provider for provider in provider_entities]
        if "provider" not in config["model"] or config["model"]["provider"] not in model_provider_names:
            raise ValueError(f"model.provider is required and must be in {str(model_provider_names)}")

        # model.name
        if "name" not in config["model"]:
            raise ValueError("model.name is required")

        provider_manager = ProviderManager()
        models = provider_manager.get_configurations(tenant_id).get_models(
            provider=config["model"]["provider"], model_type=ModelType.LLM
        )

        if not models:
            raise ValueError("model.name must be in the specified model list")

        model_ids = [m.model for m in models]
        if config["model"]["name"] not in model_ids:
            raise ValueError("model.name must be in the specified model list")

        model_mode = None
        for model in models:
            if model.model == config["model"]["name"]:
                model_mode = model.model_properties.get(ModelPropertyKey.MODE)
                break

        # model.mode
        if model_mode:
            config["model"]["mode"] = model_mode
        else:
            config["model"]["mode"] = "completion"

        # model.completion_params
        if "completion_params" not in config["model"]:
            raise ValueError("model.completion_params is required")

        config["model"]["completion_params"] = cls.validate_model_completion_params(
            config["model"]["completion_params"]
        )

        return config, ["model"]

    @classmethod
    def validate_model_completion_params(cls, cp: dict) -> dict:
        # model.completion_params
        if not isinstance(cp, dict):
            raise ValueError("model.completion_params must be of object type")

        # stop
        if "stop" not in cp:
            cp["stop"] = []
        elif not isinstance(cp["stop"], list):
            raise ValueError("stop in model.completion_params must be of list type")

        if len(cp["stop"]) > 4:
            raise ValueError("stop sequences must be less than 4")

        return cp
