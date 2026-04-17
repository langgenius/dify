from abc import ABC, abstractmethod
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from core.extension.extensible import Extensible, ExtensionModule


class ModerationAction(StrEnum):
    DIRECT_OUTPUT = auto()
    OVERRIDDEN = auto()


class ModerationInputsResult(BaseModel):
    flagged: bool = False
    action: ModerationAction
    preset_response: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    query: str = ""


class ModerationOutputsResult(BaseModel):
    flagged: bool = False
    action: ModerationAction
    preset_response: str = ""
    text: str = ""


class ModerationConfigItem(BaseModel):
    """Sub-config for inputs_config or outputs_config."""

    enabled: bool = False
    preset_response: str = ""


class ModerationConfig(BaseModel):
    """Top-level moderation config with inputs_config and outputs_config."""

    model_config = ConfigDict(extra="ignore")

    inputs_config: ModerationConfigItem
    outputs_config: ModerationConfigItem


class Moderation(Extensible, ABC):
    """
    The base class of moderation.
    """

    module: ExtensionModule = ExtensionModule.MODERATION

    def __init__(self, app_id: str, tenant_id: str, config: dict[str, Any] | None = None):
        super().__init__(tenant_id, config)
        self.app_id = app_id

    @classmethod
    @abstractmethod
    def validate_config(cls, tenant_id: str, config: dict[str, Any]) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        raise NotImplementedError

    @abstractmethod
    def moderation_for_inputs(self, inputs: dict[str, Any], query: str = "") -> ModerationInputsResult:
        """
        Moderation for inputs.
        After the user inputs, this method will be called to perform sensitive content review
        on the user inputs and return the processed results.

        :param inputs: user inputs
        :param query: query string (required in chat app)
        :return:
        """
        raise NotImplementedError

    @abstractmethod
    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        """
        Moderation for outputs.
        When LLM outputs content, the front end will pass the output content (may be segmented)
        to this method for sensitive content review, and the output content will be shielded if the review fails.

        :param text: LLM output content
        :return:
        """
        raise NotImplementedError

    @classmethod
    def _validate_inputs_and_outputs_config(cls, config: dict[str, Any], is_preset_response_required: bool):
        # Validate the full config with a single model_validate call
        config_model = ModerationConfig.model_validate(config)
        inputs_config = config_model.inputs_config
        outputs_config = config_model.outputs_config

        if not inputs_config.enabled and not outputs_config.enabled:
            raise ValueError("At least one of inputs_config or outputs_config must be enabled")

        if not is_preset_response_required:
            return

        if inputs_config.enabled:
            if not inputs_config.preset_response:
                raise ValueError("inputs_config.preset_response is required")

            if len(inputs_config.preset_response) > 100:
                raise ValueError("inputs_config.preset_response must be less than 100 characters")

        if outputs_config.enabled:
            if not outputs_config.preset_response:
                raise ValueError("outputs_config.preset_response is required")

            if len(outputs_config.preset_response) > 100:
                raise ValueError("outputs_config.preset_response must be less than 100 characters")


class ModerationError(Exception):
    pass
