import os
from abc import ABC, abstractmethod
from typing import Optional

from core.helper.module_import_helper import get_subclasses_from_module, import_module_from_source
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType
from core.model_runtime.entities.provider_entities import ProviderEntity
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.tools.utils.yaml_utils import load_yaml_file


class ModelProvider(ABC):
    provider_schema: Optional[ProviderEntity] = None
    model_instance_map: dict[str, AIModel] = {}

    @abstractmethod
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials
        You can choose any validate_credentials method of model type or implement validate method by yourself,
        such as: get model list api

        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        raise NotImplementedError

    def get_provider_schema(self) -> ProviderEntity:
        """
        Get provider schema

        :return: provider schema
        """
        if self.provider_schema:
            return self.provider_schema

        # get dirname of the current path
        provider_name = self.__class__.__module__.split(".")[-1]

        # get the path of the model_provider classes
        base_path = os.path.abspath(__file__)
        current_path = os.path.join(os.path.dirname(os.path.dirname(base_path)), provider_name)

        # read provider schema from yaml file
        yaml_path = os.path.join(current_path, f"{provider_name}.yaml")
        yaml_data = load_yaml_file(yaml_path)

        try:
            # yaml_data to entity
            provider_schema = ProviderEntity(**yaml_data)
        except Exception as e:
            raise Exception(f"Invalid provider schema for {provider_name}: {str(e)}")

        # cache schema
        self.provider_schema = provider_schema

        return provider_schema

    def models(self, model_type: ModelType) -> list[AIModelEntity]:
        """
        Get all models for given model type

        :param model_type: model type defined in `ModelType`
        :return: list of models
        """
        provider_schema = self.get_provider_schema()
        if model_type not in provider_schema.supported_model_types:
            return []

        # get model instance of the model type
        model_instance = self.get_model_instance(model_type)

        # get predefined models (predefined_models)
        models = model_instance.predefined_models()

        # return models
        return models

    def get_model_instance(self, model_type: ModelType) -> AIModel:
        """
        Get model instance

        :param model_type: model type defined in `ModelType`
        :return:
        """
        # get dirname of the current path
        provider_name = self.__class__.__module__.split(".")[-1]

        if f"{provider_name}.{model_type.value}" in self.model_instance_map:
            return self.model_instance_map[f"{provider_name}.{model_type.value}"]

        # get the path of the model type classes
        base_path = os.path.abspath(__file__)
        model_type_name = model_type.value.replace("-", "_")
        model_type_path = os.path.join(os.path.dirname(os.path.dirname(base_path)), provider_name, model_type_name)
        model_type_py_path = os.path.join(model_type_path, f"{model_type_name}.py")

        if not os.path.isdir(model_type_path) or not os.path.exists(model_type_py_path):
            raise Exception(f"Invalid model type {model_type} for provider {provider_name}")

        # Dynamic loading {model_type_name}.py file and find the subclass of AIModel
        parent_module = ".".join(self.__class__.__module__.split(".")[:-1])
        mod = import_module_from_source(
            module_name=f"{parent_module}.{model_type_name}.{model_type_name}", py_file_path=model_type_py_path
        )
        # FIXME "type" has no attribute "__abstractmethods__" ignore it for now fix it later
        model_class = next(
            filter(
                lambda x: x.__module__ == mod.__name__ and not x.__abstractmethods__,  # type: ignore
                get_subclasses_from_module(mod, AIModel),
            ),
            None,
        )
        if not model_class:
            raise Exception(f"Missing AIModel Class for model type {model_type} in {model_type_py_path}")

        model_instance_map = model_class()
        self.model_instance_map[f"{provider_name}.{model_type.value}"] = model_instance_map

        return model_instance_map
