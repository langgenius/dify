from collections.abc import Mapping
from typing import Any

from core.app.app_config.entities import ModelConfigEntity
from core.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from core.provider_manager import ProviderManager
from models.provider_ids import ModelProviderID


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
            raise ValueError("模型为必填项")

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
            raise ValueError("模型为必填项")

        if not isinstance(config["model"], dict):
            raise ValueError("模型必须为对象类型")

        # model.provider
        model_provider_factory = ModelProviderFactory(tenant_id)
        provider_entities = model_provider_factory.get_providers()
        model_provider_names = [provider.provider for provider in provider_entities]
        if "provider" not in config["model"]:
            raise ValueError(f"model.provider is required and must be in {str(model_provider_names)}")

        if "/" not in config["model"]["provider"]:
            config["model"]["provider"] = str(ModelProviderID(config["model"]["provider"]))

        if config["model"]["provider"] not in model_provider_names:
            raise ValueError(f"model.provider is required and must be in {str(model_provider_names)}")

        # model.name
        if "name" not in config["model"]:
            raise ValueError("model.name 为必填项")

        provider_manager = ProviderManager()
        models = provider_manager.get_configurations(tenant_id).get_models(
            provider=config["model"]["provider"], model_type=ModelType.LLM
        )

        if not models:
            raise ValueError("model.name 必须在指定的模型列表中")

        model_ids = [m.model for m in models]
        if config["model"]["name"] not in model_ids:
            raise ValueError("model.name 必须在指定的模型列表中")

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
            raise ValueError("model.completion_params 为必填项")

        config["model"]["completion_params"] = cls.validate_model_completion_params(
            config["model"]["completion_params"]
        )

        return dict(config), ["model"]

    @classmethod
    def validate_model_completion_params(cls, cp: dict):
        # model.completion_params
        if not isinstance(cp, dict):
            raise ValueError("model.completion_params 必须为对象类型")

        # stop
        if "stop" not in cp:
            cp["stop"] = []
        elif not isinstance(cp["stop"], list):
            raise ValueError("model.completion_params 中的 stop 必须为列表类型")

        if len(cp["stop"]) > 4:
            raise ValueError("停止序列不能超过 4 个")

        return cp
