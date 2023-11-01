from abc import ABC, abstractmethod
from typing import Optional

from core.extension.extensible import Extensible, ExtensionModule


class Moderation(Extensible, ABC):
    """
    The base class of moderation.
    """
    module: ExtensionModule = ExtensionModule.MODERATION

    def __init__(self, tenant_id: str, config: Optional[dict] = None) -> None:
        super().__init__(tenant_id, config)

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        super().validate_form_schema(config)

        # implement your own validation logic here

    @abstractmethod
    def moderation_for_inputs(self, inputs: dict, query: Optional[str] = None):
        raise NotImplementedError

    @abstractmethod
    def moderation_for_outputs(self, text: str):
        raise NotImplementedError

    @classmethod
    def _validate_inputs_and_outputs_config(self, config: dict, is_preset_response_required: bool) -> None:
        # inputs_configs
        inputs_configs = config.get("inputs_configs")
        if not isinstance(inputs_configs, dict):
            raise ValueError("inputs_configs must be a dict")
        
        # outputs_configs
        outputs_configs = config.get("outputs_configs")
        if not isinstance(outputs_configs, dict):
            raise ValueError("outputs_configs must be a dict")

        inputs_configs_enabled = inputs_configs.get("enabled")
        outputs_configs_enabled = outputs_configs.get("enabled")
        if not inputs_configs_enabled and not outputs_configs_enabled:
            raise ValueError("At least one of inputs_configs or outputs_configs must be enabled")

        # preset_response
        if not is_preset_response_required:
            return
        
        if inputs_configs_enabled and not inputs_configs.get("preset_response"):
            raise ValueError("inputs_configs.preset_response is required")
        
        if outputs_configs_enabled and not outputs_configs.get("preset_response"):
            raise ValueError("outputs_configs.preset_response is required")
