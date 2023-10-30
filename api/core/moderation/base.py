from abc import abstractclassmethod


class BaseModeration():
    _subclasses = {}

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        type = getattr(cls, 'type', None)
        if type:
            BaseModeration._subclasses[type] = cls

    @abstractclassmethod
    def validate_config(self, config: dict) -> None:
        pass

    @abstractclassmethod
    def moderation_for_inputs(self, config: dict):
        pass

    @abstractclassmethod
    def moderation_for_outputs(self, config: dict):
        pass

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
        
    @staticmethod
    def create_instance(type: str, *args, **kwargs):
        if type in BaseModeration._subclasses:
            return BaseModeration._subclasses[type](*args, **kwargs)
        else:
            raise ValueError(f"No type named {type} found.")