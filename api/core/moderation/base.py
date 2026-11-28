from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping
from enum import StrEnum, auto
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field, JsonValue

from core.extension.extensible import Extensible, ExtensionModule

if TYPE_CHECKING:
    from core.app.app_config.entities import AppConfig


@runtime_checkable
class ApiModerationRuntime(Protocol):
    """Tenant-scoped API moderation capabilities injected by the application.

    All lookups finish before decryption or outbound work. Missing extensions and
    dependency failures propagate to the caller without changing legacy payloads.
    """

    def validate_extension(self, tenant_id: str, extension_id: str) -> None: ...

    def request_inputs(self, tenant_id: str, extension_id: str, params: dict[str, object]) -> JsonValue: ...

    def request_outputs(self, tenant_id: str, extension_id: str, params: dict[str, object]) -> JsonValue: ...


@runtime_checkable
class AppModeration(Protocol):
    """Stateless app checks and replacement, independent of workflow node error strategies.

    Only a trusted runtime ownership decision can defer an app OpenAI rule.
    Keywords and API rules are independent of that decision.
    """

    def evaluate_input(
        self, app_config: AppConfig, inputs: Mapping[str, object], query: str, *, platform_owned: bool
    ) -> ModerationInputsResult | None: ...

    def output_evaluator(
        self, app_config: AppConfig, *, platform_owned: bool
    ) -> Callable[[str], ModerationOutputsResult | None] | None: ...

    def replacement(self, app_config: AppConfig, error: Exception) -> tuple[str, str] | None: ...


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
        # inputs_config
        inputs_config = config.get("inputs_config")
        if not isinstance(inputs_config, dict):
            raise ValueError("inputs_config must be a dict")

        # outputs_config
        outputs_config = config.get("outputs_config")
        if not isinstance(outputs_config, dict):
            raise ValueError("outputs_config must be a dict")

        inputs_config_enabled = inputs_config.get("enabled")
        outputs_config_enabled = outputs_config.get("enabled")
        if not inputs_config_enabled and not outputs_config_enabled:
            raise ValueError("At least one of inputs_config or outputs_config must be enabled")

        # preset_response
        if not is_preset_response_required:
            return

        if inputs_config_enabled:
            if not inputs_config.get("preset_response"):
                raise ValueError("inputs_config.preset_response is required")

            if len(inputs_config.get("preset_response", "0")) > 100:
                raise ValueError("inputs_config.preset_response must be less than 100 characters")

        if outputs_config_enabled:
            if not outputs_config.get("preset_response"):
                raise ValueError("outputs_config.preset_response is required")

            if len(outputs_config.get("preset_response", "0")) > 100:
                raise ValueError("outputs_config.preset_response must be less than 100 characters")


class ModerationError(Exception):
    pass
