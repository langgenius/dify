from typing import Any, Literal, override

from core.credit_usage import CreditUsageCreatedBy
from core.model_context import get_app_moderation_runtime, with_credit_usage_created_by
from core.model_manager import ModelManager
from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult
from graphon.model_runtime.entities.model_entities import ModelType


class OpenAIModeration(Moderation):
    name: str = "openai_moderation"

    @classmethod
    @override
    def validate_config(cls, tenant_id: str, config: dict[str, Any]):
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        cls._validate_inputs_and_outputs_config(config, True)

    @override
    def moderation_for_inputs(self, inputs: dict[str, Any], query: str = "") -> ModerationInputsResult:
        flagged = False
        preset_response = ""
        if self.config is None:
            raise ValueError("The config is not set.")

        if self.config["inputs_config"]["enabled"]:
            preset_response = self.config["inputs_config"]["preset_response"]

            if query:
                inputs["query__"] = query
            flagged = self._is_violated(inputs, phase="input")

        return ModerationInputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    @override
    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        flagged = False
        preset_response = ""
        if self.config is None:
            raise ValueError("The config is not set.")

        if self.config["outputs_config"]["enabled"]:
            flagged = self._is_violated({"text": text}, phase="output")
            preset_response = self.config["outputs_config"]["preset_response"]

        return ModerationOutputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    @with_credit_usage_created_by(CreditUsageCreatedBy.MODERATION)
    def _is_violated(self, inputs: dict[str, Any], *, phase: Literal["input", "output"] = "input") -> bool:
        """Reuse active platform verdicts; independent calls retain tenant credentials and quota behavior."""
        moderation = get_app_moderation_runtime()
        verdict = (
            moderation.check_openai(self.tenant_id, self.app_id, inputs, phase) if moderation is not None else None
        )
        if verdict is not None:
            return verdict
        text = "\n".join(str(inputs.values()))
        model_manager = ModelManager.for_tenant(tenant_id=self.tenant_id)
        model_instance = model_manager.get_model_instance(
            tenant_id=self.tenant_id, provider="openai", model_type=ModelType.MODERATION, model="omni-moderation-latest"
        )

        openai_moderation = model_instance.invoke_moderation(text=text)

        return openai_moderation
