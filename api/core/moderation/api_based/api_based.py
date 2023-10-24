from core.moderation.base import BaseModeration


class ApiBasedModeration(BaseModeration):
    register_name = "api_based"

    @classmethod
    def validate_config(self, config: dict) -> None:
        api_based_extension_id = config.get("api_based_extension_id")
        if not api_based_extension_id:
            raise ValueError("api_based_extension_id is required")
        
        self._validate_inputs_and_outputs_config(config, False)