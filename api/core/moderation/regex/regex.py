import logging
import re

from core.moderation.base import Moderation, ModerationAction, ModerationInputsResult, ModerationOutputsResult

logger = logging.getLogger(__name__)


class RegexModeration(Moderation):
    name: str = "regex"

    @classmethod
    def validate_config(cls, tenant_id: str, config: dict) -> None:
        """
        Validate the incoming form config data.

        :param tenant_id: the id of workspace
        :param config: the form config data
        :return:
        """
        cls._validate_inputs_and_outputs_config(config, True)
        regex_content = config["regex"]
        if not regex_content:
            raise ValueError("regex is required")

        if len(regex_content) > 1000:
            raise ValueError("regex length must be less than 1000")
        try:
            re.compile(regex_content)
        except Exception as ex:
            logging.exception(f"failed to compile the regular expression {regex_content}, {ex}")
            raise ValueError(f"the regular expression {regex_content} is invalid")

    def moderation_for_inputs(self, inputs: dict, query: str = "") -> ModerationInputsResult:
        flagged = False
        preset_response = ""
        if self.config["inputs_config"]["enabled"]:
            preset_response = self.config["inputs_config"]["preset_response"]
            if query:
                inputs["query__"] = query
            regex = self.config["regex"]
            flagged = self._is_violated(inputs, regex)
        return ModerationInputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    def moderation_for_outputs(self, text: str) -> ModerationOutputsResult:
        flagged = False
        preset_response = ""
        if self.config["outputs_config"]["enabled"]:
            regex = self.config["regex"]
            flagged = self._is_violated({"text": text}, regex)
            preset_response = self.config["outputs_config"]["preset_response"]
        return ModerationOutputsResult(
            flagged=flagged, action=ModerationAction.DIRECT_OUTPUT, preset_response=preset_response
        )

    def _is_violated(self, inputs: dict, regex: str) -> bool:
        return any(self._check_regex_in_value(regex, value) for value in inputs.values())

    def _check_regex_in_value(self, regex: str, value: str) -> bool:
        try:
            pattern = re.compile(regex)
            if pattern.search(value):
                return True
            return False
        except Exception as ex:
            logging.exception(f"failed to compile the regular expression {regex}, {ex}")
            return False
